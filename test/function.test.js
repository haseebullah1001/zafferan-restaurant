import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { newDb } from 'pg-mem';

import { createApp } from '../src/app.js';
import { initializeDatabase } from '../src/db.js';
import { createFetchHandler } from '../src/function.js';

let db;
let handler;

before(async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  db = await initializeDatabase(new adapter.Pool());
  handler = createFetchHandler(createApp(db));
});

after(async () => db.close());

test('Neon function adapter serves the health endpoint', async () => {
  const response = await handler.fetch(new Request('https://api.example.com/health'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('Neon function adapter accepts JSON requests', async () => {
  const response = await handler.fetch(new Request('https://api.example.com/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0700000000', password: '123456' }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.user.phone, '0700000000');
});
