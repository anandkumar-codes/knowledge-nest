// SIGNIN_LIMIT_BY_ADDRESS=false: for setups where every visitor arrives from the same address (Tailscale Funnel).
// Runs in its own process (node --test runs each file separately), with a throwaway in-memory database.
process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.SIGNIN_LIMIT_BY_ADDRESS = 'false';

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/seed.js');

let server;
let base;
const login = (email, password) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.status);

before(async () => {
  await seed({ name: 'Owner', email: 'owner@test.in', password: 'Owner12345' }, () => {});
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('many people signing in from one shared address are not locked out together', async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push(await login(`person${i}@test.in`, 'wrongpass1'));
  assert.ok(statuses.every((s) => s === 401), `expected no 429s, got ${statuses}`);
  assert.equal(await login('owner@test.in', 'Owner12345'), 200, 'a real sign-in still works');
});

test('guessing one account is still blocked after 10 failures', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push(await login('owner@test.in', `guess${i}x1`));
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
});
