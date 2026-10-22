// FitPilot local launcher. Credentials stay in the API's ignored data directory.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url))
const env = { ...process.env, PORT: '3000', ORIGIN: 'http://localhost:5173', RP_ID: 'localhost', RP_NAME: 'baolong战士', DEFAULT_LANG: 'zh', DATA_DIR: resolve(root, 'data'), PASSWORD_LOGIN: '1' }
const children = [
  spawn(process.execPath, ['server.js'], { cwd: resolve(root, 'api'), env, stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '--', '--mode', 'fitpilot', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: resolve(root, 'frontend'), env: { ...process.env, API_TARGET: 'http://127.0.0.1:3000', API_ORIGIN: env.ORIGIN }, stdio: 'inherit' })
]
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(c => c.kill('SIGTERM')); process.exitCode = code }
for (const c of children) { c.on('error', e => { console.error(e.message); stop(1) }); c.on('exit', code => stop(code || 0)) }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop())
