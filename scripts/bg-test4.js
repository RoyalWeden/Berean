/**
 * bg-test4.js — validate full pipeline: HTML-fetch all annotation pages + per-verse API calls
 *
 * Run with:
 *   BG_USER=you@email.com BG_PASS=yourpass \
 *     /Users/roywe/Berean/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     /Users/roywe/Berean/scripts/bg-test4.js 2>/dev/null
 *
 * Tests:
 * 1. HTML-fetch (DOMParser) approach to collect all verse refs without navigation
 * 2. OSIS conversion for all book names seen in the first few pages
 * 3. Per-verse /user/notes/ API calls to get note content
 * 4. Verify `content` field is full note body (not truncated)
 * 5. Full pipeline for first 3 pages (75 notes) → unique refs → API calls → content
 *
 * Also verifies: note `content` vs `title` length to confirm full content is returned
 */

const { app, BrowserWindow, session } = require('electron')

const BG_ORIGIN  = 'https://www.biblegateway.com'
const LOGIN_URL  = `${BG_ORIGIN}/login/`
const PARTITION  = 'persist:bg-test-debug'

const USERNAME = process.env.BG_USER || ''
const PASSWORD = process.env.BG_PASS || ''
if (!USERNAME || !PASSWORD) { console.error('Set BG_USER and BG_PASS'); process.exit(1) }

const FILL_SCRIPT = (u, p) => `
(function() {
  const f = document.querySelector('form[action="/login/"]') ||
            document.querySelector('.login-current form');
  if (!f) return 'no-form';
  const e = f.querySelector('input[type="email"],input[name="email"]');
  const pw = f.querySelector('input[type="password"],input[name="password"]');
  if (!e || !pw) return 'no-inputs';
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  s.call(e, ${JSON.stringify(u)}); e.dispatchEvent(new Event('input',{bubbles:true}));
  s.call(pw, ${JSON.stringify(p)}); pw.dispatchEvent(new Event('input',{bubbles:true}));
  const b = f.querySelector('input[type="submit"],button[type="submit"],.btn');
  if (b) { b.click(); return 'clicked'; }
  f.submit(); return 'submitted';
})()
`

// ── Full pipeline script ────────────────────────────────────────────────────
// Runs entirely within the BG page context (same-origin fetches)
const FULL_PIPELINE_SCRIPT = `
(async function() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(msg) { console.log('[PIPE] ' + msg); }

  // ── OSIS conversion table ─────────────────────────────────────────────────
  const OSIS_MAP = {
    'genesis':'Gen','exodus':'Exod','leviticus':'Lev','numbers':'Num',
    'deuteronomy':'Deut','joshua':'Josh','judges':'Judg','ruth':'Ruth',
    '1 samuel':'1Sam','2 samuel':'2Sam','1 kings':'1Kgs','2 kings':'2Kgs',
    '1 chronicles':'1Chr','2 chronicles':'2Chr','ezra':'Ezra','nehemiah':'Neh',
    'esther':'Esth','job':'Job','psalm':'Ps','psalms':'Ps','proverbs':'Prov',
    'ecclesiastes':'Eccl','song of solomon':'Song','song of songs':'Song',
    'isaiah':'Isa','jeremiah':'Jer','lamentations':'Lam','ezekiel':'Ezek',
    'daniel':'Dan','hosea':'Hos','joel':'Joel','amos':'Amos','obadiah':'Obad',
    'jonah':'Jonah','micah':'Mic','nahum':'Nah','habakkuk':'Hab',
    'zephaniah':'Zeph','haggai':'Hag','zechariah':'Zech','malachi':'Mal',
    'matthew':'Matt','mark':'Mark','luke':'Luke','john':'John',
    'acts':'Acts','romans':'Rom',
    '1 corinthians':'1Cor','2 corinthians':'2Cor',
    'galatians':'Gal','ephesians':'Eph','philippians':'Phil','colossians':'Col',
    '1 thessalonians':'1Thess','2 thessalonians':'2Thess',
    '1 timothy':'1Tim','2 timothy':'2Tim','titus':'Titus','philemon':'Phlm',
    'hebrews':'Heb','james':'Jas',
    '1 peter':'1Pet','2 peter':'2Pet',
    '1 john':'1John','2 john':'2John','3 john':'3John',
    'jude':'Jude','revelation':'Rev',
    // Apocrypha / extras that might appear
    'tobit':'Tob','judith':'Jdt','1 maccabees':'1Macc','2 maccabees':'2Macc',
    'wisdom of solomon':'Wis','sirach':'Sir','ecclesiasticus':'Sir',
    'baruch':'Bar','1 enoch':'1En','jubilees':'Jub',
  }

  function toOSIS(ref) {
    const m = ref.match(/^(.+?)\\s+(\\d+)(?::(\\d+))?$/)
    if (!m) { log('OSIS FAIL: ' + ref); return null; }
    const bookKey = m[1].toLowerCase()
    const ch = m[2], vs = m[3]
    const osis = OSIS_MAP[bookKey]
    if (!osis) { log('OSIS UNKNOWN BOOK: ' + m[1]); return null; }
    return vs ? osis+'.'+ch+'.'+vs : osis+'.'+ch
  }

  // ── Step 1: HTML-fetch annotation pages ──────────────────────────────────
  log('=== STEP 1: Fetch first 3 annotation pages via HTML fetch ===')

  async function fetchAnnotationPage(offset) {
    const url = offset === 0
      ? 'https://www.biblegateway.com/user/annotations/?iv=notes'
      : 'https://www.biblegateway.com/user/annotations/?iv=notes&i=' + offset
    try {
      const r = await fetch(url, { credentials: 'include' })
      if (!r.ok) { log('Page fetch failed: ' + offset + ' status=' + r.status); return []; }
      const html = await r.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const notesList = doc.querySelector('.annotations-list[data-annotations_list_type="notes"]')
      if (!notesList) { log('No notes list on page offset=' + offset); return []; }
      const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'))
      return articles.map(function(el) {
        const link = el.querySelector('.bible-item-title a')
        const verseRef = link ? link.textContent.trim() : null
        const verseHref = link ? link.getAttribute('href') : ''
        return verseRef ? { verseRef, verseHref } : null
      }).filter(Boolean)
    } catch(e) {
      log('Fetch error at offset ' + offset + ': ' + e.message)
      return []
    }
  }

  // Fetch pages 1, 2, 3 (offsets 0, 26, 51)
  const pagesToTest = [0, 26, 51]
  const allRefs = []
  for (const offset of pagesToTest) {
    log('Fetching annotation page offset=' + offset)
    const refs = await fetchAnnotationPage(offset)
    log('  Got ' + refs.length + ' refs from offset=' + offset)
    refs.forEach(r => log('    ' + r.verseRef))
    allRefs.push(...refs)
    await sleep(300)
  }

  log('Total refs collected: ' + allRefs.length)

  // ── Step 2: Deduplicate ───────────────────────────────────────────────────
  const uniqueRefs = []
  const seenRefs = new Set()
  for (const item of allRefs) {
    if (!seenRefs.has(item.verseRef)) {
      seenRefs.add(item.verseRef)
      uniqueRefs.push(item)
    }
  }
  log('Unique refs: ' + uniqueRefs.length + ' (from ' + allRefs.length + ' total)')

  // ── Step 3: Convert to OSIS and check ────────────────────────────────────
  log('=== STEP 2: OSIS conversion check ===')
  const osisMap = []
  for (const item of uniqueRefs) {
    const osis = toOSIS(item.verseRef)
    osisMap.push({ verseRef: item.verseRef, osis })
    if (!osis) log('  FAILED: ' + item.verseRef)
    else log('  ' + item.verseRef + ' → ' + osis)
  }
  const failedOsis = osisMap.filter(x => !x.osis)
  log('OSIS failures: ' + failedOsis.length)

  // ── Step 4: Fetch /user/notes/ API for each unique verse ─────────────────
  log('=== STEP 3: Fetch notes API for each unique verse ===')
  const writtenNotes = []
  let apiCallCount = 0
  let totalNoteItems = 0
  let apiErrors = 0

  for (const item of osisMap) {
    if (!item.osis) continue
    apiCallCount++
    try {
      const apiUrl = 'https://www.biblegateway.com/user/notes/?reference=' + encodeURIComponent(item.osis) + '&publication=kjv&start=0'
      const r = await fetch(apiUrl, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      })
      if (!r.ok) { log('API failed for ' + item.osis + ': ' + r.status); apiErrors++; continue; }
      const data = await r.json()
      const notes = data.notes || []
      const total = data.info ? data.info.total : notes.length
      totalNoteItems += total

      const justNotes = notes.filter(n => n.type === 'note')
      for (const note of justNotes) {
        writtenNotes.push({
          verseRef: item.verseRef,
          osis: item.osis,
          noteId: note.id,
          content: note.content || '',
          title: note.title || '',
          color: note.color || '',
          createdTime: note.created_time,
          updatedTime: note.updated,
          contentLen: (note.content || '').length,
          titleLen: (note.title || '').length,
          titleMatchesContent: note.title === note.content,
        })
      }

      const justHighlights = notes.filter(n => n.type === 'highlight')
      log('  ' + item.osis + ': total=' + total + ' notes=' + justNotes.length + ' highlights=' + justHighlights.length +
          (justNotes.length > 0 ? ' content[0]="' + (justNotes[0].content || '').slice(0,80) + '"' : ''))
    } catch(e) {
      log('  API error for ' + item.osis + ': ' + e.message)
      apiErrors++
    }
    await sleep(100) // small delay to avoid hammering BG
  }

  // ── Step 5: Report ────────────────────────────────────────────────────────
  log('=== RESULTS ===')
  log('API calls made: ' + apiCallCount)
  log('API errors: ' + apiErrors)
  log('Written notes found: ' + writtenNotes.length)
  log('Avg content length: ' + (writtenNotes.length > 0 ? Math.round(writtenNotes.reduce((s,n)=>s+n.contentLen,0)/writtenNotes.length) : 0) + ' chars')
  log('Notes where title !== content: ' + writtenNotes.filter(n => !n.titleMatchesContent).length)
  log('Longest note: ' + Math.max(...writtenNotes.map(n=>n.contentLen)) + ' chars')

  log('\\n=== SAMPLE NOTES (first 10) ===')
  writtenNotes.slice(0, 10).forEach(function(n, i) {
    log('[' + i + '] ' + n.verseRef + ' | titleMatchesContent=' + n.titleMatchesContent +
        ' | contentLen=' + n.contentLen + ' | content="' + n.content.slice(0, 200) + '"')
  })

  // Find notes where content differs from title (indicates title is truncated)
  const titleDiffers = writtenNotes.filter(n => !n.titleMatchesContent)
  if (titleDiffers.length > 0) {
    log('\\n=== NOTES WHERE TITLE != CONTENT ===')
    titleDiffers.slice(0, 5).forEach(function(n) {
      log('  ' + n.verseRef + ' | title="' + n.title.slice(0,80) + '" | content[0:200]="' + n.content.slice(0,200) + '"')
    })
  }

  return JSON.stringify({
    refsCollected: allRefs.length,
    uniqueRefs: uniqueRefs.length,
    osisFailed: failedOsis.length,
    apiCalls: apiCallCount,
    apiErrors,
    writtenNotesFound: writtenNotes.length,
    avgContentLen: writtenNotes.length > 0 ? Math.round(writtenNotes.reduce((s,n)=>s+n.contentLen,0)/writtenNotes.length) : 0,
    maxContentLen: writtenNotes.length > 0 ? Math.max(...writtenNotes.map(n=>n.contentLen)) : 0,
    titleDiffersCount: titleDiffers.length,
    notes: writtenNotes,
  }, null, 2)
})()
`

app.whenReady().then(async () => {
  const sess = session.fromPartition(PARTITION)

  const win = new BrowserWindow({
    show: false,
    width: 1400, height: 900,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  let loginAttempted = false
  let loginSubmittedAt = 0
  let testDone = false
  let phase = 'login'

  function quit(code = 0) {
    if (testDone) return; testDone = true
    console.log('[TEST4] Exiting', code)
    app.exit(code)
  }
  setTimeout(() => { console.log('[TEST4] TIMEOUT'); quit(1) }, 10 * 60 * 1000)
  win.on('closed', () => { if (!testDone) quit(1) })

  win.webContents.on('console-message', (_e, _level, msg) => {
    if (msg.startsWith('[PIPE]')) console.log(msg)
  })

  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL()
    console.log(`[TEST4][${phase}] did-finish-load → ${url}`)

    const isLogin = /biblegateway\.com\/login(\/|$|\?)/.test(url)
    const isAnnotations = url.includes('/user/annotations') || url.includes('iv=notes')

    if (isLogin && !loginAttempted) {
      loginAttempted = true
      const deadline = Date.now() + 10000
      let result = null
      while (Date.now() < deadline) {
        result = await win.webContents.executeJavaScript(FILL_SCRIPT(USERNAME, PASSWORD)).catch(() => null)
        if (result && result !== 'no-form' && result !== 'no-inputs') break
        await new Promise(r => setTimeout(r, 500))
      }
      console.log('[TEST4] fillLoginForm:', result)
      loginSubmittedAt = Date.now()
      setTimeout(async () => {
        if (testDone) return
        const curUrl = win.webContents.getURL()
        if (curUrl.includes('/user/annotations') || curUrl.includes('iv=notes')) return
        if (!/biblegateway\.com\/login/.test(curUrl)) {
          win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
          return
        }
        const formGone = await win.webContents.executeJavaScript(
          `!(document.querySelector('form[action="/login/"]') || document.querySelector('.login-current form'))`
        ).catch(() => false)
        if (formGone) win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
        else { console.error('[TEST4] Login failed'); quit(1) }
      }, 5000)
      return
    }
    if (isLogin) {
      if (loginSubmittedAt && Date.now() - loginSubmittedAt > 6000) { console.error('[TEST4] Bad credentials'); quit(1) }
      return
    }

    if (isAnnotations && phase === 'login') {
      phase = 'pipeline'
      console.log('[TEST4] On annotations page — waiting 2s then running pipeline')
      await new Promise(r => setTimeout(r, 2000))

      console.log('[TEST4] Running full pipeline script...')
      const result = await win.webContents.executeJavaScript(FULL_PIPELINE_SCRIPT).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST4] Pipeline complete.')

      try {
        const parsed = JSON.parse(result)
        console.log('\n[TEST4] === SUMMARY ===')
        console.log('Refs collected from 3 pages:', parsed.refsCollected)
        console.log('Unique verse refs:', parsed.uniqueRefs)
        console.log('OSIS conversion failures:', parsed.osisFailed)
        console.log('API calls made:', parsed.apiCalls)
        console.log('API errors:', parsed.apiErrors)
        console.log('Written notes found:', parsed.writtenNotesFound)
        console.log('Avg note content length:', parsed.avgContentLen, 'chars')
        console.log('Longest note:', parsed.maxContentLen, 'chars')
        console.log('Notes where title != content:', parsed.titleDiffersCount)

        if (parsed.notes && parsed.notes.length > 0) {
          console.log('\n[TEST4] All notes from pages 1-3:')
          parsed.notes.forEach(function(n, i) {
            console.log(`  [${i}] ${n.verseRef} (${n.osis}) | len=${n.contentLen} | titleMatch=${n.titleMatchesContent}`)
            console.log(`       content: "${n.content.slice(0, 300)}"`)
          })
        }
      } catch {
        console.log(result.slice(0, 5000))
      }

      quit(0)
      return
    }

    if (!isAnnotations) {
      console.log('[TEST4] Intermediate page, navigating to annotations')
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    }
  })

  console.log('[TEST4] Loading login URL')
  win.loadURL(LOGIN_URL)
})

app.on('window-all-closed', () => {})
