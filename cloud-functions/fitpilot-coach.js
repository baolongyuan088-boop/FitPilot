import { randomBytes, createHash } from 'node:crypto';
import { build, canonicalPlan, workoutMeta, findWorkout, MAX_PAYLOAD_CHARS, langTag, DATA_CATEGORIES } from '../api/coach/core/payload.js';
import { hashPlan } from '../api/coach/core/plan-hash.js';
import { runPipeline } from '../api/coach/core/pipeline.js';
import adapter from '../api/coach/core/adapters/compatible.js';

const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (code, status) => reply({ code, error: code }, status);
const day = () => new Date().toISOString().slice(0, 10);
const limit = 3;

export async function coachSchema(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS fp_coach (
    user_id TEXT PRIMARY KEY, daily_date TEXT, daily_count INTEGER NOT NULL DEFAULT 0,
    current TEXT, pending TEXT, last TEXT, generation INTEGER NOT NULL DEFAULT 0)`);
}

const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
async function record(db, uid) {
  return (await db.execute({ sql: 'SELECT * FROM fp_coach WHERE user_id=?', args: [uid] })).rows[0] || null;
}
const configured = env => {
  try {
    const url = new URL(env.FITPILOT_AI_BASE_URL);
    return url.protocol === 'https:' && !!env.FITPILOT_AI_MODEL && !!env.FITPILOT_AI_API_KEY;
  } catch { return false; }
};
export const publicCoach = env => configured(env)
  ? { enabled: true, provider: 'compatible', providerLabel: 'AI 教练', authMode: 'instance', community: false }
  : null;

export async function coachRoute(request, db, env, user, route, bodyOf) {
  if (route === 'GET /api/coach/disclosure') return reply({ provider: 'compatible', providerLabel: 'AI 教练', categories: DATA_CATEGORIES, version: 1 });
  if (route === 'GET /api/coach/account') return reply({ mode: 'instance', provider: 'compatible', providerLabel: 'AI 教练', account: null, connected: configured(env), reason: configured(env) ? null : 'off', message: null });
  if (route === 'GET /api/coach/cohort') return reply({ ok: false, enabled: false });
  if (route === 'POST /api/coach/cohort/share') return reply({ ok: true, sharing: false });
  if (route === 'POST /api/coach/forget') {
    // Erase coach content, but retain today's paid-call counter so forget cannot reset the cap.
    await db.execute({ sql: 'UPDATE fp_coach SET current=NULL,pending=NULL,last=NULL,generation=generation+1 WHERE user_id=?', args: [user.id] });
    return reply({ ok: true });
  }
  if (route === 'POST /api/coach/pending/resolve') {
    const row = await record(db, user.id);
    const body = await bodyOf(request);
    const pending = parse(row?.pending);
    if (pending) {
      const last = { id: pending.id, kind: pending.kind, outcome: body.dismissed ? 'dismissed' : 'applied', at: Date.now() };
      await db.execute({ sql: 'UPDATE fp_coach SET pending=NULL,last=? WHERE user_id=?', args: [JSON.stringify(last), user.id] });
    }
    return reply({ ok: true });
  }
  if (route === 'GET /api/coach/status') {
    const row = await record(db, user.id);
    const current = parse(row?.current);
    // A timed-out function must not leave this profile permanently busy.
    const stale = current && Date.now() - current.startedAt > 120000;
    if (stale) await db.execute({ sql: 'UPDATE fp_coach SET current=NULL WHERE user_id=? AND current=?', args: [user.id, row.current] });
    const pending = parse(row?.pending);
    return reply({ job: stale ? null : current, pending: pending?.expiresAt > Date.now() ? pending : null,
      cap: { used: row?.daily_date === day() ? Number(row.daily_count) : 0, limit },
      last: stale ? { id: current.id, kind: current.kind, outcome: 'failed', errorClass: 'timeout', at: Date.now() } : parse(row?.last), maxMessageLen: 1000 });
  }
  const kind = route === 'POST /api/coach/plan' ? 'create' : route === 'POST /api/coach/review' ? 'review' : route === 'POST /api/coach/debrief' ? 'debrief' : null;
  if (!kind) return null;
  if (!configured(env)) return fail('off', 503);
  const body = await bodyOf(request);
  const stateRow = (await db.execute({ sql: 'SELECT state FROM fp_documents WHERE user_id=?', args: [user.id] })).rows[0];
  const S = parse(stateRow?.state);
  if (!S) return fail('nostate', 409);
  if (!S.coach?.consent?.agreedAt) return fail('consent', 403);
  if (kind === 'debrief' && !findWorkout(S, body.workoutId)) return fail('noworkout', 400);
  const before = await record(db, user.id);
  const previous = parse(before?.pending);
  const payload = build(S, { handle: createHash('sha256').update(user.id).digest('hex').slice(0, 16), kind,
    intake: body.intake || null, note: String(body.note || '').slice(0, 1000),
    refine: String(body.refine || '').slice(0, 1000), previous: body.refine ? previous?.bundle || null : null,
    workoutId: body.workoutId || null, lang: langTag(body.lang) || 'zh-CN' });
  if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return fail('toolarge', 413);
  const id = randomBytes(8).toString('hex');
  const current = { id, kind, state: 'running', startedAt: Date.now() };
  const tx = await db.transaction('write');
  let generation;
  try {
    const row = (await tx.execute({ sql: 'SELECT * FROM fp_coach WHERE user_id=?', args: [user.id] })).rows[0];
    if (parse(row?.current) && Date.now() - parse(row.current).startedAt < 120000) { await tx.rollback(); return fail('busy', 409); }
    const used = row?.daily_date === day() ? Number(row.daily_count) : 0;
    if (used >= limit) { await tx.rollback(); return fail('cap', 429); }
    generation = Number(row?.generation || 0);
    await tx.execute({ sql: `INSERT INTO fp_coach(user_id,daily_date,daily_count,current,generation) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET daily_date=excluded.daily_date,daily_count=excluded.daily_count,
      current=excluded.current`, args: [user.id, day(), used + 1, JSON.stringify(current), generation] });
    await tx.commit();
  } catch (e) { try { await tx.rollback(); } catch {} throw e; }
  let last;
  let pending = null;
  try {
    const cfg = { providerOptions: { compatible: { baseUrl: env.FITPILOT_AI_BASE_URL } } };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    let attempt;
    try {
      attempt = await runPipeline({ adapter, cfg, kind, payload, model: env.FITPILOT_AI_MODEL,
        timeoutMs: 18000, invokeOpts: { env: { OPENAI_COMPAT_API_KEY: env.FITPILOT_AI_API_KEY }, maxTokens: 6000,
          fetch: env.FITPILOT_AI_FETCH || fetch, retryDelayMs: 0, signal: ctl.signal } });
    } finally { clearTimeout(timer); }
    last = { id, kind, outcome: attempt.ok ? (attempt.nochange ? 'nochange' : 'ready') : 'failed',
      errorClass: attempt.ok ? null : attempt.errorClass, at: Date.now(), ...(attempt.reading ? { reading: attempt.reading } : {}) };
    if (attempt.ok && !attempt.nochange) pending = { id, kind, createdAt: Date.now(), expiresAt: Date.now() + 14 * 86400000,
      planHash: hashPlan(canonicalPlan(S)), iteration: body.refine ? (previous?.iteration || 1) + 1 : 1,
      ...(kind === 'debrief' ? { workout: workoutMeta(S, body.workoutId) } : {}), ...attempt.result };
  } catch (e) {
    console.error('FitPilot Coach failed', e);
    last = { id, kind, outcome: 'failed', errorClass: 'internal', at: Date.now() };
  }
  const latestState = (await db.execute({ sql: 'SELECT state FROM fp_documents WHERE user_id=?', args: [user.id] })).rows[0];
  if (!parse(latestState?.state)?.coach?.consent?.agreedAt) {
    pending = null;
    last = { id, kind, outcome: 'failed', errorClass: 'consent', at: Date.now() };
  }
  // A forget performed during the model call wins; a late response cannot restore private data.
  await db.execute({ sql: 'UPDATE fp_coach SET current=NULL,last=?,pending=? WHERE user_id=? AND generation=? AND current=?',
    args: [JSON.stringify(last), pending ? JSON.stringify(pending) : null, user.id, generation, JSON.stringify(current)] });
  return reply({ job: { id } }, 202);
}
