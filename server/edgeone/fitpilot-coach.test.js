import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coachSchema, coachRoute, publicCoach } from './fitpilot-coach.js';

const answer = () => Response.json({ choices: [{ finish_reason: 'stop', message: {
  content: JSON.stringify({ coach_contract: 1, nochange: true, reading: 'Keep recording before changing the plan.' })
} }] });
const state = consent => ({ workouts: [], routines: [], coach: { consent: consent ? { agreedAt: 1 } : null } });
async function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fitpilot-coach-'));
  const db = createClient({ url: `file:${join(dir, 'test.db')}` });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  await coachSchema(db);
  await db.execute('CREATE TABLE fp_documents (user_id TEXT PRIMARY KEY,state TEXT)');
  const writeState = (uid, consent = true) => db.execute({ sql: 'INSERT OR REPLACE INTO fp_documents(user_id,state) VALUES (?,?)', args: [uid, JSON.stringify(state(consent))] });
  await writeState('a');
  await writeState('b');
  const env = { FITPILOT_AI_BASE_URL: 'https://ai.example/api/v3', FITPILOT_AI_MODEL: 'test-model',
    FITPILOT_AI_API_KEY: 'test-only-key', FITPILOT_AI_FETCH: async () => answer(), ...overrides };
  const call = async (path, method = 'GET', body = {}, uid = 'a') => {
    const request = new Request(`https://fit.example/api/coach/${path}`, { method, ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
    const res = await coachRoute(request, db, env, { id: uid }, `${method} /api/coach/${path}`, req => req.json());
    return { status: res.status, data: await res.json() };
  };
  return { db, call, writeState };
}

test('only one paid job per user runs at a time; forget defeats its late answer', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const provider = new Promise(resolve => { release = resolve; });
  const { call } = await fixture(t, { FITPILOT_AI_FETCH: async () => { started(); await provider; return answer(); } });
  const first = call('review', 'POST');
  await entered;
  assert.equal((await call('review', 'POST')).data.code, 'busy');
  assert.equal((await call('status')).data.cap.used, 1);
  await call('forget', 'POST');
  release();
  assert.equal((await first).status, 202);
  const status = (await call('status')).data;
  assert.equal(status.job, null);
  assert.equal(status.last, null);
  assert.equal(status.pending, null);
  assert.equal(status.cap.used, 1);
});

test('forget does not reset user or instance daily job budgets', async t => {
  let calls = 0;
  const { call } = await fixture(t, { FITPILOT_AI_DAILY_LIMIT: '4', FITPILOT_AI_FETCH: async () => { calls++; return answer(); } });
  for (let i = 0; i < 3; i++) {
    assert.equal((await call('review', 'POST')).status, 202);
    await call('forget', 'POST');
  }
  assert.equal((await call('review', 'POST')).status, 429);
  assert.equal((await call('review', 'POST', {}, 'b')).status, 202);
  await call('forget', 'POST', {}, 'b');
  assert.equal((await call('review', 'POST', {}, 'b')).status, 429);
  assert.equal(calls, 4);
});

test('expired job outcome remains visible across repeated status polls', async t => {
  const { db, call } = await fixture(t);
  await db.execute({ sql: 'INSERT INTO fp_coach(user_id,current,pending) VALUES (?,?,?)', args: ['a',
    JSON.stringify({ id: 'stopped', kind: 'review', startedAt: Date.now() - 130000 }),
    JSON.stringify({ id: 'old-proposal', expiresAt: Date.now() - 1 })] });
  for (let i = 0; i < 2; i++) {
    const status = (await call('status')).data;
    assert.equal(status.job, null);
    assert.equal(status.last.id, 'stopped');
    assert.equal(status.last.errorClass, 'timeout');
    assert.equal(status.pending, null);
  }
});

test('forget between payload preparation and reservation prevents the provider call', async t => {
  let calls = 0;
  const { db, call } = await fixture(t, { FITPILOT_AI_FETCH: async () => { calls++; return answer(); } });
  const transaction = db.transaction.bind(db);
  let withdrawn = false;
  db.transaction = async mode => {
    if (!withdrawn) {
      withdrawn = true;
      await call('forget', 'POST');
    }
    return transaction(mode);
  };
  assert.equal((await call('review', 'POST')).data.code, 'consent');
  assert.equal(calls, 0);
  assert.equal((await call('status')).data.cap.used, 0);
});

test('a provider failure retains an existing proposal for the user to decide', async t => {
  const { db, call } = await fixture(t, { FITPILOT_AI_FETCH: async () => Response.json({ error: { message: 'invalid key' } }, { status: 401 }) });
  const pending = { id: 'keep-this', kind: 'create', expiresAt: Date.now() + 100000 };
  await db.execute({ sql: 'INSERT INTO fp_coach(user_id,pending) VALUES (?,?)', args: ['a', JSON.stringify(pending)] });
  await call('review', 'POST');
  const status = (await call('status')).data;
  assert.equal(status.last.errorClass, 'auth');
  assert.equal(status.pending.id, pending.id);
});

test('withdrawing synced consent while a provider runs discards its answer', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const provider = new Promise(resolve => { release = resolve; });
  const { call, writeState } = await fixture(t, { FITPILOT_AI_FETCH: async () => { started(); await provider; return answer(); } });
  const first = call('review', 'POST');
  await entered;
  await writeState('a', false);
  release();
  await first;
  const status = (await call('status')).data;
  assert.equal(status.last.errorClass, 'consent');
  assert.equal(status.last.reading, undefined);
  assert.equal(status.pending, null);
});

test('the total deadline covers a provider body that never finishes', async t => {
  let entered;
  const headersReceived = new Promise(resolve => { entered = resolve; });
  let providerSignal;
  const { call } = await fixture(t, { FITPILOT_AI_FETCH: async (_url, init) => {
    providerSignal = init.signal;
    assert.equal(init.redirect, 'error');
    entered();
    return { ok: true, status: 200, text: () => new Promise(() => {}) };
  } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = call('review', 'POST');
  await headersReceived;
  // Headers have arrived; a deadline still applies to the response body.
  await Promise.resolve();
  t.mock.timers.tick(45001);
  assert.equal((await first).status, 202);
  assert.equal(providerSignal.aborted, true);
  assert.equal((await call('status')).data.last.errorClass, 'timeout');
});

test('endpoint settings reject URL credentials and query-string secrets', () => {
  const env = { FITPILOT_AI_BASE_URL: 'https://ai.example/v3', FITPILOT_AI_MODEL: 'model', FITPILOT_AI_API_KEY: 'key' };
  assert.equal(publicCoach(env).enabled, true);
  assert.equal(publicCoach({ ...env, FITPILOT_AI_BASE_URL: 'https://user:password@ai.example/v3' }), null);
  assert.equal(publicCoach({ ...env, FITPILOT_AI_BASE_URL: 'https://ai.example/v3?key=secret' }), null);
  assert.equal(publicCoach({ ...env, FITPILOT_AI_BASE_URL: 'http://ai.example/v3' }), null);
});

test('Ark Flash coaching disables default reasoning without changing other endpoints', async t => {
  for (const base of ['https://ark.cn-beijing.volces.com/api/v3', 'https://ai.example/api/v3']) {
    let sent;
    const { call } = await fixture(t, { FITPILOT_AI_BASE_URL: base,
      FITPILOT_AI_MODEL: 'deepseek-v4-1-flash-economy-261017',
      FITPILOT_AI_FETCH: async (_url, init) => { sent = JSON.parse(init.body); return answer(); } });
    assert.equal((await call('review', 'POST')).status, 202);
    assert.equal((await call('status')).data.last.outcome, 'nochange');
    assert.equal(sent.model, 'deepseek-v4-1-flash-economy-261017');
    assert.equal(sent.thinking?.type, base.includes('volces.com') ? 'disabled' : undefined);
  }
});
