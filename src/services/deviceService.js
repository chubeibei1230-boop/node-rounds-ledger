'use strict';

const deviceDao = require('../dao/deviceDao');
const {
  requireString,
  requireEnum,
  optionalString,
  requireBoolean,
} = require('../validation');
const { conflict, notFound } = require('../errors');

const RISK_LEVELS = ['low', 'medium', 'high'];

function createDevice(db, body) {
  const device = {
    device_code: requireString(body.device_code, 'device_code'),
    device_name: requireString(body.device_name, 'device_name'),
    area: requireString(body.area, 'area'),
    device_type: requireString(body.device_type, 'device_type'),
    risk_level: requireEnum(body.risk_level, 'risk_level', RISK_LEVELS),
    enabled: requireBoolean(body.enabled, 'enabled', true),
    maintenance_note: optionalString(body.maintenance_note, 'maintenance_note'),
  };

  if (deviceDao.getDeviceByCode(db, device.device_code)) {
    throw conflict(`Device code '${device.device_code}' already exists`, { device_code: device.device_code });
  }

  return deviceDao.insertDevice(db, device);
}

function disableDevice(db, id) {
  const device = deviceDao.getDeviceById(db, id);
  if (!device) {
    throw notFound(`Device ${id} not found`, { device_id: id });
  }
  if (!device.enabled) {
    return device;
  }
  return deviceDao.setDeviceEnabled(db, id, false);
}

function getDevice(db, id) {
  const device = deviceDao.getDeviceById(db, id);
  if (!device) {
    throw notFound(`Device ${id} not found`, { device_id: id });
  }
  return device;
}

module.exports = { createDevice, disableDevice, getDevice, RISK_LEVELS };
