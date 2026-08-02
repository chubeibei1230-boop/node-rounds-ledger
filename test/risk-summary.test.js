'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, deviceFixture, checklistFixture } = require('./helpers');

/**
 * Risk summary endpoint: groups by (area, risk_level) and reports open/closed
 * round counts, exception item counts, pending exception counts and a computed
 * overdue flag. All figures reuse existing round/exception data; overdue is
 * derived from planned_end_at and never written back to the database.
 */

const FUTURE = { start: '2099-01-01T08:00:00.000Z', end: '2099-01-01T12:00:00.000Z' };
const PAST = { start: '2020-01-01T08:00:00.000Z', end: '2020-01-01T12:00:00.000Z' };

async function makeDevice(base, overrides) {
  const res = await call(base, 'POST', '/api/v1/devices', deviceFixture(overrides));
  return res.body;
}

async function makeChecklist(base, name) {
  const res = await call(base, 'POST', '/api/v1/checklists', checklistFixture({ checklist_name: name }));
  return res.body;
}

async function makeRound(base, deviceId, checklistId, window) {
  const res = await call(base, 'POST', '/api/v1/rounds', {
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: window.start,
    planned_end_at: window.end,
    owner_name: 'Owner',
  });
  return res.body;
}

function findGroup(summary, area, risk) {
  return summary.find((g) => g.area === area && g.risk_level === risk);
}

test('risk summary counts a plain scheduled round as one open, non-overdue round', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await makeDevice(base, { area: 'A', risk_level: 'high' });
    const cl = await makeChecklist(base, 'CL-A');
    await makeRound(base, device.id, cl.id, FUTURE);

    const { status, body } = await call(base, 'GET', '/api/v1/rounds/risk-summary');
    assert.strictEqual(status, 200);
    const g = findGroup(body.summary, 'A', 'high');
    assert.strictEqual(g.open_rounds, 1);
    assert.strictEqual(g.closed_rounds, 0);
    assert.strictEqual(g.exception_items, 0);
    assert.strictEqual(g.pending_exceptions, 0);
    assert.strictEqual(g.overdue, false);
    assert.strictEqual(g.overdue_rounds, 0);
  } finally {
    await close();
  }
});

test('risk summary reports exception items and pending exceptions from a fault submission', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await makeDevice(base, { area: 'B', risk_level: 'medium' });
    const cl = await makeChecklist(base, 'CL-B');
    const round = await makeRound(base, device.id, cl.id, FUTURE);
    await call(base, 'POST', `/api/v1/rounds/${round.id}/start`);
    await call(base, 'POST', `/api/v1/rounds/${round.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'fault' },
        { item_key: 'noise', result: 'attention' },
      ],
    });

    const { body } = await call(base, 'GET', '/api/v1/rounds/risk-summary');
    const g = findGroup(body.summary, 'B', 'medium');
    assert.strictEqual(g.open_rounds, 1); // submitted is still not closed
    assert.strictEqual(g.exception_items, 2);
    assert.strictEqual(g.pending_exceptions, 2);
    assert.strictEqual(g.overdue, false);
  } finally {
    await close();
  }
});

test('risk summary reflects pending drop after some exceptions are resolved', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await makeDevice(base, { area: 'C', risk_level: 'high' });
    const cl = await makeChecklist(base, 'CL-C');
    const round = await makeRound(base, device.id, cl.id, FUTURE);
    await call(base, 'POST', `/api/v1/rounds/${round.id}/start`);
    await call(base, 'POST', `/api/v1/rounds/${round.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'fault' },
        { item_key: 'noise', result: 'fault' },
      ],
    });
    // Resolve only review 1.
    await call(base, 'POST', `/api/v1/rounds/${round.id}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'R',
    });

    const { body } = await call(base, 'GET', '/api/v1/rounds/risk-summary');
    const g = findGroup(body.summary, 'C', 'high');
    assert.strictEqual(g.exception_items, 2); // fault result items unchanged
    assert.strictEqual(g.pending_exceptions, 1); // one still pending
  } finally {
    await close();
  }
});

test('risk summary counts a closed round separately and clears pending', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await makeDevice(base, { area: 'D', risk_level: 'low' });
    const cl = await makeChecklist(base, 'CL-D');
    const round = await makeRound(base, device.id, cl.id, FUTURE);
    await call(base, 'POST', `/api/v1/rounds/${round.id}/start`);
    await call(base, 'POST', `/api/v1/rounds/${round.id}/results`, {
      results: [
        { item_key: 'pressure', result: 'fault' },
        { item_key: 'noise', result: 'normal' },
      ],
    });
    await call(base, 'POST', `/api/v1/rounds/${round.id}/reviews/1`, {
      review_status: 'resolved',
      reviewer_name: 'R',
    });
    await call(base, 'POST', `/api/v1/rounds/${round.id}/close`);

    const { body } = await call(base, 'GET', '/api/v1/rounds/risk-summary');
    const g = findGroup(body.summary, 'D', 'low');
    assert.strictEqual(g.open_rounds, 0);
    assert.strictEqual(g.closed_rounds, 1);
    assert.strictEqual(g.exception_items, 1); // the fault item still counted historically
    assert.strictEqual(g.pending_exceptions, 0);
    assert.strictEqual(g.overdue, false);
  } finally {
    await close();
  }
});

test('risk summary marks overdue for an open round whose planned_end_at is past', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await makeDevice(base, { area: 'E', risk_level: 'high' });
    const cl = await makeChecklist(base, 'CL-E');
    await makeRound(base, device.id, cl.id, PAST);

    const { body } = await call(base, 'GET', '/api/v1/rounds/risk-summary');
    const g = findGroup(body.summary, 'E', 'high');
    assert.strictEqual(g.open_rounds, 1);
    assert.strictEqual(g.overdue, true);
    assert.strictEqual(g.overdue_rounds, 1);
  } finally {
    await close();
  }
});

test('overdue query does not mutate the stored round_status', async () => {
  const { base, close } = await startTestServer();
  try {
    const device = await makeDevice(base, { area: 'F', risk_level: 'medium' });
    const cl = await makeChecklist(base, 'CL-F');
    const round = await makeRound(base, device.id, cl.id, PAST);

    await call(base, 'GET', '/api/v1/rounds/risk-summary');
    // The round itself must still be 'scheduled' — overdue is computed, not persisted.
    const detail = await call(base, 'GET', `/api/v1/rounds/${round.id}`);
    assert.strictEqual(detail.body.round_status, 'scheduled');
  } finally {
    await close();
  }
});

test('risk summary supports area and risk_level filters', async () => {
  const { base, close } = await startTestServer();
  try {
    const highA = await makeDevice(base, { device_code: 'X1', area: 'Z', risk_level: 'high' });
    const lowA = await makeDevice(base, { device_code: 'X2', area: 'Z', risk_level: 'low' });
    const highB = await makeDevice(base, { device_code: 'X3', area: 'Y', risk_level: 'high' });
    const cl1 = await makeChecklist(base, 'CL-1');
    const cl2 = await makeChecklist(base, 'CL-2');
    const cl3 = await makeChecklist(base, 'CL-3');
    await makeRound(base, highA.id, cl1.id, FUTURE);
    await makeRound(base, lowA.id, cl2.id, FUTURE);
    await makeRound(base, highB.id, cl3.id, FUTURE);

    // Filter by area only.
    const areaOnly = await call(base, 'GET', '/api/v1/rounds/risk-summary?area=Z');
    assert.strictEqual(areaOnly.body.summary.length, 2);
    assert.ok(areaOnly.body.summary.every((g) => g.area === 'Z'));

    // Filter by area + risk_level.
    const both = await call(base, 'GET', '/api/v1/rounds/risk-summary?area=Z&risk_level=high');
    assert.strictEqual(both.body.summary.length, 1);
    assert.strictEqual(both.body.summary[0].risk_level, 'high');

    // Filter by risk_level only across areas.
    const riskOnly = await call(base, 'GET', '/api/v1/rounds/risk-summary?risk_level=high');
    assert.strictEqual(riskOnly.body.summary.length, 2);
    assert.ok(riskOnly.body.summary.every((g) => g.risk_level === 'high'));
  } finally {
    await close();
  }
});

test('risk summary rejects an invalid risk_level filter', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'GET', '/api/v1/rounds/risk-summary?risk_level=nope');
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error_code, 'validation_error');
  } finally {
    await close();
  }
});
