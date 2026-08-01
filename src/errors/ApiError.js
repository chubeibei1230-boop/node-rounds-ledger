class ApiError extends Error {
  constructor(status, errorCode, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static notFound(message, details) {
    return new ApiError(404, 'NOT_FOUND', message, details);
  }

  static conflict(message, details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static invalidState(message, details) {
    return new ApiError(409, 'INVALID_STATE', message, details);
  }
}

module.exports = { ApiError };
