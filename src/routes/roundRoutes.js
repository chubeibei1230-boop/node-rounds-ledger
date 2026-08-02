'use strict';

const express = require('express');
const roundService = require('../services/roundService');
const { badRequest } = require('../errors');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function roundRoutes(db) {
  const router = express.Router();

  // Generate a planned round.
  router.post('/', wrap((req, res) => {
    const round = roundService.generateRound(db, req.body || {});
    res.status(201).json(round);
  }));

  // Query: rounds not yet closed, filtered by area.
  //   GET /api/v1/rounds/open?area=B1
  router.get('/open', wrap((req, res) => {
    if (!req.query.area) {
      throw badRequest("Query parameter 'area' is required", { field: 'area' });
    }
    const rounds = roundService.openRoundsByArea(db, String(req.query.area));
    res.json({ area: String(req.query.area), rounds });
  }));

  // Query: exception items by device risk level.
  //   GET /api/v1/rounds/exceptions?risk_level=high
  router.get('/exceptions', wrap((req, res) => {
    if (!req.query.risk_level) {
      throw badRequest("Query parameter 'risk_level' is required", { field: 'risk_level' });
    }
    const exceptions = roundService.exceptionsByRiskLevel(db, String(req.query.risk_level));
    res.json({ risk_level: String(req.query.risk_level), exceptions });
  }));

  // Query: aggregated exception statistics by area.
  router.get('/exceptions/by-area', wrap((req, res) => {
    res.json({ areas: roundService.areaExceptionStatistics(db) });
  }));

  // Query: risk summary grouped by area + risk_level.
  //   GET /api/v1/rounds/risk-summary?area=B1&risk_level=high  (both optional)
  router.get('/risk-summary', wrap((req, res) => {
    const summary = roundService.riskSummary(db, {
      area: req.query.area !== undefined ? String(req.query.area) : undefined,
      riskLevel: req.query.risk_level !== undefined ? String(req.query.risk_level) : undefined,
    });
    res.json({ summary });
  }));

  // Get a single round.
  router.get('/:id', wrap((req, res) => {
    const round = roundService.getRound(db, Number(req.params.id));
    res.json(round);
  }));

  // Start inspection: scheduled -> in_progress.
  router.post('/:id/start', wrap((req, res) => {
    const round = roundService.startRound(db, Number(req.params.id));
    res.json(round);
  }));

  // Submit results: in_progress -> submitted.
  router.post('/:id/results', wrap((req, res) => {
    const result = roundService.submitResults(db, Number(req.params.id), req.body || {});
    res.status(201).json(result);
  }));

  // Review an exception for a round.
  router.post('/:id/reviews/:reviewId', wrap((req, res) => {
    const review = roundService.reviewException(
      db,
      Number(req.params.id),
      Number(req.params.reviewId),
      req.body || {},
    );
    res.json(review);
  }));

  // Close a round: submitted -> closed.
  router.post('/:id/close', wrap((req, res) => {
    const round = roundService.closeRound(db, Number(req.params.id));
    res.json(round);
  }));

  return router;
};
