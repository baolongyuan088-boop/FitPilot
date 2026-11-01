import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountRoute, accountSchema } from './fitpilot-accounts.js';

const admin = { id: 'owner', name: 'Owner', admin: 1, session_version: 0 };
const friend = { id: 'friend', name: 'Friend', admin: 0, session_version: 0 };
const helpers = {
  hashPassword: async value => 'test-hash:' + value,
  validPassword: async (value, hash) => hash === 'test-hash:' + value,
  setCookie: user => 'test-session-version=' + user.session_version,
  publicUser: user => ({ id: user.id, name: user.name, admin: !!user.admin })
};
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fitpilot-account-'));
  const db = createClient({ url: 'file:' + join(dir, 'test.db') });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  await db.batch([
    'CREATE TABLE fp_users(id TEXT PRIMARY KEY,name TEXT,name_key TEXT UNIQUE,email TEXT UNIQUE,password_hash TEXT,admin INTEGER,disabled INTEGER DEFAULT 0,session_version INTEGER DEFAULT 0,created TEXT)',
    'CREATE TABLE fp_documents(user_id TEXT PRIMARY KEY,state TEXT)',
    'CREATE TABLE fp_login_attempts(key TEXT PRIMARY KEY,failures INTEGER,blocked_until INTEGER)',
    'CREATE TABLE fp_coach(user_id TEXT PRIMARY KEY,current TEXT,pending TEXT,last TEXT,generation INTEGER DEFAULT 0)',
    { sql: 'INSERT INTO fp_users(id,name,name_key,password_hash,admin) VALUES (?,?,?,?,?)', args: ['owner', 'Owner', 'owner', 'test-hash:old-password', 1] },
    { sql: 'INSERT INTO fp_users(id,name,name_key,password_hash,admin) VALUES (?,?,?,?,?)', args: ['friend', 'Friend', 'friend', 'test-hash:old-password', 0] }
  ], 'write');
  await accountSchema(db);
  const call = async (route, body, user = admin, overrides = {}) => {
    const [method, path] = route.split(' ');
    const request = new Request('https://fit.example' + path, { method });
    const result = await accountRoute(request, db, { FITPILOT_SESSION_SECRET: 'test-only-secret' }, user,
      `${method} ${new URL(request.url).pathname}`, async () => body || {}, { ...helpers, ...overrides });
    return result && { status: result.status, data: await result.json(), cookie: result.headers.get('set-cookie') };
  };
  return { db, call };
}

test('admin reset invalidates password/sessions and reset code works exactly once', async t => {
  const { db, call } = await fixture(t);
  assert.equal((await call('POST /api/admin/user/password-reset', { id: 'friend' }, friend)).status, 403);
  const issued = await call('POST /api/admin/user/password-reset', { id: 'friend' });
  assert.equal(issued.status, 200);
  const row = (await db.execute("SELECT * FROM fp_users WHERE id='friend'")).rows[0];
  assert.equal(row.password_hash, '');
  assert.equal(row.session_version, 1);
  assert.equal((await call('GET /api/account/password', null, friend)).status, 401);
  const redeem = await call('POST /api/login/password-reset', { name: 'Friend', code: issued.data.code, next: 'new-password' }, null);
  assert.equal(redeem.status, 200);
  assert.equal(redeem.cookie, 'test-session-version=2');
  assert.equal((await call('POST /api/login/password-reset', { name: 'Friend', code: issued.data.code, next: 'new-password' }, null)).status, 400);
  assert.equal((await db.execute('SELECT count(*) AS n FROM fp_password_resets')).rows[0].n, 0);
});

test('two concurrent reset redemptions cannot both change password', async t => {
  const { call } = await fixture(t);
  const issued = await call('POST /api/admin/user/password-reset', { id: 'friend' });
  const results = await Promise.all(['new-password-a', 'new-password-b'].map(next => call('POST /api/login/password-reset', { name: 'Friend', code: issued.data.code, next }, null)));
  assert.deepEqual(results.map(x => x.status).sort(), [200, 400]);
});

test('expired reset codes and protected admin accounts are refused', async t => {
  const { db, call } = await fixture(t);
  for (const action of ['password-reset', 'disable', 'delete']) assert.equal((await call('POST /api/admin/user/' + action, { id: 'owner', disabled: true })).status, 400);
  const issued = await call('POST /api/admin/user/password-reset', { id: 'friend' });
  await db.execute('UPDATE fp_password_resets SET expires=1');
  assert.equal((await call('POST /api/login/password-reset', { name: 'Friend', code: issued.data.code, next: 'new-password' }, null)).status, 400);
});

test('password changes require old password and reject a session revoked during hashing', async t => {
  const { db, call } = await fixture(t);
  assert.equal((await call('POST /api/account/password', { current: 'incorrect', next: 'new-password' }, friend)).status, 403);
  const revoked = await call('POST /api/account/password', { current: 'old-password', next: 'new-password' }, friend, {
    hashPassword: async value => { await db.execute("UPDATE fp_users SET session_version=session_version+1 WHERE id='friend'"); return 'test-hash:' + value; }
  });
  assert.equal(revoked.status, 401);
  assert.equal((await db.execute("SELECT password_hash FROM fp_users WHERE id='friend'")).rows[0].password_hash, 'test-hash:old-password');
  const result = await call('POST /api/account/password', { current: 'old-password', next: 'new-password' }, { ...friend, session_version: 1 });
  assert.equal(result.status, 200);
  assert.equal(result.cookie, 'test-session-version=2');
});

test('disable revokes sessions; deletion removes records and keeps spent invitation burned', async t => {
  const { db, call } = await fixture(t);
  await db.batch([
    "INSERT INTO fp_documents VALUES ('friend','{\"workouts\":[]}')",
    "INSERT INTO fp_coach(user_id,pending) VALUES ('friend','private-coach-data')",
    'CREATE TABLE fp_invites(code TEXT,used_by TEXT)',
    "INSERT INTO fp_invites VALUES ('used-code','friend')"
  ], 'write');
  assert.equal((await call('POST /api/admin/user/disable', { id: 'friend', disabled: true })).status, 200);
  assert.equal((await call('GET /api/account/password', null, friend)).status, 401);
  assert.equal((await db.execute("SELECT pending FROM fp_coach WHERE user_id='friend'")).rows[0].pending, null);
  await call('POST /api/admin/user/disable', { id: 'friend', disabled: false });
  assert.equal((await call('GET /api/account/password', null, friend)).status, 401);
  assert.equal((await call('POST /api/admin/user/delete', { id: 'friend' })).status, 200);
  for (const table of ['fp_users', 'fp_documents', 'fp_coach']) {
    const field = table === 'fp_users' ? 'id' : 'user_id';
    assert.equal((await db.execute(`SELECT count(*) AS n FROM ${table} WHERE ${field}='friend'`)).rows[0].n, 0);
  }
  assert.equal((await db.execute('SELECT used_by FROM fp_invites')).rows[0].used_by, 'friend');
});

test('email updates reject another user name and a name registered while password proof was pending', async t => {
  const { db, call } = await fixture(t);
  await db.execute({ sql: 'INSERT INTO fp_users(id,name,name_key,password_hash,admin) VALUES (?,?,?,?,?)',
    args: ['named-email', 'taken@example.com', 'taken@example.com', 'test-hash:other-password', 0] });
  const conflict = await call('POST /api/account/email', { current: 'old-password', email: '  TAKEN@example.com  ' }, friend);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'email-taken');
  assert.equal((await db.execute("SELECT email FROM fp_users WHERE id='friend'")).rows[0].email, null);
  const concurrent = await call('POST /api/account/email', { current: 'old-password', email: 'raced@example.com' }, friend, {
    validPassword: async () => {
      await db.execute({ sql: 'INSERT INTO fp_users(id,name,name_key,password_hash,admin) VALUES (?,?,?,?,?)',
        args: ['raced', 'raced@example.com', 'raced@example.com', 'test-hash:other-password', 0] });
      return true;
    }
  });
  assert.equal(concurrent.status, 409);
  assert.equal((await db.execute("SELECT email FROM fp_users WHERE id='friend'")).rows[0].email, null);
  assert.equal((await call('POST /api/account/email', { current: 'old-password', email: 'available@example.com' }, friend)).status, 200);
  assert.equal((await call('DELETE /api/account/email', { current: 'old-password' }, friend)).status, 200);
});
