import retry from 'async-retry';
import { Client, Pool } from 'pg';
import snakeize from 'snakeize';

import { ServiceError } from 'errors';
import logger from 'infra/logger.js';
import webserver from 'infra/webserver.js';

const configurations = {
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30000,
  max: 3,
  ssl: {
    rejectUnauthorized: false,
  },
  allowExitOnIdle: true,
};

if (!webserver.isServerlessRuntime) {
  configurations.max = 30;

  // https://github.com/filipedeschamps/tabnews.com.br/issues/84
  delete configurations.ssl;
}

const cache = {
  pool: null,
  maxConnections: null,
  reservedConnections: null,
  openedConnections: null,
  openedConnectionsLastUpdate: null,
  poolQueryCount: 0,
};

async function query(query, options = {}) {
  let client;
  cache.poolQueryCount += 1;

  try {
    client = options.transaction ? options.transaction : await tryToGetNewClientFromPool();
    return await client.query(query);
  } catch (error) {
    throw parseQueryErrorAndLog(error, query);
  } finally {
    if (client && !options.transaction) {
      const tooManyConnections = await checkForTooManyConnections(client);

      client.release(tooManyConnections && webserver.isServerlessRuntime);
    }
  }
}

async function tryToGetNewClientFromPool() {
  const clientFromPool = await retry(newClientFromPool, {
    retries: webserver.isBuildTime ? 12 : 1,
    minTimeout: 150,
    maxTimeout: 5000,
    factor: 2,
    onRetry: (error, attempt) => {
      const pool = cache.pool
        ? {
            totalCount: cache.pool.totalCount,
            idleCount: cache.pool.idleCount,
            waitingCount: cache.pool.waitingCount,
          }
        : null;
      const errorObject = new ServiceError({
        message: error.message,
        stack: error.stack,
        cause: error.cause,
        context: {
          attempt,
          databaseCache: {
            ...cache,
            pool,
          },
        },
        errorLocationCode: 'INFRA:DATABASE:GET_NEW_CLIENT_FROM_POOL',
      });
      logger.error(errorObject);
    },
  });

  return clientFromPool;

  async function newClientFromPool() {
    if (!cache.pool) {
      cache.pool = new Pool(configurations);
    }

    return await cache.pool.connect();
  }
}

async function checkForTooManyConnections(client) {
  if (webserver.isBuildTime || cache.pool?.waitingCount) return false;

  const currentTime = new Date().getTime();
  const openedConnectionsMaxAge = 5000;
  const maxConnectionsTolerance = 0.8;

  try {
    if (cache.maxConnections === null || cache.reservedConnections === null) {
      const [maxConnections, reservedConnections] = await getConnectionLimits();
      cache.maxConnections = maxConnections;
      cache.reservedConnections = reservedConnections;
    }

    if (cache.openedConnections === null || currentTime - cache.openedConnectionsLastUpdate > openedConnectionsMaxAge) {
      const openedConnections = await getOpenedConnections();
      cache.openedConnections = openedConnections;
      cache.openedConnectionsLastUpdate = currentTime;
    }
  } catch (error) {
    if (error.code === 'ECONNRESET') {
      return true;
    }
    throw error;
  }

  if (cache.openedConnections > (cache.maxConnections - cache.reservedConnections) * maxConnectionsTolerance) {
    return true;
  }

  return false;

  async function getConnectionLimits() {
    const [maxConnectionsResult, reservedConnectionResult] = await client.query(
      'SHOW max_connections; SHOW superuser_reserved_connections;',
    );
    return [
      maxConnectionsResult.rows[0].max_connections,
      reservedConnectionResult.rows[0].superuser_reserved_connections,
    ];
  }

  async function getOpenedConnections() {
    const openConnectionsResult = await client.query({
      text: 'SELECT numbackends as opened_connections FROM pg_stat_database where datname = $1',
      values: [process.env.POSTGRES_DB],
    });
    return openConnectionsResult.rows[0].opened_connections;
  }
}

async function getNewClient() {
  try {
    const client = await tryToGetNewClient();
    return client;
  } catch (error) {
    const errorObject = new ServiceError({
      message: error.message,
      errorLocationCode: 'INFRA:DATABASE:GET_NEW_CONNECTED_CLIENT',
      stack: new Error().stack,
    });
    logger.error(snakeize(errorObject));
    throw errorObject;
  }
}

async function tryToGetNewClient() {
  const client = await retry(newClient, {
    retries: 50,
    minTimeout: 0,
    factor: 2,
  });

  return client;

  // You need to close the client when you are done with it
  // using the client.end() method.
  async function newClient() {
    const client = new Client(configurations);
    await client.connect();
    return client;
  }
}

const UNIQUE_CONSTRAINT_VIOLATION = '23505';
const SERIALIZATION_FAILURE = '40001';
const UNDEFINED_FUNCTION = '42883';

function parseQueryErrorAndLog(error, query) {
  const expectedErrorsCode = [UNIQUE_CONSTRAINT_VIOLATION, SERIALIZATION_FAILURE];

  if (!webserver.isServerlessRuntime) {
    expectedErrorsCode.push(UNDEFINED_FUNCTION);
  }

  const pool = cache.pool
    ? {
        totalCount: cache.pool.totalCount,
        idleCount: cache.pool.idleCount,
        waitingCount: cache.pool.waitingCount,
      }
    : null;

  const errorToReturn = new ServiceError({
    message: error.message,
    context: {
      query: query.text,
      databaseCache: { ...cache, pool },
    },
    errorLocationCode: 'INFRA:DATABASE:QUERY',
    databaseErrorCode: error.code,
  });

  if (!expectedErrorsCode.includes(error.code)) {
    logger.error(snakeize(errorToReturn));
  }

  return errorToReturn;
}

async function transaction() {
  return await tryToGetNewClientFromPool();
}

export default Object.freeze({
  query,
  getNewClient,
  transaction,
  errorCodes: {
    UNIQUE_CONSTRAINT_VIOLATION,
    SERIALIZATION_FAILURE,
    UNDEFINED_FUNCTION,
  },
});
