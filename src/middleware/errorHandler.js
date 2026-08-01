const { ApiError } = require('../errors/ApiError');

function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error_code: err.errorCode,
      message: err.message,
      details: err.details,
    });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error_code: 'VALIDATION_ERROR',
      message: '请求体不是合法的 JSON',
      details: {},
    });
  }
  console.error(err);
  return res.status(500).json({
    error_code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    details: {},
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error_code: 'NOT_FOUND',
    message: `接口不存在: ${req.method} ${req.path}`,
    details: {},
  });
}

module.exports = { errorHandler, notFoundHandler };
