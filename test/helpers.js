'use strict';

const { createApp } = require('../src/app');
const { createMemoryDb } = require('../src/db/connection');

/**
 * Spin up the app on an ephemeral port backed by a fresh in-memory database.
 * Returns { base, close } where base is the http origin and close stops it.
 */
async function startTestServer() {
  const db = createMemoryDb();
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    db,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Small fetch wrapper returning { status, body }. */
async function call(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  const text = await res.text();
  if (text) {
    parsed = JSON.parse(text);
  }
  return { status: res.status, body: parsed };
}

// Convenience fixtures ------------------------------------------------------

function deviceFixture(overrides = {}) {
  return {
    device_code: 'DEV-001',
    device_name: 'Pump A',
    area: 'B1',
    device_type: 'pump',
    risk_level: 'high',
    enabled: true,
    maintenance_note: 'quarterly service',
    ...overrides,
  };
}

function checklistFixture(overrides = {}) {
  return {
    checklist_name: 'Pump Routine',
    device_type: 'pump',
    cycle_days: 30,
    items: [
      { item_key: 'pressure', label: 'Check pressure' },
      { item_key: 'noise', label: 'Check noise' },
    ],
    ...overrides,
  };
}

module.exports = { startTestServer, call, deviceFixture, checklistFixture };
