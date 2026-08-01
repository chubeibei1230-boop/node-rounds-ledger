const { ApiError } = require('../errors/ApiError');

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('请求体必须是 JSON 对象');
  }
}

function requireFields(body, fields) {
  requireObject(body);
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ''
  );
  if (missing.length > 0) {
    throw ApiError.badRequest('缺少必填字段', { missing_fields: missing });
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw ApiError.badRequest(`字段 ${field} 必须是非空字符串`, { field });
  }
}

function optionalString(value, field) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw ApiError.badRequest(`字段 ${field} 必须是字符串`, { field });
  }
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw ApiError.badRequest(`字段 ${field} 取值非法`, { field, value, allowed });
  }
}

function requirePositiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw ApiError.badRequest(`字段 ${field} 必须是正整数`, { field, value });
  }
}

function parseIdParam(raw, name = 'id') {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('路径参数非法', { [name]: raw });
  }
  return id;
}

function requireISODate(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw ApiError.badRequest(`字段 ${field} 必须是合法的日期时间字符串`, { field, value });
  }
  return new Date(value).toISOString();
}

module.exports = {
  requireObject,
  requireFields,
  requireString,
  optionalString,
  requireEnum,
  requirePositiveInt,
  parseIdParam,
  requireISODate,
};
