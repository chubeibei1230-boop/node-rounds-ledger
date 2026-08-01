const { getDb } = require('../db/connection');
const exceptionRepository = require('../repositories/exceptionRepository');
const { ApiError } = require('../errors/ApiError');
const deviceService = require('./deviceService');
const { requireFields, requireString, optionalString, requireEnum } = require('../utils/validate');

const REVIEW_RESULTS = ['confirmed', 'ignored', 'resolved'];

function reviewException(id, body) {
  requireFields(body, ['reviewer_name', 'review_result']);
  requireString(body.reviewer_name, 'reviewer_name');
  requireEnum(body.review_result, REVIEW_RESULTS, 'review_result');
  optionalString(body.review_comment, 'review_comment');

  const db = getDb();
  const exception = exceptionRepository.findExceptionById(db, id);
  if (!exception) {
    throw ApiError.notFound('异常记录不存在', { exception_id: id });
  }
  if (exception.review_status !== 'pending') {
    throw ApiError.invalidState('异常记录已完成复核，不能重复复核', {
      exception_id: id,
      review_status: exception.review_status,
    });
  }

  exceptionRepository.updateReview(db, id, {
    review_status: body.review_result,
    reviewer_name: body.reviewer_name.trim(),
    review_comment: body.review_comment || '',
    reviewed_at: new Date().toISOString(),
  });
  return exceptionRepository.findExceptionById(db, id);
}

function listExceptions(query) {
  const filters = {};
  if (query.risk_level !== undefined) {
    requireEnum(query.risk_level, deviceService.RISK_LEVELS, 'risk_level');
    filters.risk_level = query.risk_level;
  }
  if (query.review_status !== undefined) {
    requireEnum(query.review_status, ['pending', 'confirmed', 'ignored', 'resolved'], 'review_status');
    filters.review_status = query.review_status;
  }
  const db = getDb();
  return exceptionRepository.listExceptions(db, filters);
}

function areaExceptionStats() {
  const db = getDb();
  return exceptionRepository.areaExceptionStats(db);
}

module.exports = { reviewException, listExceptions, areaExceptionStats, REVIEW_RESULTS };
