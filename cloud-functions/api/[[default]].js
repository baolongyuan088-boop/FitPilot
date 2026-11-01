import { createClient } from '@libsql/client/web';
import { handle } from '../../server/edgeone/fitpilot-api.js';

let client, configuredUrl, configuredToken;
export async function onRequest({ request, env = {} }) {
  const cfg = { ...process.env, ...env };
  const missing = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'FITPILOT_SESSION_SECRET'].filter(name => !cfg[name] || String(cfg[name]).includes('请替换'));
  if (missing.length) {
    return Response.json({ error: 'server is not configured', missing }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!client || cfg.TURSO_DATABASE_URL !== configuredUrl || cfg.TURSO_AUTH_TOKEN !== configuredToken) {
    client?.close();
    client = createClient({ url: cfg.TURSO_DATABASE_URL, authToken: cfg.TURSO_AUTH_TOKEN });
    configuredUrl = cfg.TURSO_DATABASE_URL;
    configuredToken = cfg.TURSO_AUTH_TOKEN;
  }
  return handle(request, client, cfg);
}
