const express = require('express');
const chalk = require('chalk');
const bluebird = require('bluebird');
// 3p middleware
const morganBody = require('morgan-body');
const bodyParser = require('body-parser');
const compression = require('compression');

// 1p middleware
const requestId = require('./middleware/request-id');
const attachLogger = require('./middleware/attach-logger');
const requestContext = require('./middleware/request-context');

// see https://bookshelfjs.org/api.html#Model-instance-count
require('pg').defaults.parseInt8 = true;
const knex = require('knex');

const { version } = require('../package.json');
const Schema = require('./schema/schema');
const RestfulResource = require('./restful-resource');
const ResourceRouter = require('./resource-router');
const logger = require('./logger');

const isProd = process.env.NODE_ENV === 'production';
const logMsgTag = chalk.magentaBright(`[crudtastic v${version}]`);

function tagMsg(msg) {
  return `${logMsgTag} ${msg}`;
}

class Server {
  static CONFIG_DEFAULTS = {
    port: process.env.PORT || 3000,
    applicationName: 'My REST API (override in config.applicationName)',
    logBody: !isProd,
    stackTrace500: !isProd,
    logLevel: isProd ? 'error' : 'debug'
  };

  /**
   * Create a new instance of Server
   * with optional config. Config is merged
   * with defaults so all keys are optional
   * except dbUrl;
   * @param { dbUrl: 'String' } config
   */
  constructor(config) {
    this.app = express();
    const { dbUrl } = config;
    if (!dbUrl) {
      throw new Error(`No dbUrl provided in ${JSON.stringify(config)}`);
    }
    this.db = knex({
      client: 'pg',
      connection: dbUrl
    });
    this.schema = new Schema(this.db);
    this.config = {
      ...Server.CONFIG_DEFAULTS,
      ...config
    };
    this.configureMiddleware();
    logger.transports[0].level = this.config.logLevel;
    logger.info(tagMsg(chalk.whiteBright(this.config.applicationName)));
  }

  configureMiddleware() {
    const { app, config } = this;
    [
      requestId,
      requestContext,
      attachLogger,
      bodyParser.json(),
      compression()
    ].forEach((middleware) => app.use(middleware));
    const { logBody, stackTrace500 } = config;
    if (logBody) {
      morganBody(app);
    }
    if (stackTrace500) {
      const errorHandler = require('errorhandler');
      app.use(errorHandler());
    }
  }

  /**
   * Add any custom middleware, before calling listen()
   * See https://expressjs.com/en/guide/writing-middleware.html
   * @param {Function} middleware
   */
  use(middleware) {
    this.app.use(middleware);
  }

  mapResources() {
    return this.schema
      .introspect()
      .then((tables) => {
        return bluebird.map(tables, (table) => {
          const resource = new RestfulResource(table);
          return new ResourceRouter(resource);
        });
      })
      .then((routers) => {
        return bluebird.map(routers, (r) => {
          r.attach(this.app);
          return bluebird.props({
            [r.tableName]: r.verifyDb()
          });
        });
      });
  }

  listen() {
    return this.mapResources().then((counts) => {
      logger.debug('table counts:');
      counts.forEach((count) => logger.debug(JSON.stringify(count)));
      const { port } = this.config;
      logger.info(tagMsg(`👂 listening on port ${chalk.cyanBright(port)}`));
      this.app.get('/', (_, res) => res.sendStatus(200));
      return new Promise((resolve) => {
        this.app.listen(port, () => {
          logger.info(tagMsg(chalk.greenBright('READY!')));
          resolve(true);
        });
      });
    });
  }
}

module.exports = Server;
