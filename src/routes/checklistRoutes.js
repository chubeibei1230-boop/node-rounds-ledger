'use strict';

const express = require('express');
const checklistService = require('../services/checklistService');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function checklistRoutes(db) {
  const router = express.Router();

  // Create a checklist (version 1).
  router.post('/', wrap((req, res) => {
    const checklist = checklistService.createChecklist(db, req.body || {});
    res.status(201).json(checklist);
  }));

  // Get a checklist.
  router.get('/:id', wrap((req, res) => {
    const checklist = checklistService.getChecklist(db, Number(req.params.id));
    res.json(checklist);
  }));

  // Copy a checklist into a new version.
  router.post('/:id/copy', wrap((req, res) => {
    const checklist = checklistService.copyChecklistVersion(db, Number(req.params.id), req.body || {});
    res.status(201).json(checklist);
  }));

  return router;
};
