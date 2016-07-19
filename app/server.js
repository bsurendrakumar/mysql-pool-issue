// NodeJS includes
'use strict';

var portNum = 3000;
var ipAddr = '10.0.0.159';

// define the database configuration

var dbConfig = {
  name: 'mysql',
  connectionLimit: 20,    // Max connections in pool
  host: '10.0.0.66',           // DB Host
  user: 'osmosys',           // DB User
  password: 'Change123',   // DB Password
  database: 'dev',        // DB Name
  connectTimeout: 20000,  // Connection timeout in milliseconds
  multipleStatements: true
};

var cluster = require('cluster');
var http = require('http');
var express = require('express');
var process = require('process');
var mSQLClient = require('mysql');
var async = require('async');
var uuid = require('node-uuid');

// Initialising the app
var app = express();
// Count the machine's CPUs
var cpuCount = require('os').cpus().length;
var httpServer = null;
var transactionPool = {};
// Creating the pool of connections
var mSQLPool =  mSQLClient.createPool(dbConfig); 


// The master process - will only be used when on PROD
if (cluster.isMaster) {
  console.log('------------------------------------');
  console.log('Master Process ID:', process.pid);
  console.log('------------------------------------\n\n');

  console.log('Creating an extra DB connection on the master thread.\n\n');
  insertDemoData(function() {
    console.log('Inserting data from Master thread...');
  });

  // Create a worker for each CPU
  for (var i = 0; i < cpuCount; i += 1) {
    cluster.fork();
  }

  cluster.on('exit', function () {
    cluster.fork();
  });

} else {
  console.log('Child Process ID:', process.pid);
  console.log('------------------------------------');

  // Bind the api routes.
  bindRoutes(app);

  httpServer = http.createServer(app).listen(portNum, ipAddr, function (error) {
    if (error) {
      console.log(error);
      process.exit(10);
    }
    console.log('Express is listening on http://' + ipAddr + ':' + portNum);
  });
}

// Handle uncaught exceptions...
process.on('uncaughtException', function (err) {
  try {
    console.log('\n--------------');
    console.log(err);
    console.log('\n--------------');
    console.log('Encountered uncaught exception!');
    console.log('Performing clean up ...');
    // Call the cleanup function
    cleanUp(function() {
      console.log('Cleanup done!');
      // Stop the HTTP Server
      if(httpServer) {
        console.log('Stopping HTTP server ...');
        httpServer.close(function() {
          console.log('Stopped HTTP server, performing restart ...');
          // Exit!!
          restartProcess();
        });
      }
    });
  } catch (e) {
    console.log(e);
    restartProcess();
  }

  function restartProcess() {
    console.log('Restarting process ...');
    process.exit(1);
  }
});

// Helps in initiating the transaction
function beginTransaction(cb) {
  var transactionID = uuid.v4();
  mSQLPool.getConnection(function(err, connection) {
    if(err) {
      return cb(err);
    }
    transactionPool[transactionID] = connection;
    connection.query('START TRANSACTION;').on('end', function() {
      return cb(null, transactionID);
    }).on('error', function(err) {
      destroyTransaction(transactionID, err);
      return cb(err);
    });
  });
}

// Helps in committing the transaction
function commitTransaction(transactionID, cb) {
  var connection = transactionPool[transactionID];
  var hadError = false;
  connection.query('COMMIT;').on('error', function(err) {
    hadError = true;
    rollbackTransaction(transactionID, function(tErr) {
      if(tErr) {
        return cb(tErr);
      } else {
        return cb(err);
      }
    });
  }).on('end', function() {
    if(!hadError) {
      destroyTransaction(transactionID);
      return cb(null);
    }
  });
}

// Helps in roll back the transaction
function rollbackTransaction(transactionID, cb) {
  var connection = transactionPool[transactionID];
  connection.query('ROLLBACK;').on('error', function(err) {
    destroyTransaction(transactionID, err);
    return cb(err);
  }).on('end', function() {
    destroyTransaction(transactionID);
    return cb(null);
  });
}

// Helps in destroying the transaction

function destroyTransaction(transactionID, err) {
  var connection = transactionPool[transactionID];
  if(err && err.fatal) {
    connection.destroy();
  } else {
    connection.release();
  }
  delete transactionPool[transactionID];
}

function insertDemoData(cbMain) {
  var transactionID = null;
  // Creating the pool of connections
  if(!mSQLPool) {
    mSQLPool =  mSQLClient.createPool(dbConfig);
  } 

  async.waterfall([function(next) {
    beginTransaction(next);
  }, function(tID, next) {
    transactionID = tID;
    insertDemoCountries(transactionID, next);
  }, function(countryInfo, next) {
    insertDemoStates(transactionID, countryInfo.cid, next);
  }, function(stateID, next) {
    commitTransaction(transactionID, next);
  }], function(err) {
    if(err) {
      rollbackTransaction(transactionID);
      return cbMain(err);
    }
    return cbMain(null);
  });
}

function runQuery(transactionID, query, data, cb) {
  var connection = transactionPool[transactionID];
  var hadError = false;
  connection.config.queryFormat = getCustomQueryFormat(data);
  connection.query(query, data, function(err, result) {
    if(err) {
      handleError(connection, err);
      return cb(err);
    } else {
      return cb(null, {
        'cid': data.id
      });
    }
  });
}

function handleError(connection, err) {
  if(err.fatal) {
    connection.destroy();
  } else {
    connection.release();
  }
}

function insertDemoCountries(tID, cb) {
  var sqlQuery = 'INSERT INTO country_m '+
                 '(country_recid, country_name, is_active, created_on) '+
                 'VALUES(:id, :name, :isActive, :createdOn)';
  var data = {
    'id': uuid.v4(),
    'name': "India",
    'isActive': 1,
    'createdOn': new Date().toISOString().slice(0, 19).replace('T', ' ')
  };

  runQuery(tID, sqlQuery, data, cb);
}

function insertDemoStates(tID, cid, cb) {
  var sqlQuery = 'INSERT INTO state_m '+
                 '(state_recid, state_name, is_active, created_on, country_recid) '+
                 'VALUES(:id, :name, :isActive, :createdOn, :cid)';
  var data = {
    'id': uuid.v4(),
    'name': "India",
    'isActive': 1,
    'createdOn': new Date().toISOString().slice(0, 19).replace('T', ' '),
    'cid': cid
  };

  runQuery(tID, sqlQuery, data, cb);
}

function bindRoutes(app) {
  app.post('/api/v1/demo', function(request, response) {
    insertDemoData(function(err) {
      response.send('Got the API call...');
    });
  });
}

function cleanUp(cbMain) {
  mSQLPool.end(function(err) {
    if(err) {
      return cbMain(err);
    }
    return cbMain(null);
  });
}

function getCustomQueryFormat() {
  return function(query, values) {
    if(!values) {
      return query;
    }
    return query.replace(/\:(\w+)/g, function(txt, key) {
      if (values.hasOwnProperty(key)) {
        return this.escape(values[key]);
      }
      return null;
    }.bind(this));
  };
}