import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from './fitpilot-api.js';

const env = { FITPILOT_SESSION_SECRET: 'local-only-test-secret-with-at-least-32-bytes', FITPILOT_BOOTSTRAP_CODE: '1234567890ABCDEF' };
function fixture(envOverride = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fitpilot-turso-'));
  const db = createClient({ url: `file:${join(dir, 'test.db')}` });
  let cookie = '';
  const call = async (path, method = 'GET', body, otherCookie = cookie) => {
    const req = new Request('https://fit.example' + path, { method, headers: { ...(otherCookie ? { Cookie: otherCookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const res = await handle(req, db, { ...env, ...envOverride });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json(), cookie: set?.split(';')[0] };
  };
  return { db, call, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('bootstrap administrator, one-use invitation and password login', async () => {
  const { call, cleanup } = fixture();
  assert.equal((await call('/api/config')).data.invite_only, true);
  assert.equal((await call('/api/register/password', 'POST', { name: 'Guest', password: 'long-password-123', code: 'AAAAAAAAAAAAAAAA' })).status, 403);
  const admin = await call('/api/register/password', 'POST', { name: 'Baolong', password: 'long-password-123', code: env.FITPILOT_BOOTSTRAP_CODE });
  assert.equal(admin.data.user.admin, true);
  assert.equal((await call('/api/me')).data.user.name, 'Baolong');
  const invitation = (await call('/api/admin/invites/new', 'POST', {})).data.invite.code;
  assert.equal((await call('/api/admin/invites')).data.invites[0].code, invitation);
  assert.equal((await call('/api/admin/users')).data.users[0].name, 'Baolong');
  await call('/api/logout', 'POST');
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/register/password', 'POST', { name: 'Friend', password: 'long-password-456', code: invitation })).data.user.admin, false);
  assert.equal((await call('/api/register/password', 'POST', { name: 'Friend2', password: 'long-password-789', code: invitation })).status, 403);
  assert.equal((await call('/api/admin/invites/new', 'POST', {})).status, 403);
  await call('/api/logout', 'POST');
  assert.equal((await call('/api/login/password', 'POST', { identifier: 'Baolong', password: 'long-password-123' })).status, 200);
  assert.equal((await call('/api/me')).data.user.admin, true);
  cleanup();
});

test('Coach uses the server credential, requires consent, and records a validated no-change answer', async () => {
  let calls = 0;
  const { call, cleanup } = fixture({
    FITPILOT_AI_BASE_URL: 'https://ai.example/v3', FITPILOT_AI_MODEL: 'coach-model',
    FITPILOT_AI_API_KEY: 'server-only-test-key',
    FITPILOT_AI_FETCH: async (_url, options) => {
      calls++;
      assert.equal(options.headers.authorization, 'Bearer server-only-test-key');
      assert.equal(JSON.parse(options.body).model, 'coach-model');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ coach_contract: 1, nochange: true, reading: '先坚持记录，再看趋势。', changes: [] }) } }] });
    }
  });
  assert.equal((await call('/api/config')).data.coach.enabled, true);
  await call('/api/register/password', 'POST', { name: 'Owner', password: 'long-password-123', code: env.FITPILOT_BOOTSTRAP_CODE });
  assert.equal((await call('/api/coach/review', 'POST', { lang: 'zh-CN' })).status, 409);
  await call('/api/data', 'PUT', { state: { workouts: [], routines: [], coach: {} }, baseRev: 0 });
  assert.equal((await call('/api/coach/review', 'POST', { lang: 'zh-CN' })).status, 403);
  await call('/api/data', 'PUT', { state: { workouts: [], routines: [], coach: { consent: { agreedAt: Date.now() } } }, baseRev: 1 });
  const started = await call('/api/coach/review', 'POST', { lang: 'zh-CN' });
  assert.equal(started.status, 202);
  const status = await call('/api/coach/status');
  assert.equal(status.data.last.id, started.data.job.id);
  assert.equal(status.data.last.outcome, 'nochange');
  assert.equal(status.data.cap.used, 1);
  assert.equal(calls, 1);
  await call('/api/coach/forget', 'POST', {});
  assert.equal((await call('/api/coach/status')).data.cap.used, 1);
  assert.equal((await call('/api/coach/status')).data.last, null);
  cleanup();
});

test('state write rejects stale revision and keeps the other device data', async () => {
  const { call, cleanup } = fixture();
  const admin = await call('/api/register/password', 'POST', { name: 'Owner', password: 'long-password-123', code: env.FITPILOT_BOOTSTRAP_CODE });
  const one = admin.cookie;
  assert.deepEqual((await call('/api/data', 'GET', null, one)).data, { state: null, rev: 0 });
  const first = await call('/api/data', 'PUT', { state: { workouts: [{ id: 'w1' }], routines: [] }, baseRev: 0 }, one);
  assert.equal(first.data.rev, 1);
  const stale = await call('/api/data', 'PUT', { state: { workouts: [], routines: [] }, baseRev: 0 }, one);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.state.workouts[0].id, 'w1');
  assert.equal((await call('/api/data/rev', 'GET', null, one)).data.wid, first.data.wid);
  cleanup();
});

test('one invite cannot create two users even when redeemed concurrently', async () => {
  const { call, cleanup } = fixture();
  await call('/api/register/password', 'POST', { name: 'Owner', password: 'long-password-123', code: env.FITPILOT_BOOTSTRAP_CODE });
  const code = (await call('/api/admin/invites/new', 'POST', {})).data.invite.code;
  const attempts = await Promise.all(['A', 'B'].map(name => call('/api/register/password', 'POST', { name, password: 'long-password-456', code }, '')));
  assert.deepEqual(attempts.map(x => x.status).sort(), [200, 403]);
  cleanup();
});

test('repeated wrong passwords block further login attempts', async () => {
  const { call, cleanup } = fixture();
  await call('/api/register/password', 'POST', { name: 'Owner', password: 'long-password-123', code: env.FITPILOT_BOOTSTRAP_CODE });
  await call('/api/logout', 'POST');
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/login/password', 'POST', { name: 'Owner', password: 'wrong-password' })).status, 401);
  assert.equal((await call('/api/login/password', 'POST', { name: 'Owner', password: 'long-password-123' })).status, 429);
  cleanup();
});
