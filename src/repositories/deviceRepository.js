function insertDevice(db, device) {
  const stmt = db.prepare(`
    INSERT INTO devices (device_code, device_name, area, device_type, risk_level, enabled, maintenance_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    device.device_code,
    device.device_name,
    device.area,
    device.device_type,
    device.risk_level,
    device.enabled,
    device.maintenance_note,
    device.created_at,
    device.updated_at
  );
  return Number(info.lastInsertRowid);
}

function findDeviceById(db, id) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
}

function findDeviceByCode(db, deviceCode) {
  return db.prepare('SELECT * FROM devices WHERE device_code = ?').get(deviceCode);
}

function setDeviceEnabled(db, id, enabled, updatedAt) {
  db.prepare('UPDATE devices SET enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    updatedAt,
    id
  );
}

module.exports = {
  insertDevice,
  findDeviceById,
  findDeviceByCode,
  setDeviceEnabled,
};
