import { randomBytes, randomUUID, createHash, createHmac, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { stampPut } from '../api/sync-stamps.js';

const scrypt = promisify(scryptCallback);
const maxBody = 5 * 1024 * 1024;
const cookieName = 'fitpilot_session';
const sessionMs = 30 * 86400000;
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const error = (code, status, message = code) => json({ error: message, code }, status);
const fold = value => String(value || '').normalize('NFKC').trim().toLowerCase();
const publicUser = user => ({ id: user.id, name: user.name, admin: !!user.admin });

let schemaReady = new WeakSet();
async function schema(db) {
  if (schemaReady.has(db)) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS fp_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, email TEXT UNIQUE, password_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, session_version INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS fp_invites (code_hash TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created TEXT NOT NULL, used_by TEXT, used_at TEXT, revoked INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS fp_documents (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, wid TEXT NOT NULL, state TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS fp_login_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until INTEGER NOT NULL)`
  ], 'write');
  schemaReady.add(db);
}

const digest = value => createHash('sha256').update(value).digest('hex');
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function validPassword(password, encoded) {
  const [, salt, expected] = String(encoded).split(':');
  if (!salt || !expected || expected.length !== 128) return false;
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  let actual;
  try { actual = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Number.isSafeInteger(payload.exp) && payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}
function setCookie(user, secret) {
  const token = sign({ uid: user.id, sv: Number(user.session_version), exp: Date.now() + sessionMs }, secret);
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionMs / 1000}`;
}
const clearCookie = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
async function currentUser(request, db, secret) {
  const cookies = request.headers.get('cookie') || '';
  const token = cookies.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const session = verify(token, secret);
  if (!session) return null;
  const result = await db.execute({ sql: 'SELECT id, name, admin, disabled, session_version FROM fp_users WHERE id = ?', args: [session.uid] });
  const user = result.rows[0];
  return user && !user.disabled && Number(user.session_version) === session.sv ? user : null;
}
async function bodyOf(request) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > maxBody) throw Object.assign(new Error('too large'), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBody) throw Object.assign(new Error('too large'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}
async function failedLogin(db, key) {
  const now = Date.now();
  await db.execute({ sql: `INSERT INTO fp_login_attempts(key,failures,blocked_until) VALUES (?,1,0)
    ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN blocked_until > 0 AND blocked_until < ? THEN 1 ELSE failures+1 END,
    blocked_until=CASE WHEN failures >= 4 AND (blocked_until = 0 OR blocked_until >= ?) THEN ? ELSE 0 END`, args: [key, now, now, now + 15 * 60000] });
}
async function blocked(db, key) {
  const row = (await db.execute({ sql: 'SELECT blocked_until FROM fp_login_attempts WHERE key=?', args: [key] })).rows[0];
  return row && Number(row.blocked_until) > Date.now();
}
const sameOrigin = request => {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
};

export async function handle(request, db, env) {
  if (!env.FITPILOT_SESSION_SECRET || env.FITPILOT_SESSION_SECRET.length < 32) return error('configuration', 503);
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) return error('origin', 403);
  try {
    await schema(db);
    if (route === 'GET /api/config') return json({ invite_only: true, allow_guest: false, password_login: true, passkey_login: false, default_lang: 'zh-CN', coach: null });
    if (route === 'POST /api/register/password') {
      const body = await bodyOf(request);
      const name = String(body.name || '').trim();
      const nameKey = fold(name);
      const email = fold(body.email) || null;
      const code = String(body.code || '').trim().toUpperCase();
      const password = String(body.password || '');
      if (!name || name.length > 40 || !nameKey) return error('missing', 400, 'name required');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('email-invalid', 400);
      if (password.length < 10 || password.length > 1024) return error('too-short', 400);
      if (!/^[A-F0-9]{16}$/.test(code)) return error('invite', 403);
      const bootstrap = env.FITPILOT_BOOTSTRAP_CODE && code === env.FITPILOT_BOOTSTRAP_CODE;
      const count = (await db.execute('SELECT count(*) AS n FROM fp_users')).rows[0].n;
      const admin = bootstrap && Number(count) === 0;
      if (bootstrap && !admin) return error('invite', 403);
      const codeHash = digest(code);
      if (!admin) {
        const inv = (await db.execute({ sql: 'SELECT used_by, revoked FROM fp_invites WHERE code_hash=?', args: [codeHash] })).rows[0];
        if (!inv || inv.used_by || inv.revoked) return error('invite', 403);
      }
      const passwordHash = await hashPassword(password);
      const user = { id: randomUUID(), name, admin, session_version: 0 };
      const now = new Date().toISOString();
      const tx = await db.transaction('write');
      try {
        if (admin) {
          const n = (await tx.execute('SELECT count(*) AS n FROM fp_users')).rows[0].n;
          if (Number(n) !== 0) throw Object.assign(new Error('invite'), { status: 403 });
        } else {
          const update = await tx.execute({ sql: 'UPDATE fp_invites SET used_by=?, used_at=? WHERE code_hash=? AND used_by IS NULL AND revoked=0', args: [user.id, now, codeHash] });
          if (update.rowsAffected !== 1) throw Object.assign(new Error('invite'), { status: 403 });
        }
        await tx.execute({ sql: 'INSERT INTO fp_users(id,name,name_key,email,password_hash,admin,created) VALUES (?,?,?,?,?,?,?)', args: [user.id, name, nameKey, email, passwordHash, admin ? 1 : 0, now] });
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        if (String(e.message).includes('UNIQUE')) return error('name-taken', 409);
        if (e.status === 403) return error('invite', 403);
        throw e;
      }
      return json({ user: publicUser(user) }, 200, { 'Set-Cookie': setCookie(user, env.FITPILOT_SESSION_SECRET) });
    }
    if (route === 'POST /api/login/password') {
      const body = await bodyOf(request);
      const identifier = fold(body.identifier ?? body.name ?? body.email).slice(0, 254);
      const password = String(body.password || '');
      const key = digest(identifier);
      if (!identifier || await blocked(db, key)) return error('locked', 429);
      const row = (await db.execute({ sql: 'SELECT * FROM fp_users WHERE name_key=? OR email=? LIMIT 1', args: [identifier, identifier] })).rows[0];
      if (!row || row.disabled || !await validPassword(password, row.password_hash)) {
        await failedLogin(db, key);
        return error('bad-credentials', 401);
      }
      await db.execute({ sql: 'DELETE FROM fp_login_attempts WHERE key=?', args: [key] });
      return json({ user: publicUser(row) }, 200, { 'Set-Cookie': setCookie(row, env.FITPILOT_SESSION_SECRET) });
    }
    if (route === 'POST /api/logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
    const user = await currentUser(request, db, env.FITPILOT_SESSION_SECRET);
    if (!user) return error('unauthorized', 401, 'not signed in');
    if (route === 'GET /api/me') return json({ user: publicUser(user) });
    if (route === 'GET /api/data' || route === 'GET /api/data/rev') {
      const row = (await db.execute({ sql: 'SELECT rev,wid,state FROM fp_documents WHERE user_id=?', args: [user.id] })).rows[0];
      if (route.endsWith('/rev')) return json({ rev: Number(row?.rev || 0), ...(row?.wid ? { wid: row.wid } : {}) });
      return json({ state: row ? JSON.parse(row.state) : null, rev: Number(row?.rev || 0) });
    }
    if (route === 'PUT /api/data') {
      const body = await bodyOf(request);
      const state = body?.state;
      if (!state || Array.isArray(state) || typeof state !== 'object' ||
          !Object.keys(state).some(k => !['_rev', '_ts'].includes(k)) ||
          (state.workouts != null && !Array.isArray(state.workouts)) ||
          (state.routines != null && !Array.isArray(state.routines))) return error('invalid-state', 400);
      const tx = await db.transaction('write');
      try {
        const row = (await tx.execute({ sql: 'SELECT rev,wid,state FROM fp_documents WHERE user_id=?', args: [user.id] })).rows[0];
        const rev = Number(row?.rev || 0);
        if ((body.baseRev != null && body.baseRev !== rev) || (body.baseWid && row?.wid && body.baseWid !== row.wid)) {
          await tx.rollback();
          return json({ error: 'conflict', rev, state: row ? JSON.parse(row.state) : null }, 409);
        }
        delete state.active;
        const prior = row ? JSON.parse(row.state) : null;
        if ((Number(prior?.resetAt) || 0) > (Number(state.resetAt) || 0)) {
          state.resetAt = prior.resetAt;
          if (prior.resetIds) state.resetIds = prior.resetIds;
        }
        const report = {};
        stampPut(prior, state, { overRead: body.baseRev != null && body.baseRev === rev, stamped: body.stamped === true, report });
        const wid = randomBytes(8).toString('hex');
        state._rev = rev + (report.changed ? 2 : 1);
        state._wid = wid;
        state._wids = [...(Array.isArray(prior?._wids) ? prior._wids : []), prior?._wid].filter(x => typeof x === 'string').slice(-50);
        const encoded = JSON.stringify(state);
        await tx.execute({ sql: `INSERT INTO fp_documents(user_id,rev,wid,state) VALUES (?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET rev=excluded.rev,wid=excluded.wid,state=excluded.state`, args: [user.id, state._rev, wid, encoded] });
        await tx.commit();
        return json({ ok: true, rev: state._rev, wid });
      } catch (e) { try { await tx.rollback(); } catch {} throw e; }
    }
    if (route === 'GET /api/admin/invites') {
      if (!user.admin) return error('forbidden', 403);
      const rows = (await db.execute('SELECT code,created,used_by,used_at,revoked FROM fp_invites ORDER BY created DESC')).rows;
      return json({ invites: rows.filter(x => !x.revoked).map(x => ({ code: x.code, created: x.created, usedBy: x.used_by, usedAt: x.used_at, revoked: !!x.revoked })), invite_only: true });
    }
    if (route === 'GET /api/admin/users') {
      if (!user.admin) return error('forbidden', 403);
      const rows = (await db.execute(`SELECT u.id,u.name,u.created,u.disabled,u.admin,
        d.rev,d.state FROM fp_users u LEFT JOIN fp_documents d ON d.user_id=u.id ORDER BY u.created DESC`)).rows;
      return json({ users: rows.map(x => ({ id: x.id, name: x.name, created: x.created,
        disabled: !!x.disabled, admin: !!x.admin, lastSync: x.state ? Number(JSON.parse(x.state)._ts) || null : null,
        live: false, rev: Number(x.rev || 0) })), invite_only: true, password_login: true, now: Date.now() });
    }
    if (route === 'POST /api/admin/invites/new') {
      if (!user.admin) return error('forbidden', 403);
      const code = randomBytes(8).toString('hex').toUpperCase();
      const created = new Date().toISOString();
      await db.execute({ sql: 'INSERT INTO fp_invites(code_hash,code,created_by,created) VALUES (?,?,?,?)', args: [digest(code), code, user.id, created] });
      return json({ invite: { code, created, createdBy: user.id } });
    }
    if (route === 'POST /api/admin/invites/revoke') {
      if (!user.admin) return error('forbidden', 403);
      const body = await bodyOf(request);
      const code = String(body.code || '').trim().toUpperCase();
      const result = await db.execute({ sql: 'UPDATE fp_invites SET revoked=1 WHERE code_hash=? AND used_by IS NULL AND revoked=0', args: [digest(code)] });
      return result.rowsAffected ? json({ ok: true }) : error('invite', 404);
    }
    return error('not-implemented', 501);
  } catch (e) {
    if (e.status) return error(e.message, e.status);
    console.error('FitPilot API failed', e);
    return error('internal', 500);
  }
}
