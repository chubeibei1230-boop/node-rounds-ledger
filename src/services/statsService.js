const { getDb } = require('../db/connection');
const statsRepository = require('../repositories/statsRepository');
const deviceService = require('./deviceService');
const { requireString, requireEnum } = require('../utils/validate');

function areaRiskSummary(query) {
  const filters = {};
  if (query.area !== undefined) {
    requireString(query.area, 'area');
    filters.area = query.area.trim();
  }
  if (query.risk_level !== undefined) {
    requireEnum(query.risk_level, deviceService.RISK_LEVELS, 'risk_level');
    filters.risk_level = query.risk_level;
  }
  const db = getDb();
  return statsRepository.areaRiskSummary(db, filters, new Date().toISOString());
}

module.exports = { areaRiskSummary };
