'use strict';

/**
 * Data access layer for devices.
 * All functions take the db handle as first argument so the layer stays stateless.
 */

function insertDevice(db, device) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO devices
      (device_code, device_name, area, device_type, risk_level, enabled, maintenance_note, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    device.device_code,
    device.device_name,
    device.area,
    device.device_type,
    device.risk_level,
    device.enabled ? 1 : 0,
    device.maintenance_note ?? null,
    now,
    now,
  );
  return getDeviceById(db, Number(info.lastInsertRowid));
}

function getDeviceById(db, id) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
}

function getDeviceByCode(db, code) {
  return db.prepare('SELECT * FROM devices WHERE device_code = ?').get(code);
}

function setDeviceEnabled(db, id, enabled) {
  const now = new Date().toISOString();
  db.prepare('UPDATE devices SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id);
  return getDeviceById(db, id);
}

function listDevices(db) {
  return db.prepare('SELECT * FROM devices ORDER BY id').all();
}

module.exports = {
  insertDevice,
  getDeviceById,
  getDeviceByCode,
  setDeviceEnabled,
  listDevices,
};
