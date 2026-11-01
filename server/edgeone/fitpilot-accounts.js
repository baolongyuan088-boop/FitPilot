import { randomBytes, createHash } from 'node:crypto';

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (code, status) => json({ code, error: code }, status);
const fold = value => String(value || '').normalize('NFKC').trim().toLowerCase();
const digest = value => createHash('sha256').update(value).digest('hex');
const records = value => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : [];
const passwordProblem = value => typeof value !== 'string' || [...value].length < 10 ? 'too-short' : value.length > 1024 ? 'too-long' : null;
const clearCookie = 'fitpilot_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
async function transaction(db, mode) {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(mode); } catch (e) {
      if (e.code !== 'SQLITE_BUSY') throw e;
      if (attempt >= 2) throw Object.assign(new Error('busy'), { status: 503 });
      await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}

export async function accountSchema(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS fp_password_resets (
    user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, created_by TEXT NOT NULL)`);
}

/** Called before the common signed-in guard: reset redemption deliberately has no session. */
export async function accountRoute(request, db, env, user, route, bodyOf, helpers) {
  const { hashPassword, validPassword, setCookie, publicUser } = helpers;
  if (route === 'POST /api/login/password-reset') {
    const body = await bodyOf(request);
    const identifier = fold(body.identifier ?? body.name ?? body.email).slice(0, 254);
    const code = String(body.code || '').trim().toUpperCase();
    if (!identifier || !/^[A-F0-9]{20}$/.test(code)) return fail('reset-invalid', 400);
    const row = (await db.execute({ sql: `SELECT u.*,r.code_hash,r.expires FROM fp_users u JOIN fp_password_resets r ON r.user_id=u.id
      WHERE (u.name_key=? OR u.email=?) AND r.code_hash=? AND r.expires>? LIMIT 1`, args: [identifier, identifier, digest(code), Date.now()] })).rows[0];
    if (!row) return fail('reset-invalid', 400);
    if (row.disabled) return fail('disabled', 403);
    const problem = passwordProblem(body.next);
    if (problem) return fail(problem, 400);
    const hash = await hashPassword(body.next);
    const tx = await transaction(db, 'write');
    try {
      const redeemed = await tx.execute({ sql: `DELETE FROM fp_password_resets WHERE user_id=? AND code_hash=? AND expires>?
        AND EXISTS (SELECT 1 FROM fp_users WHERE id=? AND disabled=0 AND session_version=?)`,
      args: [row.id, digest(code), Date.now(), row.id, row.session_version] });
      if (redeemed.rowsAffected !== 1) { await tx.rollback(); return fail('reset-invalid', 400); }
      await tx.execute({ sql: 'UPDATE fp_users SET password_hash=?,session_version=session_version+1 WHERE id=?', args: [hash, row.id] });
      await tx.execute({ sql: 'DELETE FROM fp_login_attempts WHERE key IN (?,?)', args: [digest(row.name_key), digest(row.email || '')] });
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch {} throw e; }
    const renewed = { ...row, session_version: Number(row.session_version) + 1 };
    return json({ user: publicUser(renewed) }, 200, { 'Set-Cookie': setCookie(renewed, env.FITPILOT_SESSION_SECRET) });
  }

  const handled = new Set(['GET /api/account/password', 'GET /api/account/passkeys', 'POST /api/account/password', 'DELETE /api/account/password',
    'POST /api/account/email', 'DELETE /api/account/email', 'POST /api/logout/all', 'GET /api/admin/user',
    'POST /api/admin/user/disable', 'POST /api/admin/user/password-reset', 'POST /api/admin/user/delete', 'GET /api/admin/audit']);
  if (!handled.has(route)) return null;
  if (!user) return fail('unauthorized', 401);
  if (route.includes('/api/admin/') && !user.admin) return fail('forbidden', 403);
  if (route === 'GET /api/admin/audit') return json({ enabled: false, events: [], total: 0 });
  const own = (await db.execute({ sql: 'SELECT * FROM fp_users WHERE id=?', args: [user.id] })).rows[0];
  if (!own || own.disabled || Number(own.session_version) !== Number(user.session_version)) return fail('unauthorized', 401);
  if (route === 'GET /api/account/password') return json({ set: !!own.password_hash, setAt: null, passkeys: 0, name: own.name, nameTaken: false, email: own.email || null });
  if (route === 'GET /api/account/passkeys') return json({ passkeys: [], password: !!own.password_hash, lastWayIn: true });
  if (route === 'DELETE /api/account/password') return fail('last-way-in', 409);
  if (route === 'POST /api/logout/all') {
    await db.execute({ sql: 'UPDATE fp_users SET session_version=session_version+1 WHERE id=?', args: [user.id] });
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
  }
  if (['POST /api/account/password', 'POST /api/account/email', 'DELETE /api/account/email'].includes(route)) {
    const body = await bodyOf(request);
    const proofKey = digest('proof:' + own.id);
    const attempts = (await db.execute({ sql: 'SELECT blocked_until FROM fp_login_attempts WHERE key=?', args: [proofKey] })).rows[0];
    if (Number(attempts?.blocked_until) > Date.now()) return fail('locked', 429);
    if (typeof body.current !== 'string' || body.current.length > 1024 || !await validPassword(body.current, own.password_hash)) {
      const now = Date.now();
      await db.execute({ sql: `INSERT INTO fp_login_attempts(key,failures,blocked_until) VALUES (?,1,0)
        ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN blocked_until>0 AND blocked_until<? THEN 1 ELSE failures+1 END,
        blocked_until=CASE WHEN failures>=4 AND (blocked_until=0 OR blocked_until>=?) THEN ? ELSE 0 END`, args: [proofKey, now, now, now + 15 * 60000] });
      return fail('current-wrong', 403);
    }
    await db.execute({ sql: 'DELETE FROM fp_login_attempts WHERE key=?', args: [proofKey] });
    if (route === 'POST /api/account/password') {
      const problem = passwordProblem(body.next);
      if (problem) return fail(problem, 400);
      const hash = await hashPassword(body.next);
      const tx = await transaction(db, 'write');
      try {
        const updated = await tx.execute({ sql: 'UPDATE fp_users SET password_hash=?,session_version=session_version+1 WHERE id=? AND session_version=? AND disabled=0', args: [hash, own.id, own.session_version] });
        if (updated.rowsAffected !== 1) { await tx.rollback(); return fail('unauthorized', 401); }
        await tx.execute({ sql: 'DELETE FROM fp_password_resets WHERE user_id=?', args: [own.id] });
        await tx.execute({ sql: 'DELETE FROM fp_login_attempts WHERE key IN (?,?)', args: [digest(own.name_key), digest(own.email || '')] });
        await tx.commit();
      } catch (e) { try { await tx.rollback(); } catch {} throw e; }
      return json({ ok: true }, 200, { 'Set-Cookie': setCookie({ ...own, session_version: Number(own.session_version) + 1 }, env.FITPILOT_SESSION_SECRET) });
    }
    const email = route.startsWith('DELETE') ? null : fold(body.email) || null;
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return fail('email-invalid', 400);
    const tx = await transaction(db, 'write');
    try {
      const current = (await tx.execute({ sql: 'SELECT id FROM fp_users WHERE id=? AND session_version=? AND disabled=0', args: [own.id, own.session_version] })).rows[0];
      if (!current) { await tx.rollback(); return fail('unauthorized', 401); }
      // Login accepts either column. Both identifiers therefore share one namespace, and
      // the check must hold the write lock through UPDATE to exclude a concurrent signup.
      if (email) {
        const taken = (await tx.execute({ sql: 'SELECT id FROM fp_users WHERE id<>? AND (email=? OR name_key=?) LIMIT 1', args: [own.id, email, email] })).rows[0];
        if (taken) { await tx.rollback(); return fail('email-taken', 409); }
      }
      await tx.execute({ sql: 'UPDATE fp_users SET email=? WHERE id=?', args: [email, own.id] });
      await tx.commit();
      return json({ ok: true, email });
    } catch (e) {
      try { await tx.rollback(); } catch {}
      if (String(e.message).includes('UNIQUE')) return fail('email-taken', 409);
      throw e;
    }
  }
  const body = request.method === 'GET' ? {} : await bodyOf(request);
  const id = route === 'GET /api/admin/user' ? new URL(request.url).searchParams.get('id') : body.id;
  if (typeof id !== 'string') return fail('missing', 400);
  const tx = await transaction(db, request.method === 'GET' ? 'read' : 'write');
  try {
    const target = (await tx.execute({ sql: 'SELECT * FROM fp_users WHERE id=?', args: [id] })).rows[0];
    if (!target) { await tx.rollback(); return fail('not-found', 404); }
    if (route === 'GET /api/admin/user') {
      const doc = (await tx.execute({ sql: 'SELECT state FROM fp_documents WHERE user_id=?', args: [id] })).rows[0];
      const reset = (await tx.execute({ sql: 'SELECT expires FROM fp_password_resets WHERE user_id=?', args: [id] })).rows[0];
      const state = doc ? JSON.parse(doc.state) : {};
      await tx.commit();
      return json({ user: { ...publicUser(target), created: target.created, disabled: !!target.disabled, password: !!target.password_hash,
        email: target.email || null, resetUntil: reset && Number(reset.expires) > Date.now() ? Number(reset.expires) : null },
        unit: state.unit || 'kg', lastSync: Number(state._ts) || null,
        routines: records(state.routines).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: records(r.ex).length })),
        bodyweight: records(state.bodyweight), measurements: records(state.measurements),
        workouts: records(state.workouts).reverse().map(({ media, ...w }) => w) });
    }
    if (target.admin || target.id === user.id) { await tx.rollback(); return fail('protected-admin', 400); }
    if (route === 'POST /api/admin/user/password-reset') {
      const code = randomBytes(10).toString('hex').toUpperCase();
      const expires = Date.now() + 86400000;
      await tx.execute({ sql: `INSERT INTO fp_password_resets(user_id,code_hash,expires,created_by) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires,created_by=excluded.created_by`, args: [id, digest(code), expires, user.id] });
      await tx.execute({ sql: "UPDATE fp_users SET password_hash='',session_version=session_version+1 WHERE id=?", args: [id] });
      await tx.commit();
      return json({ ok: true, name: target.name, code, expires });
    }
    if (route === 'POST /api/admin/user/disable') {
      await tx.execute({ sql: 'UPDATE fp_users SET disabled=?,session_version=session_version+1 WHERE id=?', args: [body.disabled ? 1 : 0, id] });
      await tx.execute({ sql: 'UPDATE fp_coach SET current=NULL,pending=NULL,last=NULL,generation=generation+1 WHERE user_id=?', args: [id] });
      await tx.commit();
      return json({ ok: true, id, disabled: !!body.disabled });
    }
    if (route === 'POST /api/admin/user/delete') {
      for (const table of ['fp_documents', 'fp_coach', 'fp_password_resets']) await tx.execute({ sql: `DELETE FROM ${table} WHERE user_id=?`, args: [id] });
      await tx.execute({ sql: 'DELETE FROM fp_login_attempts WHERE key IN (?,?)', args: [digest(target.name_key), digest(target.email || '')] });
      await tx.execute({ sql: 'DELETE FROM fp_users WHERE id=?', args: [id] });
      await tx.commit();
      return json({ ok: true, id });
    }
    await tx.rollback();
    return null;
  } catch (e) { try { await tx.rollback(); } catch {} throw e; }
}
