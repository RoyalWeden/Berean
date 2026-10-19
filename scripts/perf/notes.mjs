import { connect, stats, sleep } from './drive.mjs'
const c = await connect()
const NOTES = { small: '92ec6377-6a24-4e78-99cd-b06c5bf75683', big: '17968161-3132-4e7e-8a27-41eef5d425bf', mid: '7a1bdf45-55ab-4ed2-ba8c-07cc8a9d9481' }
const out = {}
for (const [name, id] of Object.entries(NOTES)) {
  const open = []
  for (let i = 0; i < 6; i++) {
    // open: from the request to the editor showing this note (its doc title / content node)
    open.push(await c.ev(`(async () => { const s = window.__bereanStore.getState(); s.setActiveSpace('notes'); const other = ${JSON.stringify(Object.values(NOTES))}.find(x => x !== ${JSON.stringify(id)}); s.requestOpenNote(other); await new Promise(r => setTimeout(r, 400));
      const t0 = performance.now(); window.__bereanStore.getState().requestOpenNote(${JSON.stringify(id)});
      for (;;) { const pm = document.querySelector('.ProseMirror'); const tab = window.__bereanStore.getState(); const act = tab.tabs.notes.find(t => t.id === tab.activeTabId.notes);
        if (pm && pm.getBoundingClientRect().width > 0 && act?.state?.noteId === ${JSON.stringify(id)} && pm.childElementCount > 0 && pm.dataset.noteId !== 'x') break; if (performance.now() - t0 > 5000) return -1; await new Promise(r => setTimeout(r, 0)) }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round((performance.now() - t0) * 10) / 10 })()`))
    await sleep(300)
  }
  // typing at the end of the document
  await c.ev(`(() => { const pm = [...document.querySelectorAll('.ProseMirror')].find(p => p.getBoundingClientRect().width > 0); pm.focus(); const r = document.createRange(); r.selectNodeContents(pm.lastElementChild || pm); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return 1 })()`)
  await sleep(200)
  const keys = []
  const text = ' benchmark typing'
  for (const ch of text) {
    await c.ev(`(() => { window.__chg = false; const pm = [...document.querySelectorAll('.ProseMirror')].find(p => p.getBoundingClientRect().width > 0); window.__mo?.disconnect(); window.__mo = new MutationObserver(() => { window.__chg = true }); window.__mo.observe(pm, { characterData: true, childList: true, subtree: true }); return 1 })()`)
    await c.arm('window.__chg === true')
    await c.key(ch)
    keys.push(await c.result())
    await sleep(60)
  }
  // remove what was typed (undo-free: Backspace × length) so the note is unchanged
  for (let i = 0; i < text.length; i++) await c.key('Backspace')
  await sleep(1500)
  out[name] = { open: stats(open), keystroke: stats(keys) }
}
console.log(JSON.stringify(out))
c.close()
