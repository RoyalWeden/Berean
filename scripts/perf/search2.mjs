import { connect, stats, sleep } from './drive.mjs'
const c = await connect()
const qs = ['grace', 'sabbath day', 'kingdom of heaven', 'yehovah', 'faith hope love', 'righteousness']
const out = {}
for (const q of qs) {
  const lat = []
  for (let i = 0; i < 5; i++) {
    await c.key('k', ['meta']); await sleep(250)
    for (const ch of q.slice(0, -1)) { await c.key(ch); await sleep(40) }
    // results for the FULL query: rows whose text contains the last word
    const w = q.split(' ').pop().toLowerCase()
    await c.arm(`[...document.querySelectorAll('[role=dialog] button[tabindex]')].some(b => b.textContent.toLowerCase().includes(${JSON.stringify(w)}) && /\\d+:\\d+/.test(b.textContent)) && document.querySelector('[role=dialog] input')?.value === ${JSON.stringify(q)}`, 6000)
    await c.key(q.slice(-1))
    lat.push(await c.result())
    await sleep(300)
    await c.key('Escape'); await sleep(600)
  }
  out[q] = stats(lat)
}
console.log(JSON.stringify(out))
c.close()
