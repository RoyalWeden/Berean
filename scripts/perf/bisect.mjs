import { connect, sleep } from './drive.mjs'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const pgid = Number(readFileSync('pgid', 'utf8'))
const c = await connect()
const rend = () => Number(execSync(`${new URL('fp.sh', import.meta.url).pathname} ${pgid}`).toString().split('\n').find((l) => l.startsWith('renderer'))?.split(' ')[1])
const gpu = () => execSync('ps -A -o pgid=,rss=,args=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => Number(p[0]) === pgid && p.join(' ').includes('--type=gpu')).map((p) => Math.round(Number(p[1]) / 1024))[0]
const settle = async () => { await c.send('HeapProfiler.collectGarbage'); await sleep(1500) }
const st = 'const st = () => window.__bereanStore.getState(); const sleep = (ms) => new Promise(r => setTimeout(r, ms));'
const tests = {
  tabs: `st().setActiveSpace('scripture'); await sleep(100); for (const t of st().tabs.scripture.filter(t => !t.state.searchMode)) { st().setActiveTab('scripture', t.id); await sleep(120) }`,
  chapters: `st().setActiveSpace('scripture'); for (let i = 0; i < 6; i++) { window.dispatchEvent(new Event(i % 2 ? 'berean:prevChapter' : 'berean:nextChapter')); await sleep(120) }`,
  find: `st().setActiveSpace('scripture'); st().openFindBar(); await sleep(100); st().setFindBarQuery('lord'); await sleep(200); st().closeFindBar(); await sleep(100)`,
  notes: `st().setActiveSpace('notes'); await sleep(150); for (const t of st().tabs.notes) { st().setActiveTab('notes', t.id); await sleep(120) } st().setActiveSpace('scripture'); await sleep(100)`,
  notesNoImage: `st().setActiveSpace('notes'); await sleep(150); for (const t of st().tabs.notes.filter(t => t.state.noteId !== '17968161-3132-4e7e-8a27-41eef5d425bf')) { st().setActiveTab('notes', t.id); await sleep(120) } st().setActiveSpace('scripture'); await sleep(100)`,
  imageNoteOnly: `st().setActiveSpace('notes'); await sleep(150); const a = st().tabs.notes.find(t => t.state.noteId === '17968161-3132-4e7e-8a27-41eef5d425bf'); const b = st().tabs.notes.find(t => t.state.noteId === '7a1bdf45-55ab-4ed2-ba8c-07cc8a9d9481'); for (let k = 0; k < 3; k++) { st().setActiveTab('notes', a.id); await sleep(150); st().setActiveTab('notes', b.id); await sleep(150) } st().setActiveSpace('scripture'); await sleep(100)`,
  lexicon: `st().openLexiconEntry('G5485'); await sleep(200); st().setActiveSpace('scripture'); await sleep(150)`,
  spaces: `st().setActiveSpace('search'); await sleep(150); st().setActiveSpace('scripture'); await sleep(150)`,
  chatPanel: `st().setAiLookupPanelOpen(true); await sleep(300); st().setAiLookupPanelOpen(false); await sleep(150)`,
}
const only = process.argv[2] ? process.argv[2].split(',') : [...Object.keys(tests), 'floatingSearch']
for (const name of only) {
  await settle(); const r0 = rend(), g0 = gpu()
  for (let i = 0; i < 15; i++) {
    if (name === 'floatingSearch') { await c.key('k', ['meta']); await sleep(200); for (const ch of 'grace') await c.key(ch); await sleep(400); await c.key('Escape'); await sleep(500) }
    else await c.ev(`(async () => { ${st} ${tests[name]}; return 1 })()`)
  }
  await settle(); const r1 = rend(), g1 = gpu()
  console.log(name.padEnd(15), `renderer ${r0} → ${r1} (+${r1 - r0})`, `gpu ${g0} → ${g1} (+${g1 - g0})`)
}
c.close()
