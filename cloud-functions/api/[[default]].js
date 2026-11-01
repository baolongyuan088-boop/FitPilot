import { createClient } from '@libsql/client/web';
import { handle } from '../fitpilot-api.js';

let client;
export async function onRequest({ request, env = {} }) {
  const cfg = { ...process.env, ...env };
  if (!cfg.TURSO_DATABASE_URL || !cfg.TURSO_AUTH_TOKEN || !cfg.FITPILOT_SESSION_SECRET) {
    return Response.json({ error: 'server is not configured' }, { status: 503 });
  }
  client ||= createClient({ url: cfg.TURSO_DATABASE_URL, authToken: cfg.TURSO_AUTH_TOKEN });
  return handle(request, client, cfg);
}
