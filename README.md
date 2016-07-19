A sample created to describe an error we are facing while using MySQL driver pooling using NodeJS (v4.2.2) 
and mysql (2.11.1).

Node version - **v4.2.2**
MariaDB version - **v2.11.1**

## Directions for setup

1. Clone the repo - `git clone https://github.com/bsurendrakumar/mysql-pool-issue.git`
2. Run the SQL scripts under the sql folder - `db.sql`.
3. Set the database configuration [here](https://github.com/bsurendrakumar/node-simplex/blob/master/app/server.js#L9).
4. Run `npm install` to install the dependent modules.
5. Run `npm start` to start the server.

## Reproducing the issue

Open the http://127.0.0.1:3002/api/v1/country/list in your browser as soon as you start your server, mostly within 240 seconds.

The reason its 240 seconds is because the generic-pool's `idleTimeout` is set to 240 seconds.

> This URL will vary based on the where you're server is running.

## Why do we think its related to our usage of the mariasql library?

[Link to node-mariasql module](https://github.com/mscdex/node-mariasql)

Since the `node-mariasql` library does not support pooling, we are using the third party - [generic-pool](https://github.com/coopernurse/node-pool) to maintain a pool of connections. The minimum number of connections is set to 5. All its configuration can be found under [here](https://github.com/bsurendrakumar/node-simplex/blob/master/app/server.js#L9). So when the server starts, generic pool will kick of 5 connections to MySQL and keep them in its pool.

The `idleTimeout` for an object in the pool has been set to 240 seconds. This means that if there are more than 5 (since 5 is the minimum) objects in the pool and one of them has not been used for the last 240 seconds, it'll be destroyed.

At server startup, we're making a simple call to our country model to fetch the list of countries. This code is [here](https://github.com/bsurendrakumar/node-simplex/blob/master/app/server.js#L71). This establishes a new connection to the database, so now in the pool there'll be a 6 SQL connection in the pool and one of which will get cleaned after 240 seconds.

Following is the step by step process via which, we believe that the issue is with our usage of the mariasql library -

- When the server is started, we are logging the process ID to the console. Grab the mater process ID, for example - **20584**.
- Look at the file descriptors being used by the process by using - `ls -l /proc/20584/fd`. Make a note of the socket connections. The output of this will look something like this -
```
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 12 -> socket:[2469914]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 13 -> socket:[2469917]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 14 -> socket:[2468106]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 15 -> socket:[2468109]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 17 -> socket:[2467206]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 18 -> socket:[2467208]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 19 -> socket:[2467210]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 2 -> /dev/tty
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 20 -> socket:[2467212]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 21 -> socket:[2467214]
lrwx------ 1 abijeet abijeet 64 Jun  9 19:24 22 -> socket:[2467306]
```
- Copy few of the sockets numbers for example *2467212*, and run `lsof | grep 2467212`. You'll notice that these are connections to the MySQL server. The output of that should be something like -
```
node      20584           abijeet   20u     IPv4            2467212       0t0        TCP localhost:57092->localhost:mysql (ESTABLISHED)
V8        20584 20585     abijeet   20u     IPv4            2467212       0t0        TCP localhost:57092->localhost:mysql (ESTABLISHED)
V8        20584 20586     abijeet   20u     IPv4            2467212       0t0        TCP localhost:57092->localhost:mysql (ESTABLISHED)
V8        20584 20587     abijeet   20u     IPv4            2467212       0t0        TCP localhost:57092->localhost:mysql (ESTABLISHED)
V8        20584 20588     abijeet   20u     IPv4            2467212       0t0        TCP localhost:57092->localhost:mysql (ESTABLISHED)
```
- Crash the server by going to http://127.0.0.1:3002/api/v1/country/list. This will crash one of the child processes. Whenever an uncaught exception occurs, we do some cleanup and exit. We then fork another process to take the place of the one that was just killed. Cleanup includes -
   - Closing http server
   - Closing MySQL connections in generic pool
   - Closing winston logger streams.
- Wait for the MySQL connection in the master thread to be closed. When this happes, we are writing a log to the console -
```
Destroying / ending master thread ID -  4984
```
- Check your CPU usage, you'll notice that one of the CPU's has shot upto 100%.
- Next run, `strace -o log.txt -eepoll_ctl,epoll_wait -p 20584`. Note that you might need to install **strace**. This command logs all the `epoll_ctl, epoll_wait` system calls made by the Node.JS process and puts it inside a file named **log.txt** the current working directory.
- Open the **log.txt** file, and you'll notice logs similar to these -
```
epoll_wait(5, {{EPOLLIN|EPOLLHUP, {u32=16, u64=16}}}, 1024, 847) = 1
epoll_ctl(5, EPOLL_CTL_DEL, 16, 7ffe441aa850) = -1 EBADF (Bad file descriptor)
epoll_wait(5, {{EPOLLIN|EPOLLHUP, {u32=16, u64=16}}}, 1024, 845) = 1
epoll_ctl(5, EPOLL_CTL_DEL, 16, 7ffe441aa850) = -1 EBADF (Bad file descriptor)
epoll_wait(5, {{EPOLLIN|EPOLLHUP, {u32=16, u64=16}}}, 1024, 843) = 1
epoll_ctl(5, EPOLL_CTL_DEL, 16, 7ffe441aa850) = -1 EBADF (Bad file descriptor)
```
- The file descriptor here is **16**, and if you co-relate it with your earlier `ls -l /proc/20584/fd` and `lsof | grep 2467212`, you'll realize that this belongs to the MySQL connection that was just closed.

This leads us to believe that somewhere, even when the connection to MySQL is released, there is a file descriptor hanging there, that is still being used. We've found various threads across forums -

   - https://github.com/joyent/libuv/issues/1099
   - https://github.com/nodejs/node-v0.x-archive/issues/6271
   - https://github.com/joyent/libuv/issues/826
