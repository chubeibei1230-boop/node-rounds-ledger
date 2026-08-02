'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, deviceFixture, checklistFixture } = require('./helpers');

/** Create a device + checklist and return their ids. */
async function seed(base, deviceOverrides, checklistOverrides) {
  const device = await call(base, 'POST', '/api/v1/devices', deviceFixture(deviceOverrides));
  const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture(checklistOverrides));
  return { deviceId: device.body.id, checklistId: checklist.body.id };
}

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

test('generate round stores checklist snapshot in scheduled state', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const { status, body } = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    assert.strictEqual(status, 201);
    assert.strictEqual(body.round_status, 'scheduled');
    assert.strictEqual(body.checklist_snapshot.version, 1);
    assert.strictEqual(body.checklist_snapshot.items.length, 2);
  } finally {
    await close();
  }
});

test('generate round rejects disabled device with 409', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    await call(base, 'POST', `/api/v1/devices/${deviceId}/disable`);
    const { status, body } = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    assert.strictEqual(status, 409);
    assert.strictEqual(body.error_code, 'conflict');
  } finally {
    await close();
  }
});

test('generate round rejects device_type mismatch', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await call(base, 'POST', '/api/v1/devices', deviceFixture({ device_type: 'valve' }));
    const checklist = await call(base, 'POST', '/api/v1/checklists', checklistFixture({ device_type: 'pump' }));
    const { status } = await call(base, 'POST', '/api/v1/rounds', roundPayload(device.body.id, checklist.body.id));
    assert.strictEqual(status, 409);
  } finally {
    await close();
  }
});

test('generate round rejects planned_end before planned_start', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const { status, body } = await call(
      base,
      'POST',
      '/api/v1/rounds',
      roundPayload(deviceId, checklistId, {
        planned_start_at: '2026-08-10T12:00:00.000Z',
        planned_end_at: '2026-08-10T08:00:00.000Z',
      }),
    );
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error_code, 'validation_error');
  } finally {
    await close();
  }
});

test('scheduled round cannot jump straight to closed', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    const { status, body } = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/close`);
    assert.strictEqual(status, 409);
    assert.strictEqual(body.error_code, 'invalid_state_transition');
    assert.deepStrictEqual(body.details.allowed_next, ['in_progress']);
  } finally {
    await close();
  }
});

test('full happy path: start -> submit(all normal) -> close', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    const id = round.body.id;

    const started = await call(base, 'POST', `/api/v1/rounds/${id}/start`);
    assert.strictEqual(started.body.round_status, 'in_progress');

    const submitted = await call(base, 'POST', `/api/v1/rounds/${id}/results`, {
      results: [
        { item_key: 'pressure', result: 'normal' },
        { item_key: 'noise', result: 'normal' },
      ],
    });
    assert.strictEqual(submitted.status, 201);
    assert.strictEqual(submitted.body.round.round_status, 'submitted');

    const closed = await call(base, 'POST', `/api/v1/rounds/${id}/close`);
    assert.strictEqual(closed.status, 200);
    assert.strictEqual(closed.body.round_status, 'closed');
  } finally {
    await close();
  }
});

test('cannot start a round twice (in_progress -> in_progress illegal)', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    const again = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.error_code, 'invalid_state_transition');
  } finally {
    await close();
  }
});

test('submit rejects wrong result count', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    const { status, body } = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
      results: [{ item_key: 'pressure', result: 'normal' }],
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.details.expected, 2);
  } finally {
    await close();
  }
});

test('submit rejects mismatched item_key order', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    const { status } = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
      results: [
        { item_key: 'noise', result: 'normal' },
        { item_key: 'pressure', result: 'normal' },
      ],
    });
    assert.strictEqual(status, 400);
  } finally {
    await close();
  }
});

test('submit rejects renamed item_key at correct position', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    // Same count and order, but the second item_key is renamed.
    const { status, body } = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'normal' },
        { item_key: 'noise_renamed', result: 'normal' },
      ],
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.details.expected_item_key, 'noise');
    assert.strictEqual(body.details.received_item_key, 'noise_renamed');
  } finally {
    await close();
  }
});

test('submit rejects extra (over-supplied) result item', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    const { status, body } = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'normal' },
        { item_key: 'noise', result: 'normal' },
        { item_key: 'extra', result: 'normal' },
      ],
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.details.expected, 2);
    assert.strictEqual(body.details.received, 3);
  } finally {
    await close();
  }
});

test('generate round allows planned_end equal to planned_start', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const { status, body } = await call(
      base,
      'POST',
      '/api/v1/rounds',
      roundPayload(deviceId, checklistId, {
        planned_start_at: '2026-08-10T08:00:00.000Z',
        planned_end_at: '2026-08-10T08:00:00.000Z',
      }),
    );
    assert.strictEqual(status, 201);
    assert.strictEqual(body.round_status, 'scheduled');
  } finally {
    await close();
  }
});

test('invalid result value is rejected', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    await call(base, 'POST', `/api/v1/rounds/${round.body.id}/start`);
    const { status } = await call(base, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'broken' },
        { item_key: 'noise', result: 'normal' },
      ],
    });
    assert.strictEqual(status, 400);
  } finally {
    await close();
  }
});

test('fault result blocks close until exception is resolved', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    const id = round.body.id;
    await call(base, 'POST', `/api/v1/rounds/${id}/start`);
    await call(base, 'POST', `/api/v1/rounds/${id}/results`, {
      results: [
        { item_key: 'pressure', result: 'fault', remark: 'leaking' },
        { item_key: 'noise', result: 'normal' },
      ],
    });

    // Closing now must fail.
    const blocked = await call(base, 'POST', `/api/v1/rounds/${id}/close`);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.body.details.pending_exceptions, 1);

    // Find the pending review via open-by-area query and resolve it.
    const open = await call(base, 'GET', '/api/v1/rounds/open?area=B1');
    assert.strictEqual(open.body.rounds[0].pending_exceptions, 1);

    // Fetch reviews by hitting exceptions query, then resolve review id 1.
    const resolved = await call(base, 'POST', `/api/v1/rounds/${id}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'Bob',
      review_comment: 'gasket replaced',
    });
    assert.strictEqual(resolved.status, 200);
    assert.strictEqual(resolved.body.review_status, 'resolved');

    const nowClosed = await call(base, 'POST', `/api/v1/rounds/${id}/close`);
    assert.strictEqual(nowClosed.status, 200);
    assert.strictEqual(nowClosed.body.round_status, 'closed');
  } finally {
    await close();
  }
});

test('confirmed exception still blocks close', async () => {
  const { base, close } = await startTestServer();
  try {
    const { deviceId, checklistId } = await seed(base);
    const round = await call(base, 'POST', '/api/v1/rounds', roundPayload(deviceId, checklistId));
    const id = round.body.id;
    await call(base, 'POST', `/api/v1/rounds/${id}/start`);
    await call(base, 'POST', `/api/v1/rounds/${id}/results`, {
      results: [
        { item_key: 'pressure', result: 'attention' },
        { item_key: 'noise', result: 'normal' },
      ],
    });
    await call(base, 'POST', `/api/v1/rounds/${id}/reviews/1`, {
      review_status: 'confirmed',
      reviewer_name: 'Bob',
    });
    const blocked = await call(base, 'POST', `/api/v1/rounds/${id}/close`);
    assert.strictEqual(blocked.status, 409);
  } finally {
    await close();
  }
});
