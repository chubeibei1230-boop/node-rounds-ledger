'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, deviceFixture, checklistFixture } = require('./helpers');

/**
 * Snapshot semantics: when a round is generated it freezes the checklist
 * version + items. Later checklist copies / edits must not affect historical
 * rounds — neither their stored snapshot nor how their results are validated.
 */

function roundPayload(deviceId, checklistId, overrides = {}) {
  return {
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: '2026-08-10T08:00:00.000Z',
    planned_end_at: '2026-08-10T12:00:00.000Z',
    owner_name: 'Alice',
    ...overrides,
  };
}

test('generated round snapshot carries name, version, device_type and items array', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));

    const snap = round.body.checklist_snapshot;
    assert.strictEqual(snap.checklist_name, 'Pump Routine');
    assert.strictEqual(snap.version, 1);
    assert.strictEqual(snap.device_type, 'pump');
    // items MUST stay a JSON array (never a comma-joined string).
    assert.ok(Array.isArray(snap.items));
    assert.deepStrictEqual(snap.items.map((i) => i.item_key), ['pressure', 'noise']);
  } finally {
    await close();
  }
});

test('GET round detail returns checklist_snapshot with items as an array', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));

    const detail = await call(base, 'GET', `/api/v1/rounds/${round.body.id}`);
    assert.strictEqual(detail.status, 200);
    assert.ok(Array.isArray(detail.body.checklist_snapshot.items));
    assert.strictEqual(typeof detail.body.checklist_snapshot.items[0], 'object');
    assert.strictEqual(detail.body.checklist_snapshot.items[0].item_key, 'pressure');
  } finally {
    await close();
  }
});

test('old round is unaffected by a new checklist version and still validates by old snapshot', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture());

    // Old round frozen at version 1 with items [pressure, noise].
    const oldRound = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));

    // Checklist evolves to version 2 with a completely different single item.
    await call(base, 'POST', `/api/v1/checklists/${checklist.body.id}/copy`, {
      items: [{ item_key: 'vibration', label: 'Check vibration' }],
    });

    // Old round snapshot is untouched.
    const detail = await call(base, 'GET', `/api/v1/rounds/${oldRound.body.id}`);
    assert.strictEqual(detail.body.checklist_snapshot.version, 1);
    assert.deepStrictEqual(
      detail.body.checklist_snapshot.items.map((i) => i.item_key),
      ['pressure', 'noise'],
    );

    // Submitting the old round must still be validated against the OLD snapshot.
    await call(base, 'POST', `/api/v1/rounds/${oldRound.body.id}/start`);

    // Submitting the NEW version's item is rejected — old snapshot governs.
    const wrong = await call(base, 'POST', `/api/v1/rounds/${oldRound.body.id}/results`, {
      results: [{ item_key: 'vibration', result: 'normal' }],
    });
    assert.strictEqual(wrong.status, 400);

    // Submitting the OLD items succeeds.
    const ok = await call(base, 'POST', `/api/v1/rounds/${oldRound.body.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'normal' },
        { item_key: 'noise', result: 'normal' },
      ],
    });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.body.round.round_status, 'submitted');
  } finally {
    await close();
  }
});

test('rounds generated before and after a version bump keep distinct snapshots', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture());

    const roundV1 = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));

    const v2 = await call(base, 'POST', `/api/v1/checklists/${checklist.body.id}/copy`, {
      items: [
        { item_key: 'pressure', label: 'Check pressure' },
        { item_key: 'noise', label: 'Check noise' },
        { item_key: 'temp', label: 'Check temperature' },
      ],
    });

    const roundV2 = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, v2.body.id));

    const detailV1 = await call(base, 'GET', `/api/v1/rounds/${roundV1.body.id}`);
    const detailV2 = await call(base, 'GET', `/api/v1/rounds/${roundV2.body.id}`);

    assert.strictEqual(detailV1.body.checklist_snapshot.version, 1);
    assert.strictEqual(detailV1.body.checklist_snapshot.items.length, 2);
    assert.strictEqual(detailV2.body.checklist_snapshot.version, 2);
    assert.strictEqual(detailV2.body.checklist_snapshot.items.length, 3);
  } finally {
    await close();
  }
});
