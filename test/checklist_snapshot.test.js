const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request } = require('./helpers');

let server;
let baseUrl;
let deviceId;
let checklistId;
let checklistV2Id;
let roundId;

before(async () => {
  ({ server, baseUrl } = await startServer());

  const device = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'SNAP-PUMP-01',
    device_name: '快照测试泵',
    area: '南区',
    device_type: 'pump',
    risk_level: 'medium',
  });
  deviceId = device.body.id;

  const checklist = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '快照测试清单',
    device_type: 'pump',
    items: [
      { item_key: 'a', item_name: '检查项A' },
      { item_key: 'b', item_name: '检查项B' },
    ],
    cycle_days: 7,
  });
  checklistId = checklist.body.id;
});

after(() => server.close());

test('生成轮次时保存清单快照', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: '2026-08-01T00:00:00Z',
    planned_end_at: '2026-08-02T00:00:00Z',
    owner_name: '张三',
  });
  assert.equal(status, 201);
  const snapshot = body.checklist_snapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.checklist_name, '快照测试清单');
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.device_type, 'pump');
  assert.ok(Array.isArray(snapshot.items));
  assert.deepEqual(snapshot.items, [
    { item_key: 'a', item_name: '检查项A' },
    { item_key: 'b', item_name: '检查项B' },
  ]);
  roundId = body.id;
});

test('复制新版本清单后，旧轮次详情仍返回旧快照', async () => {
  const copy = await request(baseUrl, 'POST', `/api/v1/checklists/${checklistId}/copies`, {
    items: [
      { item_key: 'a', item_name: '检查项A' },
      { item_key: 'b', item_name: '检查项B' },
      { item_key: 'c', item_name: '检查项C' },
    ],
  });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.version, 2);
  checklistV2Id = copy.body.id;

  const { status, body } = await request(baseUrl, 'GET', `/api/v1/rounds/${roundId}`);
  assert.equal(status, 200);
  assert.equal(body.checklist_snapshot.version, 1);
  assert.ok(Array.isArray(body.checklist_snapshot.items));
  assert.equal(body.checklist_snapshot.items.length, 2);
  assert.equal(body.checklist_snapshot.items[0].item_key, 'a');
});

test('旧轮次按旧快照校验：按新版本 3 项提交被拒绝', async () => {
  await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/start`);
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'a', result: 'normal' },
      { item_key: 'b', result: 'normal' },
      { item_key: 'c', result: 'normal' },
    ],
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(body.details.expected_count, 2);
  assert.equal(body.details.actual_count, 3);
});

test('旧轮次按旧快照提交成功', async () => {
  const { status, body } = await request(baseUrl, 'POST', `/api/v1/rounds/${roundId}/submit`, {
    results: [
      { item_key: 'a', result: 'normal' },
      { item_key: 'b', result: 'attention', note: '轻微异响' },
    ],
  });
  assert.equal(status, 200);
  assert.equal(body.round_status, 'submitted');
  assert.equal(body.results.length, 2);
  assert.equal(body.checklist_snapshot.version, 1);
});

test('新轮次使用新版本清单快照', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/rounds', {
    device_id: deviceId,
    checklist_id: checklistV2Id,
    planned_start_at: '2026-08-10T00:00:00Z',
    planned_end_at: '2026-08-11T00:00:00Z',
    owner_name: '李四',
  });
  assert.equal(status, 201);
  assert.equal(body.checklist_snapshot.version, 2);
  assert.equal(body.checklist_snapshot.items.length, 3);
});
