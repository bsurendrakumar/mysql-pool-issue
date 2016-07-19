CREATE DATABASE `dev`;

USE `dev`;

CREATE TABLE `country_m` (
  `country_recid` varchar(36) NOT NULL COMMENT 'uuid - unique identifier',
  `country_name` varchar(50) NOT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_on` datetime DEFAULT NULL
  PRIMARY KEY (`country_recid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE 'state_m' (
  'state_recid' varchar(36) NOT NULL COMMENT 'uuid-unique identifier'
  'state_name' varchar(36) NOT NULL,
  'is_active' tinyint(1) DEFAULT NULL,
  `created_on` datetime DEFAULT NULL,
  'country_recid' varchar(36) NOT NULL,
  PRIMARY KEY (`state_recid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
