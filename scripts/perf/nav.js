const b = window.__b
const out = {}
const chap = () => document.querySelector('[data-verse-row]')?.getAttribute('data-chapter') + '|' + document.querySelector('[data-verse-row]')?.getAttribute('data-book')
// W1 next / previous chapter (the toolbar's event)
let r = []
for (let i = 0; i < 12; i++) {
  const before = chap()
  r.push(await b.measure(() => window.dispatchEvent(new Event(i % 2 ? 'berean:prevChapter' : 'berean:nextChapter')), () => chap() !== before))
  await b.sleep(250)
}
out.chapterNav = b.stats(r.slice(2)); out.chapterNavRaw = r.map((x) => x.ms)
// W2 switch between Scripture tabs
const s = b.st(); const ids = s.tabs.scripture.map((t) => t.id); const start = s.activeTabId.scripture
r = []
for (let i = 0; i < 12; i++) {
  const id = ids[(ids.indexOf(b.st().activeTabId.scripture) + 1) % ids.length]
  const want = b.st().tabs.scripture.find((t) => t.id === id).state
  r.push(await b.measure(() => b.st().setActiveTab('scripture', id), () => { const v = document.querySelector('[data-verse-row]'); return !want.bookId || (v && v.getAttribute('data-book') === want.bookId && v.getAttribute('data-chapter') === String(want.chapter)) }))
  await b.sleep(250)
}
b.st().setActiveTab('scripture', start)
out.tabSwitch = b.stats(r.slice(2)); out.tabSwitchRaw = r.map((x) => x.ms)
await b.sleep(400)
// W3 space switch Scripture ↔ Notes
r = []
for (let i = 0; i < 12; i++) {
  const to = i % 2 ? 'scripture' : 'notes'
  r.push(await b.measure(() => b.st().setActiveSpace(to), () => (to === 'scripture' ? !!document.querySelector('[data-verse-row]') : !!document.querySelector('.ProseMirror, [data-notes-home]'))))
  await b.sleep(300)
}
b.st().setActiveSpace('scripture')
out.spaceSwitch = b.stats(r.slice(2)); out.spaceSwitchRaw = r.map((x) => x.ms)
return out
