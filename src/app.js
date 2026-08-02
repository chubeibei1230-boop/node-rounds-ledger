'use strict';

const express = require('express');
const deviceRoutes = require('./routes/deviceRoutes');
const checklistRoutes = require('./routes/checklistRoutes');
const roundRoutes = require('./routes/roundRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

/**
 * Build the Express application around a given database handle.
 * Keeping db injectable lets tests use an isolated in-memory database.
 */
function createApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/api/v1/health', (req, res) => {
    res.json({ status: 'ok', service: 'rounds-ledger' });
  });

  app.use('/api/v1/devices', deviceRoutes(db));
  app.use('/api/v1/checklists', checklistRoutes(db));
  app.use('/api/v1/rounds', roundRoutes(db));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
