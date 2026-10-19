import { spawn } from 'node:child_process'
const S = process.env.PERF_DIR || '/tmp/berean-perf'
const c = spawn(new URL('../../node_modules/.bin/electron', import.meta.url).pathname, ['.'], { cwd: new URL('../..', import.meta.url).pathname, detached: true, stdio: 'ignore', env: { ...process.env, BEREAN_QA_USER_DATA: process.env.PERF_USER || `${S}/userdata`, BEREAN_CDP_PORT: '9224', ELECTRON_RENDERER_URL: '', BEREAN_PERF_LOG: `${S}/early.log` } })
console.log(c.pid); c.unref()
