const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request } = require('./helpers');

let server;
let baseUrl;

before(async () => {
  ({ server, baseUrl } = await startServer());
});

after(() => server.close());

test('创建设备成功，字段为 snake_case', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'PUMP-001',
    device_name: '一号循环泵',
    area: '东区',
    device_type: 'pump',
    risk_level: 'high',
    maintenance_note: '每季度加油',
  });
  assert.equal(status, 201);
  assert.equal(body.device_code, 'PUMP-001');
  assert.equal(body.device_name, '一号循环泵');
  assert.equal(body.area, '东区');
  assert.equal(body.device_type, 'pump');
  assert.equal(body.risk_level, 'high');
  assert.equal(body.enabled, 1);
  assert.equal(body.maintenance_note, '每季度加油');
  assert.ok(body.created_at);
});

test('创建设备缺少必填字段返回固定错误格式', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'PUMP-002',
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(typeof body.message, 'string');
  assert.ok(Array.isArray(body.details.missing_fields));
});

test('设备 risk_level 取值非法被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'PUMP-003',
    device_name: '三号泵',
    area: '东区',
    device_type: 'pump',
    risk_level: 'extreme',
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('设备编码重复返回 409', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'PUMP-001',
    device_name: '重复编码',
    area: '西区',
    device_type: 'pump',
    risk_level: 'low',
  });
  assert.equal(status, 409);
  assert.equal(body.error_code, 'CONFLICT');
});

test('创建巡检清单成功', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '循环泵日常巡检',
    device_type: 'pump',
    items: [
      { item_key: 'vibration', item_name: '振动检查' },
      { item_key: 'temperature', item_name: '温度检查' },
      { item_key: 'leakage', item_name: '泄漏检查' },
    ],
    cycle_days: 7,
  });
  assert.equal(status, 201);
  assert.equal(body.version, 1);
  assert.equal(body.items.length, 3);
  assert.equal(body.items[0].item_key, 'vibration');
});

test('清单 items 为空数组被拒绝', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '空清单',
    device_type: 'pump',
    items: [],
    cycle_days: 7,
  });
  assert.equal(status, 400);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
});

test('同名同版本清单冲突', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '循环泵日常巡检',
    device_type: 'pump',
    items: [{ item_key: 'vibration', item_name: '振动检查' }],
    cycle_days: 7,
    version: 1,
  });
  assert.equal(status, 409);
  assert.equal(body.error_code, 'CONFLICT');
});

test('复制清单自动生成递增版本号，旧版本自动禁用', async () => {
  const createRes = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '风机巡检',
    device_type: 'fan',
    items: [{ item_key: 'blade', item_name: '叶片检查' }],
    cycle_days: 30,
  });
  const sourceId = createRes.body.id;
  assert.equal(createRes.body.enabled, 1);

  const copy1 = await request(baseUrl, 'POST', `/api/v1/checklists/${sourceId}/copies`, {});
  assert.equal(copy1.status, 201);
  assert.equal(copy1.body.version, 2);
  assert.equal(copy1.body.enabled, 1);
  assert.equal(copy1.body.checklist_name, '风机巡检');
  assert.deepEqual(copy1.body.items, [{ item_key: 'blade', item_name: '叶片检查' }]);

  const copy2 = await request(baseUrl, 'POST', `/api/v1/checklists/${copy1.body.id}/copies`, {
    cycle_days: 14,
    items: [
      { item_key: 'blade', item_name: '叶片检查' },
      { item_key: 'motor', item_name: '电机检查' },
    ],
  });
  assert.equal(copy2.status, 201);
  assert.equal(copy2.body.version, 3);
  assert.equal(copy2.body.cycle_days, 14);
  assert.equal(copy2.body.items.length, 2);
});

test('已禁用的清单不能被复制', async () => {
  const createRes = await request(baseUrl, 'POST', '/api/v1/checklists', {
    checklist_name: '空压机巡检',
    device_type: 'compressor',
    items: [{ item_key: 'pressure', item_name: '气压检查' }],
    cycle_days: 15,
  });
  const sourceId = createRes.body.id;
  const copy = await request(baseUrl, 'POST', `/api/v1/checklists/${sourceId}/copies`, {});
  assert.equal(copy.status, 201);

  const { status, body } = await request(
    baseUrl,
    'POST',
    `/api/v1/checklists/${sourceId}/copies`,
    {}
  );
  assert.equal(status, 409);
  assert.equal(body.error_code, 'CONFLICT');
  assert.ok('message' in body);
  assert.ok('details' in body);
});

test('复制不存在的清单返回 404', async () => {
  const { status, body } = await request(baseUrl, 'POST', '/api/v1/checklists/9999/copies', {});
  assert.equal(status, 404);
  assert.equal(body.error_code, 'NOT_FOUND');
});

test('停用设备', async () => {
  const createRes = await request(baseUrl, 'POST', '/api/v1/devices', {
    device_code: 'VALVE-001',
    device_name: '一号阀门',
    area: '西区',
    device_type: 'valve',
    risk_level: 'low',
  });
  const { status, body } = await request(
    baseUrl,
    'PATCH',
    `/api/v1/devices/${createRes.body.id}/disable`
  );
  assert.equal(status, 200);
  assert.equal(body.enabled, 0);
});

test('未知接口返回 404 固定格式', async () => {
  const { status, body } = await request(baseUrl, 'GET', '/api/v1/unknown');
  assert.equal(status, 404);
  assert.equal(body.error_code, 'NOT_FOUND');
  assert.ok('message' in body);
  assert.ok('details' in body);
});
