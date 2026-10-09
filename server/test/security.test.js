// Run with `npm test` (in server/). Uses a throwaway database file in the temp folder; your real data is never touched.
import os from 'node:os';
import path from 'node:path';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `knest-test-${process.pid}-${Date.now()}.db`);
delete process.env.TURSO_DATABASE_URL;
process.env.JWT_SECRET = 'test-secret';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
delete process.env.TRUST_PROXY;

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const { db } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/seed.js');
const { localDate, localDateSql } = await import('../src/utils/dates.js');
const { createMember } = await import('../src/models/members.js');
const { setPortalPassword } = await import('../src/models/portal.js');
const { setPaymentSettings } = await import('../src/models/paymentSettings.js');
const { trustProxySetting } = await import('../src/middleware/rateLimits.js');

let server;
let base;
const ADMIN = { email: 'owner@test.in', password: 'Owner12345' };

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  await seed({ name: 'Owner', ...ADMIN }, () => {});
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('dates follow the reading room time zone, not the server', async () => {
  // 20:00 UTC on 9 Oct is 01:30 on 10 Oct in India.
  assert.equal(localDate('2026-10-09T20:00:00.000Z'), '2026-10-10');
  assert.equal(localDate('2026-10-09T10:00:00.000Z'), '2026-10-09');
  const row = await db.prepare(`SELECT ${localDateSql("'2026-10-09T20:00:00.000Z'")} AS d`).get();
  assert.equal(row.d, '2026-10-10');
});

test('X-Forwarded-For is not trusted unless TRUST_PROXY is set', () => {
  assert.equal(trustProxySetting(undefined), false);
  assert.equal(trustProxySetting(''), false);
  assert.equal(trustProxySetting('1'), 1);
  assert.equal(trustProxySetting('loopback'), 'loopback');
});

test('changing a password signs out other sessions but keeps this one', async () => {
  const login = () => call('POST', '/api/auth/login', { body: ADMIN, headers: {} });
  const a = await login();
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const b = await login();
  // JWT iat has 1-second precision: make sure the change happens in a later second than the sign-ins.
  await new Promise((r) => setTimeout(r, 1100));

  const changed = await call('POST', '/api/auth/change-password', {
    token: a.data.token,
    body: { currentPassword: ADMIN.password, newPassword: 'Owner67890' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.ok(changed.data.token, 'a fresh token is returned');

  assert.equal((await call('GET', '/api/auth/me', { token: b.data.token })).status, 401, 'other session signed out');
  assert.equal((await call('GET', '/api/auth/me', { token: a.data.token })).status, 401, 'old token of this device too');
  assert.equal((await call('GET', '/api/auth/me', { token: changed.data.token })).status, 200, 'fresh token works');
  ADMIN.password = 'Owner67890';
  ADMIN.token = changed.data.token;
});

test('passwords typed by an admin must include a letter and a number', async () => {
  const roleId = (await db.prepare('SELECT id FROM roles LIMIT 1').get()).id;
  const weak = await call('POST', '/api/users', {
    token: ADMIN.token,
    body: { name: 'Desk', email: 'desk@test.in', password: 'abcdefgh', roleId: String(roleId) },
  });
  assert.equal(weak.status, 400);
  const ok = await call('POST', '/api/users', {
    token: ADMIN.token,
    body: { name: 'Desk', email: 'desk@test.in', password: 'abcdefg1', roleId: String(roleId) },
  });
  assert.equal(ok.status, 201);
});

test('member portal: a front-desk reset signs out the old session', async () => {
  const m = await createMember({ name: 'Ravi', phone: '9876543210' });
  await setPortalPassword(m.id, 'Ravi12345', { mustChange: false });
  const login = await call('POST', '/api/portal/login', { body: { phone: '98765 43210', password: 'Ravi12345' } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal((await call('GET', '/api/portal/me', { token: login.data.token })).status, 200);

  await new Promise((r) => setTimeout(r, 1100));
  await setPortalPassword(m.id, 'Temp12345', { mustChange: true });
  assert.equal((await call('GET', '/api/portal/me', { token: login.data.token })).status, 401);
});

test('voiding a payment from an online claim rejects the claim so it can be resubmitted', async () => {
  await setPaymentSettings({ vpa: 'nest@okhdfcbank', payee: 'Knowledge Nest', qrMode: 'generated', autoConfirm: true }, null);
  const m = await createMember({ name: 'Asha', phone: '9123456780' });
  await setPortalPassword(m.id, 'Asha12345', { mustChange: false });
  const seat = await db.prepare('SELECT id FROM seats LIMIT 1').get();
  const today = localDate();
  const booked = await call('POST', `/api/seats/${seat.id}/allocations`, {
    token: ADMIN.token,
    body: { memberId: String(m.id), shift: 'morning', startDate: today, endDate: today, fee: 800 },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));

  const member = await call('POST', '/api/portal/login', { body: { phone: '9123456780', password: 'Asha12345' } });
  const claim = await call('POST', '/api/portal/claims', {
    token: member.data.token,
    body: { allocationId: booked.data.allocation.id, utr: '111122223333', amount: 800 },
  });
  assert.equal(claim.status, 201, JSON.stringify(claim.data));
  assert.equal(claim.data.claim.status, 'approved');

  const voided = await call('POST', `/api/payments/${claim.data.payment.id}/void`, {
    token: ADMIN.token, body: { reason: 'Not in bank statement' },
  });
  assert.equal(voided.status, 200, JSON.stringify(voided.data));
  const row = await db.prepare('SELECT status, review_note FROM payment_claims WHERE id = ?').get(Number(claim.data.claim.id));
  assert.equal(row.status, 'rejected');
  assert.match(row.review_note, /Not in bank statement/);

  // The same transaction ID can be submitted again once the bad one is voided.
  const again = await call('POST', '/api/portal/claims', {
    token: member.data.token,
    body: { allocationId: booked.data.allocation.id, utr: '111122223333', amount: 800 },
  });
  assert.equal(again.status, 201, JSON.stringify(again.data));
});

test('staff writes are recorded in the audit log without request bodies', async () => {
  await new Promise((r) => setTimeout(r, 200)); // audit rows are written just after each response
  const rows = await db.prepare('SELECT method, path, status, user_name FROM audit_log').all();
  assert.ok(rows.some((r) => r.path === '/api/auth/change-password' && r.status === 200));
  assert.ok(rows.some((r) => r.path.startsWith('/api/payments/') && r.path.endsWith('/void')));
  const cols = (await db.prepare('PRAGMA table_info(audit_log)').all()).map((c) => c.name);
  assert.ok(!cols.includes('body'));
});

test('security headers are sent', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('the Android app (https://localhost) may call the API; other websites may not', async () => {
  const preflight = (origin) =>
    fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
    });
  const app = await preflight('https://localhost');
  assert.equal(app.headers.get('access-control-allow-origin'), 'https://localhost');
  const other = await preflight('https://evil.example');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('payment settings reject unsigned requests before reading the body', async () => {
  const r = await call('PUT', '/api/payment-settings', { body: { qrImage: 'x'.repeat(500_000) } });
  assert.equal(r.status, 401);
});

// Last: it uses up the sign-in attempts allowed from this address.
test('faking X-Forwarded-For does not get around the sign-in limit', async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', '/api/auth/login', {
      body: { email: 'nobody@test.in', password: 'wrongpass1' },
      headers: { 'X-Forwarded-For': `10.0.0.${i}` },
    });
    statuses.push(r.status);
  }
  // Earlier tests already used some of this address's attempts, so the block may start sooner than the 11th try.
  // What matters: it starts within the limit, and a different faked address never lifts it.
  const firstBlocked = statuses.indexOf(429);
  assert.ok(firstBlocked !== -1 && firstBlocked <= 10, `expected a block within 11 tries, got ${statuses}`);
  assert.ok(statuses.slice(firstBlocked).every((s) => s === 429), `faked addresses lifted the block: ${statuses}`);
});
