import { connect, stats, sleep } from './drive.mjs'
const c = await connect('chat=1')
const delay = Number(process.argv[2] || 400)
const echo = [], count = []
for (let k = 0; k < 4; k++) {
  await c.ev(`(async () => { const row = [...document.querySelectorAll('nav [data-roving]')].find(r => r.textContent.startsWith('Perf study 9')); row?.click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('nav [data-roving]')].find(r => r.textContent.startsWith('Perf long')).click(); return 1 })()`)
  await sleep(700)
  await c.key('f', ['meta']); await sleep(delay)
  let q = ''
  for (const ch of 'grace') {
    q += ch
    await c.arm(`document.querySelector('[data-find-bar] input')?.value === ${JSON.stringify(q)}`); await c.key(ch); echo.push(await c.result())
  }
  // time from the last keystroke until the final count is up (all rows in)
  count.push(await c.ev(`(async () => { const t0 = performance.now(); let last = ''; let since = t0; for (;;) { const t = document.querySelector('[data-find-bar]')?.textContent || ''; if (t !== last) { last = t; since = performance.now() } if (performance.now() - since > 400 && /of/.test(t)) break; if (performance.now() - t0 > 8000) break; await new Promise(r => setTimeout(r, 10)) } return [Math.round(since - t0), last] })()`))
  await c.key('Escape'); await sleep(400)
}
console.log(JSON.stringify({ delayAfterCmdF: delay, echo: stats(echo), echoRaw: echo, finalCount: count }))
c.close()
