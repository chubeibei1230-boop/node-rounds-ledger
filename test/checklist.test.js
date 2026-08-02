'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, call, checklistFixture } = require('./helpers');

test('create checklist starts at version 1', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    assert.strictEqual(status, 201);
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.enabled, 1);
    assert.deepStrictEqual(body.items.map((i) => i.item_key), ['pressure', 'noise']);
  } finally {
    await close();
  }
});

test('empty items array is rejected', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/checklists', checklistFixture({ items: [] }));
    assert.strictEqual(status, 400);
    assert.strictEqual(body.details.field, 'items');
  } finally {
    await close();
  }
});

test('duplicate item_key is rejected', async () => {
  const { base, close } = await startTestServer();
  try {
    const payload = checklistFixture({
      items: [
        { item_key: 'a', label: 'A' },
        { item_key: 'a', label: 'A again' },
      ],
    });
    const { status } = await call(base, 'POST', '/api/v1/checklists', payload);
    assert.strictEqual(status, 400);
  } finally {
    await close();
  }
});

test('creating a checklist with an existing name is rejected (use copy)', async () => {
  const { base, close } = await startTestServer();
  try {
    await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    const { status, body } = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    assert.strictEqual(status, 409);
    assert.strictEqual(body.error_code, 'conflict');
  } finally {
    await close();
  }
});

test('copy checklist bumps version and disables the source', async () => {
  const { base, close } = await startTestServer();
  try {
    const created = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    const copy = await call(base, 'POST', `/api/v1/checklists/${created.body.id}/copy`, {
      items: [
        { item_key: 'pressure', label: 'Check pressure' },
        { item_key: 'noise', label: 'Check noise' },
        { item_key: 'temp', label: 'Check temperature' },
      ],
    });
    assert.strictEqual(copy.status, 201);
    assert.strictEqual(copy.body.version, 2);
    assert.strictEqual(copy.body.items.length, 3);

    const source = await call(base, 'GET', `/api/v1/checklists/${created.body.id}`);
    assert.strictEqual(source.body.enabled, 0);
  } finally {
    await close();
  }
});

test('copying a disabled checklist is rejected', async () => {
  const { base, close } = await startTestServer();
  try {
    const created = await call(base, 'POST', '/api/v1/checklists', checklistFixture());
    await call(base, 'POST', `/api/v1/checklists/${created.body.id}/copy`, {});
    // Source is now disabled; copying it again should fail.
    const again = await call(base, 'POST', `/api/v1/checklists/${created.body.id}/copy`, {});
    assert.strictEqual(again.status, 409);
  } finally {
    await close();
  }
});

test('copying a nonexistent checklist returns 404', async () => {
  const { base, close } = await startTestServer();
  try {
    const { status, body } = await call(base, 'POST', '/api/v1/checklists/999/copy', {});
    assert.strictEqual(status, 404);
    assert.strictEqual(body.error_code, 'not_found');
  } finally {
    await close();
  }
});
