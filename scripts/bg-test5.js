/**
 * bg-test5.js — full-scale end-to-end test: collect ALL 3,271 notes
 *
 * Run with:
 *   BG_USER=you@email.com BG_PASS=yourpass \
 *     /Users/roywe/Berean/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     /Users/roywe/Berean/scripts/bg-test5.js 2>/dev/null
 *
 * Writes results to /tmp/bg-notes-full.json
 * Uses batched parallel fetches for speed (10 concurrent page fetches)
 * Serial API calls with retry logic
 */

const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')

const BG_ORIGIN  = 'https://www.biblegateway.com'
const LOGIN_URL  = `${BG_ORIGIN}/login/`
const PARTITION  = 'persist:bg-test-debug'
const OUT_FILE   = '/tmp/bg-notes-full.json'

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

const FULL_SCALE_SCRIPT = `
(async function() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(msg) { console.log('[FULL] ' + String(msg)); }

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
    'tobit':'Tob','judith':'Jdt','1 maccabees':'1Macc','2 maccabees':'2Macc',
    'wisdom of solomon':'Wis','sirach':'Sir','ecclesiasticus':'Sir',
    'baruch':'Bar','1 enoch':'1En','jubilees':'Jub',
    '2 esdras':'2Esd','1 esdras':'1Esd','4 ezra':'4Ezra',
    'song of the three children':'PrAzar','prayer of manasseh':'PrMan',
    'wisdom':'Wis',
  }

  function toOSIS(ref) {
    const m = ref.match(/^(.+?)\\s+(\\d+)(?::(\\d+))?$/)
    if (!m) return null
    const bookKey = m[1].toLowerCase()
    const ch = m[2], vs = m[3]
    const osis = OSIS_MAP[bookKey]
    if (!osis) return null
    return vs ? osis+'.'+ch+'.'+vs : osis+'.'+ch
  }

  function decodeHTML(html) {
    // Use DOMParser to decode HTML entities
    try {
      const doc = new DOMParser().parseFromString('<span>' + html + '</span>', 'text/html')
      return doc.querySelector('span').textContent
    } catch { return html; }
  }

  // ── Phase 1: Collect all annotation refs ──────────────────────────────────
  log('=== PHASE 1: Collecting all annotation pages ===')

  async function fetchAnnotationPage(offset) {
    const url = offset === 0
      ? 'https://www.biblegateway.com/user/annotations/?iv=notes'
      : 'https://www.biblegateway.com/user/annotations/?iv=notes&i=' + offset
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { credentials: 'include' })
        if (!r.ok) return []
        const html = await r.text()
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const notesList = doc.querySelector('.annotations-list[data-annotations_list_type="notes"]')
        if (!notesList) return []
        const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'))
        return articles.map(function(el) {
          const link = el.querySelector('.bible-item-title a')
          return link ? link.textContent.trim() : null
        }).filter(Boolean)
      } catch(e) {
        if (attempt < 2) await sleep(2000)
      }
    }
    return []
  }

  // Fetch pages in batches of 8 concurrent requests
  const BATCH_SIZE = 8
  const allRefs = [] // may contain duplicates (multiple notes per verse)
  let offset = 0
  let pageNum = 0
  let doneCollecting = false
  const ESTIMATED_TOTAL_PAGES = 135 // slightly over 131 to be safe

  while (!doneCollecting) {
    // Build a batch of offsets
    const batch = []
    for (let b = 0; b < BATCH_SIZE; b++) {
      batch.push(offset)
      if (offset === 0) offset = 26
      else offset += 25
    }

    const batchResults = await Promise.all(batch.map(o => fetchAnnotationPage(o)))
    let batchTotal = 0
    let batchLastEmpty = false
    for (let b = 0; b < batchResults.length; b++) {
      const refs = batchResults[b]
      pageNum++
      if (refs.length === 0) {
        batchLastEmpty = true
        break
      }
      allRefs.push(...refs)
      batchTotal += refs.length
      if (refs.length < 25) {
        doneCollecting = true
        break
      }
    }
    if (batchLastEmpty) doneCollecting = true

    log('Pages collected: ' + pageNum + ' | Total refs so far: ' + allRefs.length)

    if (!doneCollecting && pageNum >= ESTIMATED_TOTAL_PAGES) {
      log('Reached max estimated pages (' + ESTIMATED_TOTAL_PAGES + '), stopping')
      doneCollecting = true
    }

    await sleep(500) // brief pause between batches
  }

  log('Phase 1 complete: ' + allRefs.length + ' total refs from ' + pageNum + ' pages')

  // ── Deduplicate ────────────────────────────────────────────────────────────
  const seenRefs = new Set()
  const uniqueRefs = []
  for (const ref of allRefs) {
    if (!seenRefs.has(ref)) {
      seenRefs.add(ref)
      uniqueRefs.push(ref)
    }
  }
  log('Unique verse refs: ' + uniqueRefs.length + ' (from ' + allRefs.length + ' total)')

  // Check OSIS conversion
  const osisMapped = []
  const osisFailures = []
  for (const ref of uniqueRefs) {
    const osis = toOSIS(ref)
    if (!osis) { osisFailures.push(ref); log('OSIS FAIL: ' + ref); }
    else osisMapped.push({ ref, osis })
  }
  log('OSIS failures: ' + osisFailures.length + ' | Mapped: ' + osisMapped.length)
  if (osisFailures.length > 0) log('Failed refs: ' + JSON.stringify(osisFailures))

  // ── Phase 2: Fetch note content for each unique verse ─────────────────────
  log('=== PHASE 2: Fetching note content (' + osisMapped.length + ' API calls) ===')

  async function fetchVerseNotes(ref, osis) {
    const apiUrl = 'https://www.biblegateway.com/user/notes/?reference=' + encodeURIComponent(osis) + '&publication=kjv&start=0'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(apiUrl, {
          credentials: 'include',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const data = await r.json()
        const notes = (data.notes || []).filter(n => n.type === 'note')
        return notes.map(n => ({
          verseRef: ref,
          osis: osis,
          noteId: n.id,
          content: decodeHTML(n.content || ''),
          color: n.color || '',
          createdAt: n.created_time,
          updatedAt: n.updated,
        }))
      } catch(e) {
        if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        return null // failed after retries
      }
    }
    return null
  }

  const writtenNotes = []
  let apiDone = 0
  let apiFailed = 0
  const failedRefs = []
  const startTime = Date.now()

  for (const item of osisMapped) {
    const result = await fetchVerseNotes(item.ref, item.osis)
    apiDone++

    if (result === null) {
      apiFailed++
      failedRefs.push(item.ref)
    } else {
      writtenNotes.push(...result)
    }

    // Progress every 50 calls
    if (apiDone % 50 === 0 || apiDone === osisMapped.length) {
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      const eta = apiDone > 0 ? Math.round((elapsed / apiDone) * (osisMapped.length - apiDone)) : 0
      log('API progress: ' + apiDone + '/' + osisMapped.length +
          ' | notes: ' + writtenNotes.length +
          ' | errors: ' + apiFailed +
          ' | elapsed: ' + elapsed + 's | ETA: ' + eta + 's')
    }

    await sleep(80) // ~12 calls/second, conservative
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalElapsed = Math.round((Date.now() - startTime) / 1000)
  log('=== FINAL RESULTS ===')
  log('Total annotation entries: ' + allRefs.length)
  log('Unique verse refs: ' + uniqueRefs.length)
  log('OSIS failures: ' + osisFailures.length)
  log('API calls: ' + apiDone + ' | Errors: ' + apiFailed)
  log('Written notes collected: ' + writtenNotes.length)
  log('Total time: ' + totalElapsed + 's')

  if (failedRefs.length > 0) {
    log('Failed verse refs: ' + JSON.stringify(failedRefs.slice(0, 20)))
  }

  // Sample notes
  log('\\nSample notes:')
  writtenNotes.slice(0, 5).forEach(function(n, i) {
    log('[' + i + '] ' + n.verseRef + ' | ' + n.content.slice(0, 100))
  })

  return JSON.stringify({
    summary: {
      totalAnnotationEntries: allRefs.length,
      uniqueVerseRefs: uniqueRefs.length,
      osisFailures: osisFailures.length,
      failedOsisRefs: osisFailures,
      apiCalls: apiDone,
      apiErrors: apiFailed,
      failedApiRefs: failedRefs,
      writtenNotesCollected: writtenNotes.length,
      totalElapsedSeconds: totalElapsed,
    },
    notes: writtenNotes,
  })
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
    console.log('[TEST5] Exiting', code)
    app.exit(code)
  }
  setTimeout(() => { console.log('[TEST5] TIMEOUT'); quit(1) }, 20 * 60 * 1000)
  win.on('closed', () => { if (!testDone) quit(1) })

  win.webContents.on('console-message', (_e, _level, msg) => {
    if (msg.startsWith('[FULL]')) process.stdout.write(msg + '\n')
  })

  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL()
    console.log(`[TEST5][${phase}] did-finish-load → ${url}`)

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
      console.log('[TEST5] fillLoginForm:', result)
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
        else { console.error('[TEST5] Login failed'); quit(1) }
      }, 5000)
      return
    }
    if (isLogin) {
      if (loginSubmittedAt && Date.now() - loginSubmittedAt > 6000) { console.error('[TEST5] Bad credentials'); quit(1) }
      return
    }

    if (isAnnotations && phase === 'login') {
      phase = 'fullscan'
      console.log('[TEST5] On annotations page — waiting 2s then running full scan')
      await new Promise(r => setTimeout(r, 2000))

      console.log('[TEST5] Starting full-scale pipeline...')
      const resultJson = await win.webContents.executeJavaScript(FULL_SCALE_SCRIPT).catch(e => {
        console.error('[TEST5] Script error:', e.message)
        return JSON.stringify({ error: e.message })
      })

      try {
        const result = JSON.parse(resultJson)
        const s = result.summary || {}
        console.log('\n[TEST5] ============ FINAL SUMMARY ============')
        console.log('Total annotation list entries:', s.totalAnnotationEntries)
        console.log('Unique verse refs:            ', s.uniqueVerseRefs)
        console.log('OSIS conversion failures:     ', s.osisFailures)
        if (s.failedOsisRefs && s.failedOsisRefs.length > 0) {
          console.log('Failed OSIS refs:', JSON.stringify(s.failedOsisRefs))
        }
        console.log('API calls made:               ', s.apiCalls)
        console.log('API errors:                   ', s.apiErrors)
        if (s.failedApiRefs && s.failedApiRefs.length > 0) {
          console.log('Failed API refs:', JSON.stringify(s.failedApiRefs.slice(0, 10)))
        }
        console.log('Written notes collected:      ', s.writtenNotesCollected)
        console.log('Total time:                   ', s.totalElapsedSeconds, 's')

        // Write full results to file
        fs.writeFileSync(OUT_FILE, resultJson, 'utf8')
        console.log('\n[TEST5] Full results written to:', OUT_FILE)
        console.log('[TEST5] Sample first 5 notes:')
        if (result.notes) {
          result.notes.slice(0, 5).forEach((n, i) => {
            console.log(`  [${i}] ${n.verseRef} | "${n.content.slice(0, 120)}"`)
          })
        }
      } catch(e) {
        console.error('[TEST5] Parse error:', e.message)
        console.log(resultJson.slice(0, 2000))
      }

      quit(0)
      return
    }

    if (!isAnnotations) {
      console.log('[TEST5] Intermediate page, navigating to annotations')
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    }
  })

  console.log('[TEST5] Loading login URL')
  win.loadURL(LOGIN_URL)
})

app.on('window-all-closed', () => {})
