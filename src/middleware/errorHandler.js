'use strict';

const { AppError } = require('../errors');

/** 404 handler for unknown routes. */
function notFoundHandler(req, res) {
  res.status(404).json({
    error_code: 'not_found',
    message: `Route ${req.method} ${req.path} not found`,
    details: {},
  });
}

/**
 * Central error middleware. Serialises every error into the fixed envelope:
 *   { "error_code": "...", "message": "...", "details": { ... } }
 */
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error_code: err.errorCode,
      message: err.message,
      details: err.details || {},
    });
  }

  // SQLite constraint violations -> 409 conflict.
  if (err && typeof err.message === 'string' && err.message.includes('SQLITE_CONSTRAINT')) {
    return res.status(409).json({
      error_code: 'conflict',
      message: 'Database constraint violation',
      details: { reason: err.message },
    });
  }

  // Malformed JSON body from express.json().
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error_code: 'validation_error',
      message: 'Request body is not valid JSON',
      details: {},
    });
  }

  return res.status(500).json({
    error_code: 'internal_error',
    message: 'An unexpected error occurred',
    details: {},
  });
}

module.exports = { notFoundHandler, errorHandler };
