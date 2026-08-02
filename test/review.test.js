'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, deviceFixture, checklistFixture } = require('./helpers');

/**
 * Exception-review gating: closing a round requires every auto-generated
 * exception review to be ignored or resolved. pending/confirmed still block.
 */

// Checklist with three items so we can produce multiple faults in one round.
function threeItemChecklist() {
  return checklistFixture({
    items: [
      { item_key: 'pressure', label: 'Check pressure' },
      { item_key: 'noise', label: 'Check noise' },
      { item_key: 'temp', label: 'Check temperature' },
    ],
  });
}

function roundPayload(deviceId, checklistId) {
  return {
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: '2026-08-10T08:00:00.000Z',
    planned_end_at: '2026-08-10T12:00:00.000Z',
    owner_name: 'Alice',
  };
}

/** Seed a round submitted with two faults (-> two pending reviews, ids 1 and 2). */
async function seedRoundWithTwoFaults(base) {
  const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
  const checklist = await call(base, 'POST', '/api/v1/checklists', threeItemChecklist());
  const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));
  const id = round.body.id;
  await call(base, 'POST', `/api/v1/rounds/${id}/start`);
  await call(base, 'POST', `/api/v1/rounds/${id}/results`, {
    results: [
      { item_key: 'pressure', result: 'fault', remark: 'leak' },
      { item_key: 'noise', result: 'normal' },
      { item_key: 'temp', result: 'fault', remark: 'overheating' },
    ],
  });
  return { roundId: id, area: device.body.area };
}

test('fault result auto-generates a pending exception review', async () => {
  const { base, close } = await startTestServer();
  try {
    const { roundId, area } = await seedRoundWithTwoFaults(base);
    const open = await call(base, 'GET', `/api/v1/rounds/open?area=${area}`);
    const row = open.body.rounds.find((r) => r.id === roundId);
    // Two faults -> two pending exceptions.
    assert.strictEqual(row.pending_exceptions, 2);
  } finally {
    await close();
  }
});

test('round with unreviewed exceptions cannot be closed', async () => {
  const { base, close } = await startTestServer();
  try {
    const { roundId } = await seedRoundWithTwoFaults(base);
    const blocked = await call(base, 'POST', `/api/v1/rounds/${roundId}/close`);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.body.error_code, 'conflict');
    assert.strictEqual(blocked.body.details.pending_exceptions, 2);
  } finally {
    await close();
  }
});

test('partially reviewed exceptions still block close', async () => {
  const { base, close } = await startTestServer();
  try {
    const { roundId } = await seedRoundWithTwoFaults(base);
    // Resolve only the first exception; the second remains pending.
    await call(base, 'POST', `/api/v1/rounds/${roundId}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'Bob',
    });
    const blocked = await call(base, 'POST', `/api/v1/rounds/${roundId}/close`);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.body.details.pending_exceptions, 1);
  } finally {
    await close();
  }
});

test('confirmed conclusion does not clear an exception (still blocks close)', async () => {
  const { base, close } = await startTestServer();
  try {
    const { roundId } = await seedRoundWithTwoFaults(base);
    await call(base, 'POST', `/api/v1/rounds/${roundId}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'Bob',
    });
    // Mark the second as confirmed — a confirmed problem is not yet cleared.
    await call(base, 'POST', `/api/v1/rounds/${roundId}/reviews/2`, {
      review_status: 'confirmed',
      reviewer_name: 'Bob',
    });
    const blocked = await call(base, 'POST', `/api/v1/rounds/${roundId}/close`);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.body.details.pending_exceptions, 1);
  } finally {
    await close();
  }
});

test('round closes once all exceptions are ignored or resolved', async () => {
  const { base, close } = await startTestServer();
  try {
    const { roundId, area } = await seedRoundWithTwoFaults(base);
    await call(base, 'POST', `/api/v1/rounds/${roundId}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'Bob',
      review_comment: 'gasket replaced',
    });
    await call(base, 'POST', `/api/v1/rounds/${roundId}/reviews/2`, {
      review_status: 'ignored',
      reviewer_name: 'Bob',
      review_comment: 'sensor noise, acceptable',
    });

    const closed = await call(base, 'POST', `/api/v1/rounds/${roundId}/close`);
    assert.strictEqual(closed.status, 200);
    assert.strictEqual(closed.body.round_status, 'closed');

    // Closed round no longer appears in open-by-area.
    const open = await call(base, 'GET', `/api/v1/rounds/open?area=${area}`);
    assert.strictEqual(open.body.rounds.find((r) => r.id === roundId), undefined);
  } finally {
    await close();
  }
});

test('closing cannot bypass in_progress/submitted (scheduled -> close rejected)', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture());
    const checklist = await call(base, 'POST', '/api/v1/checklists', threeItemChecklist());
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));
    const blocked = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/close`);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.body.error_code, 'invalid_state_transition');
    assert.deepStrictEqual(blocked.body.details.allowed_next, ['in_progress']);
  } finally {
    await close();
  }
});
