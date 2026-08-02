'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, deviceFixture } = require('./helpers');

test('create device returns 201 with snake_case fields', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    assert.strictEqual(status, 201);
    assert.strictEqual(body.device_code, 'DEV-001');
    assert.strictEqual(body.risk_level, 'high');
    assert.strictEqual(body.enabled, 1);
    assert.ok(body.created_at);
  } finally {
    await close();
  }
});

test('duplicate device_code returns 409 conflict', async () => {
  const { base, close } = await startTestServer();
  try {
    await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const { status, body } = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    assert.strictEqual(status, 409);
    assert.strictEqual(body.error_code, 'conflict');
  } finally {
    await close();
  }
});

test('invalid risk_level returns 400 validation_error with details', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/devices', deviceFixture({ risk_level: 'extreme' }));
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error_code, 'validation_error');
    assert.strictEqual(body.details.field, 'risk_level');
  } finally {
    await close();
  }
});

test('missing required field returns 400', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/devices', deviceFixture({ device_name: '' }));
    assert.strictEqual(status, 400);
    assert.strictEqual(body.details.field, 'device_name');
  } finally {
    await close();
  }
});

test('disable device sets enabled to 0 and is idempotent', async () => {
  const { base, close } = await startTestServer();
  try {
    const created = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const first = await call(base, 'POST', `/api/v1/devices/${created.body.id}/disable`);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.enabled, 0);
    const second = await call(base, 'POST', `/api/v1/devices/${created.body.id}/disable`);
    assert.strictEqual(second.body.enabled, 0);
  } finally {
    await close();
  }
});

test('disable missing device returns 404', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/devices/999/disable');
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error_code, 'not_found');
  } finally {
    await close();
  }
});
