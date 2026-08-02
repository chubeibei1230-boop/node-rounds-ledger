'use strict';

const express = require('express');
const deviceService = require('../services/deviceService');
const roundService = require('../services/roundService');

/** Wrap async handlers so thrown errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function deviceRoutes(db) {
  const router = express.Router();

  // Create a device.
  router.post('/', wrap((req, res) => {
    const device = deviceService.createDevice(db, req.body || {});
    res.status(201).json(device);
  }));

  // Get a device.
  router.get('/:id', wrap((req, res) => {
    const device = deviceService.getDevice(db, Number(req.params.id));
    res.json(device);
  }));

  // Query: most recent rounds for a device.
  //   GET /api/v1/devices/:id/rounds?limit=10
  router.get('/:id/rounds', wrap((req, res) => {
    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 10;
    const result = roundService.recentRoundsForDevice(db, Number(req.params.id), limit);
    res.json(result);
  }));

  // Disable (retire) a device.
  router.post('/:id/disable', wrap((req, res) => {
    const device = deviceService.disableDevice(db, Number(req.params.id));
    res.json(device);
  }));

  return router;
};
