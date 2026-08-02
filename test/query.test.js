'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, deviceFixture, checklistFixture } = require('./helpers');

/** Build a submitted round with a fault so it produces one exception review. */
async function buildRoundWithException(base, deviceOverrides) {
  const device = await call(base, 'POST', '/api/v1/devices', deviceFixture(deviceOverrides));
  const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture({
    checklist_name: `CL-${device.body.device_code}`,
  }));
  const round = await call(base, 'POST', '/api/v1/rounds', {
    device_id: device.body.id,
    checklist_id: checklist.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T12:00:00.000Z',
    owner_name: 'Owner',
  });
  await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
  await call(base, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
    results: [
      { item_key: 'pressure', result: 'fault' },
      { item_key: 'noise', result: 'normal' },
    ],
  });
  return { deviceId: device.body.id, roundId: round.body.id };
}

test('recent rounds for a device returns device and rounds', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId } = await buildRoundWithException(base);
    const { status, body } = await call(base, 'GET', `/api/v1/devices/${deviceId}/rounds`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.device.id, deviceId);
    assert.strictEqual(body.rounds.length, 1);
    assert.ok(body.rounds[0].checklist_snapshot);
  } finally {
    await close();
  }
});

test('recent rounds for missing device returns 404', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status } = await call(base, 'GET', '/api/v1/devices/999/rounds');
    assert.strictEqual(status, 404);
  } finally {
    await close();
  }
});

test('open rounds by area requires area param', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'GET', '/api/v1/rounds/open');
    assert.strictEqual(status, 400);
    assert.strictEqual(body.details.field, 'area');
  } finally {
    await close();
  }
});

test('open rounds by area reports pending exceptions and overdue flag', async () => {
  const { base, close } = await startTestServer();
  try {
    await buildRoundWithException(base, { area: 'ZONE-9' });
    const { status, body } = await call(base, 'GET', '/api/v1/rounds/open?area=ZONE-9');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.rounds.length, 1);
    assert.strictEqual(body.rounds[0].pending_exceptions, 1);
    // planned_end_at is in the past relative to 2026-08-02, so overdue.
    assert.strictEqual(body.rounds[0].overdue, true);
  } finally {
    await close();
  }
});

test('closed rounds are excluded from open-by-area', async () => {
  const { base, close } = await startTestServer();
  try {
    const { roundId } = await buildRoundWithException(base, { area: 'ZONE-CLOSED', device_code: 'DC-1' });
    await call(base, 'POST', `/api/v1/rounds/${roundId}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'R',
    });
    await call(base, 'POST', `/api/v1/rounds/${roundId}/close`);
    const { body } = await call(base, 'GET', '/api/v1/rounds/open?area=ZONE-CLOSED');
    assert.strictEqual(body.rounds.length, 0);
  } finally {
    await close();
  }
});

test('exceptions by risk level filters correctly', async () => {
  const { base, close } = await startTestServer();
  try {
    await buildRoundWithException(base, { risk_level: 'high', device_code: 'H-1', area: 'A' });
    await buildRoundWithException(base, { risk_level: 'low', device_code: 'L-1', area: 'A' });

    const high = await call(base, 'GET', '/api/v1/rounds/exceptions?risk_level=high');
    assert.strictEqual(high.status, 200);
    assert.strictEqual(high.body.exceptions.length, 1);
    assert.strictEqual(high.body.exceptions[0].device_code, 'H-1');

    const low = await call(base, 'GET', '/api/v1/rounds/exceptions?risk_level=low');
    assert.strictEqual(low.body.exceptions.length, 1);
  } finally {
    await close();
  }
});

test('exceptions by risk level rejects bad value', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status } = await call(base, 'GET', '/api/v1/rounds/exceptions?risk_level=nope');
    assert.strictEqual(status, 400);
  } finally {
    await close();
  }
});

test('area exception statistics aggregates counts', async () => {
  const { base, close } = await startTestServer();
  try {
    await buildRoundWithException(base, { area: 'NORTH', device_code: 'N-1' });
    await buildRoundWithException(base, { area: 'NORTH', device_code: 'N-2' });
    await buildRoundWithException(base, { area: 'SOUTH', device_code: 'S-1' });

    const { status, body } = await call(base, 'GET', '/api/v1/rounds/exceptions/by-area');
    assert.strictEqual(status, 200);
    const north = body.areas.find((a) => a.area === 'NORTH');
    const south = body.areas.find((a) => a.area === 'SOUTH');
    assert.strictEqual(north.total, 2);
    assert.strictEqual(north.fault, 2);
    assert.strictEqual(north.unresolved, 2);
    assert.strictEqual(south.total, 1);
  } finally {
    await close();
  }
});

test('checklist snapshot is immutable to later checklist copies', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    const round = await call(base, 'POST', '/api/v1/rounds', {
      device_id: device.body.id,
      checklist_id: checklist.body.id,
      planned_start_at: '2026-08-10T08:00:00.000Z',
      planned_end_at: '2026-08-10T12:00:00.000Z',
      owner_name: 'Owner',
    });
    // Create a new version with different items.
    await call(base, 'POST', `/api/v1/checklists/${checklist.body.id}/copy`, {
      items: [{ item_key: 'only', label: 'Only item' }],
    });
    // Original round snapshot should still have the original 2 items.
    const fetched = await call(base, 'GET', `/api/v1/rounds/${round.body.id}`);
    assert.strictEqual(fetched.body.checklist_snapshot.items.length, 2);
    assert.strictEqual(fetched.body.checklist_snapshot.version, 1);
  } finally {
    await close();
  }
});
