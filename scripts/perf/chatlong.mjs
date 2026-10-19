import { connect, stats, sleep } from './drive.mjs'
const c = await connect('chat=1')
const open = []
for (let i = 0; i < 5; i++) {
  // away to a small conversation, then back to the long one (search the sidebar for its row)
  await c.ev(`(async () => { for (const h of document.querySelectorAll('.chat-group-toggle[aria-expanded=false]')) h.click(); return 1 })()`); await sleep(300)
  await c.ev(`[...document.querySelectorAll('nav [data-roving]')].find(r => r.textContent.startsWith('Perf study 5'))?.click(); 1`); await sleep(500)
  open.push(await c.ev(`(async () => { const row = [...document.querySelectorAll('nav [data-roving]')].find(r => r.textContent.startsWith('Perf long')); const log = document.querySelector('[role=log]'); const t0 = performance.now(); row.click();
    for (;;) { if (document.querySelector('header')?.textContent.includes('Perf long') && log.querySelectorAll('[data-message-id]').length > 50) break; if (performance.now() - t0 > 8000) return -1; await new Promise(r => setTimeout(r, 0)) }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t0) })()`))
  await sleep(400)
}
const rows = await c.ev(`document.querySelectorAll('[role=log] [data-message-id]').length`)
const dom = await c.ev(`document.getElementsByTagName('*').length`)
// typing in the composer with the long conversation open
await c.ev(`document.querySelector('[role=textbox][aria-label=Message]').focus(); 1`); await sleep(200)
const keys = []
for (const ch of 'typing while long') {
  await c.ev(`(() => { window.__chg = false; const pm = document.querySelector('[role=textbox][aria-label=Message]'); window.__mo?.disconnect(); window.__mo = new MutationObserver(() => { window.__chg = true }); window.__mo.observe(pm, { characterData: true, childList: true, subtree: true }); return 1 })()`)
  await c.arm('window.__chg === true'); await c.key(ch); keys.push(await c.result()); await sleep(40)
}
for (let i = 0; i < 17; i++) await c.key('Backspace')
// show earlier messages (grow the window) + find in conversation
const earlier = await c.ev(`(async () => { const b = [...document.querySelectorAll('[role=log] button')].find(x => x.textContent.includes('Show Earlier')); if (!b) return -2; const n0 = document.querySelectorAll('[role=log] [data-message-id]').length; const t0 = performance.now(); b.click(); for (;;) { if (document.querySelectorAll('[role=log] [data-message-id]').length > n0) break; if (performance.now() - t0 > 5000) return -1; await new Promise(r => setTimeout(r, 0)) } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t0) })()`)
await c.key('f', ['meta']); await sleep(400)
const find = []
let q = ''
for (const ch of 'grace') { q += ch; await c.arm(`/\\d+ of \\d+/.test(document.querySelector('[data-find-bar]')?.textContent || '') && document.querySelector('[data-find-bar] input')?.value === ${JSON.stringify(q)}`, 8000); await c.key(ch); find.push(await c.result()) }
const findText = await c.ev(`document.querySelector('[data-find-bar]')?.textContent`)
await c.key('Escape')
console.log(JSON.stringify({ openLong: stats(open), rowsRendered: rows, dom, keystroke: stats(keys), showEarlier: earlier, findKeystrokes: find, findText }))
c.close()
