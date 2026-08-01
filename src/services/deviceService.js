const { getDb } = require('../db/connection');
const deviceRepository = require('../repositories/deviceRepository');
const { ApiError } = require('../errors/ApiError');
const {
  requireFields,
  requireString,
  optionalString,
  requireEnum,
} = require('../utils/validate');

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function createDevice(body) {
  requireFields(body, ['device_code', 'device_name', 'area', 'device_type', 'risk_level']);
  requireString(body.device_code, 'device_code');
  requireString(body.device_name, 'device_name');
  requireString(body.area, 'area');
  requireString(body.device_type, 'device_type');
  requireEnum(body.risk_level, RISK_LEVELS, 'risk_level');
  optionalString(body.maintenance_note, 'maintenance_note');
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    throw ApiError.badRequest('字段 enabled 必须是布尔值', { field: 'enabled' });
  }

  const db = getDb();
  if (deviceRepository.findDeviceByCode(db, body.device_code.trim())) {
    throw ApiError.conflict('设备编码已存在', { device_code: body.device_code });
  }

  const now = new Date().toISOString();
  const id = deviceRepository.insertDevice(db, {
    device_code: body.device_code.trim(),
    device_name: body.device_name.trim(),
    area: body.area.trim(),
    device_type: body.device_type.trim(),
    risk_level: body.risk_level,
    enabled: body.enabled === false ? 0 : 1,
    maintenance_note: body.maintenance_note || '',
    created_at: now,
    updated_at: now,
  });
  return deviceRepository.findDeviceById(db, id);
}

function getDeviceOrThrow(db, id) {
  const device = deviceRepository.findDeviceById(db, id);
  if (!device) {
    throw ApiError.notFound('设备不存在', { device_id: id });
  }
  return device;
}

function disableDevice(id) {
  const db = getDb();
  getDeviceOrThrow(db, id);
  deviceRepository.setDeviceEnabled(db, id, false, new Date().toISOString());
  return deviceRepository.findDeviceById(db, id);
}

module.exports = { createDevice, disableDevice, getDeviceOrThrow, RISK_LEVELS };
