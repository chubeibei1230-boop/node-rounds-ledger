'use strict';

/**
 * Application error carrying an HTTP status, a stable error_code and optional details.
 * The error middleware serialises this into the fixed error envelope:
 *   { "error_code": "...", "message": "...", "details": { ... } }
 */
class AppError extends Error {
  constructor(status, errorCode, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'validation_error', message, details);
const notFound = (message, details) => new AppError(404, 'not_found', message, details);
const conflict = (message, details) => new AppError(409, 'conflict', message, details);
const invalidTransition = (message, details) =>
  new AppError(409, 'invalid_state_transition', message, details);

module.exports = { AppError, badRequest, notFound, conflict, invalidTransition };
