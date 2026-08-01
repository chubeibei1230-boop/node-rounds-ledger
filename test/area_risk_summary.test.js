const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request } = require('./helpers');

let server;
let baseUrl;
let overdueRoundId;

const RESULTS_ALL_NORMAL = [
  { item_key: 'a', result: 'normal' },
  { item_key: 'b', result: 'normal' },
  { item_key: 'c', result: 'normal' },
];

async function createDevice(deviceCode, area, riskLevel) {
  const { body } = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: deviceCode,
    device_name: deviceCode,
    area,
    device_type: 'pump',
    risk_level: riskLevel,
  });
  return body.id;
}

async function createRound(deviceId, checklistId, start, end) {
  const { body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: start,
    planned_end_at: end,
    owner_name: '值班员',
  });
  return body.id;
}

async function submitRound(roundId, results) {
  await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/start`);
  const { body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, { results });
  return body;
}

async function review(exceptionId, reviewResult) {
  await request(baseUrl, 'POST', `/api/v1/exceptions/${exceptionId}/review`, {
    reviewer_name: '主管',
    review_result: reviewResult,
  });
}

before(async () => {
  ({ server, baseUrl } = await startServer());

  const eastHigh = await createDevice('EH-01', '东区', 'high');
  const eastLow = await createDevice('EL-01', '东区', 'low');
  const westHigh = await createDevice('WH-01', '西区', 'high');

  const checklist = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '汇总测试清单',
    device_type: 'pump',
    items: [
      { item_key: 'a', item_name: '项A' },
      { item_key: 'b', item_name: '项B' },
      { item_key: 'c', item_name: '项C' },
    ],
    cycle_days: 7,
  });
  const checklistId = checklist.body.id;

  // 东区 high R1：已关闭，1 个 fault 已 resolved
  const r1 = await createRound(eastHigh, checklistId, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  const s1 = await submitRound(r1, [
    { item_key: 'a', result: 'fault', note: '故障' },
    { item_key: 'b', result: 'normal' },
    { item_key: 'c', result: 'normal' },
  ]);
  await review(s1.exceptions[0].id, 'resolved');
  await request(baseUrl, 'POST', `/api/v1/rounds/${r1}/close`);

  // 东区 high R2：超期未关闭，fault 已 resolved、attention 待复核
  const r2 = await createRound(eastHigh, checklistId, '2026-07-05T00:00:00Z', '2026-07-10T00:00:00Z');
  overdueRoundId = r2;
  const s2 = await submitRound(r2, [
    { item_key: 'a', result: 'fault', note: '故障' },
    { item_key: 'b', result: 'attention', note: '关注' },
    { item_key: 'c', result: 'normal' },
  ]);
  await review(s2.exceptions[0].id, 'resolved');

  // 东区 high R3：未超期，scheduled，无异常
  await createRound(eastHigh, checklistId, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z');

  // 东区 low R4：未超期，已提交全部正常
  const r4 = await createRound(eastLow, checklistId, '2030-02-01T00:00:00Z', '2030-02-02T00:00:00Z');
  await submitRound(r4, RESULTS_ALL_NORMAL);

  // 西区 high R5：已关闭（计划时间已过但关闭不计超期），fault 已 ignored
  const r5 = await createRound(westHigh, checklistId, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  const s5 = await submitRound(r5, [
    { item_key: 'a', result: 'fault', note: '故障' },
    { item_key: 'b', result: 'normal' },
    { item_key: 'c', result: 'normal' },
  ]);
  await review(s5.exceptions[0].id, 'ignored');
  await request(baseUrl, 'POST', `/api/v1/rounds/${r5}/close`);
});

after(() => server.close());

test('全量汇总：正常、异常、待复核、已关闭与超期组合', async () => {
  const { status, body } = await request(baseUrl, 'GET', '/api/v1/stats/area-risk-summary');
  assert.equal(status, 200);
  assert.equal(body.summary.length, 3);

  const eastHigh = body.summary.find((g) => g.area === '东区' && g.risk_level === 'high');
  assert.deepEqual(eastHigh, {
    area: '东区',
    risk_level: 'high',
    open_rounds: 2,
    closed_rounds: 1,
    abnormal_items: 3,
    pending_exceptions: 1,
    overdue_rounds: 1,
    overdue: true,
  });

  const eastLow = body.summary.find((g) => g.area === '东区' && g.risk_level === 'low');
  assert.deepEqual(eastLow, {
    area: '东区',
    risk_level: 'low',
    open_rounds: 1,
    closed_rounds: 0,
    abnormal_items: 0,
    pending_exceptions: 0,
    overdue_rounds: 0,
    overdue: false,
  });

  const westHigh = body.summary.find((g) => g.area === '西区' && g.risk_level === 'high');
  assert.deepEqual(westHigh, {
    area: '西区',
    risk_level: 'high',
    open_rounds: 0,
    closed_rounds: 1,
    abnormal_items: 1,
    pending_exceptions: 0,
    overdue_rounds: 0,
    overdue: false,
  });
});

test('按 area 过滤', async () => {
  const { status, body } = await request(baseUrl, 'GET', '/api/v1/stats/area-risk-summary?area=东区');
  assert.equal(status, 200);
  assert.equal(body.summary.length, 2);
  assert.ok(body.summary.every((g) => g.area === '东区'));
});

test('按 risk_level 过滤', async () => {
  const { status, body } = await request(
    baseUrl,
    'GET',
    '/api/v1/stats/area-risk-summary?risk_level=high'
  );
  assert.equal(status, 200);
  assert.equal(body.summary.length, 2);
  assert.ok(body.summary.every((g) => g.risk_level === 'high'));
});

test('按 area + risk_level 组合过滤', async () => {
  const { status, body } = await request(
    baseUrl,
    'GET',
    '/api/v1/stats/area-risk-summary?area=东区&risk_level=high'
  );
  assert.equal(status, 200);
  assert.equal(body.summary.length, 1);
  assert.equal(body.summary[0].overdue, true);
});

test('risk_level 取值非法返回 400', async () => {
  const { status, body } = await request(
    baseUrl,
    'GET',
    '/api/v1/stats/area-risk-summary?risk_level=extreme'
  );
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('超期仅在查询时计算，不改写轮次状态', async () => {
  const summary = await request(baseUrl, 'GET', '/api/v1/stats/area-risk-summary?area=东区&risk_level=high');
  assert.equal(summary.body.summary[0].overdue, true);

  const { status, body } = await request(baseUrl, 'GET', `/api/v1/rounds/${overdueRoundId}`);
  assert.equal(status, 200);
  assert.equal(body.round_status, 'submitted');
});
