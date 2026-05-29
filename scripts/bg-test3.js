/**
 * bg-test3.js — probe the /user/notes/ API endpoint discovered in test2
 *
 * Run with:
 *   BG_USER=you@email.com BG_PASS=yourpass \
 *     /Users/roywe/Berean/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     /Users/roywe/Berean/scripts/bg-test3.js 2>/dev/null
 *
 * Discovered in test2: passage page makes XHR to:
 *   /user/notes/?reference=Heb.11.6&publication=kjv&start=0
 *
 * Goals:
 * 1. Fetch that endpoint and see full JSON structure
 * 2. Test no-reference variant (all notes bulk fetch)
 * 3. Test pagination (?start=25, ?start=50, etc.)
 * 4. Test GraphQL endpoint for notes
 * 5. Paginate the annotations list to collect all verse refs (count total unique refs)
 * 6. Verify OSIS reference format conversion (Hebrews 11:6 → Heb.11.6)
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

// ── OSIS reference converter (basic, covers common cases) ──────────────────
// "Hebrews 11:6" → "Heb.11.6"
// "1 John 2:6" → "1John.2.6"
// We'll run this in-browser so we get BG's real OSIS format by observing the network request
const OSIS_MAP = {
  'genesis': 'Gen', 'exodus': 'Exod', 'leviticus': 'Lev', 'numbers': 'Num',
  'deuteronomy': 'Deut', 'joshua': 'Josh', 'judges': 'Judg', 'ruth': 'Ruth',
  '1 samuel': '1Sam', '2 samuel': '2Sam', '1 kings': '1Kgs', '2 kings': '2Kgs',
  '1 chronicles': '1Chr', '2 chronicles': '2Chr', 'ezra': 'Ezra', 'nehemiah': 'Neh',
  'esther': 'Esth', 'job': 'Job', 'psalm': 'Ps', 'psalms': 'Ps', 'proverbs': 'Prov',
  'ecclesiastes': 'Eccl', 'song of solomon': 'Song', 'song of songs': 'Song',
  'isaiah': 'Isa', 'jeremiah': 'Jer', 'lamentations': 'Lam', 'ezekiel': 'Ezek',
  'daniel': 'Dan', 'hosea': 'Hos', 'joel': 'Joel', 'amos': 'Amos', 'obadiah': 'Obad',
  'jonah': 'Jonah', 'micah': 'Mic', 'nahum': 'Nah', 'habakkuk': 'Hab',
  'zephaniah': 'Zeph', 'haggai': 'Hag', 'zechariah': 'Zech', 'malachi': 'Mal',
  'matthew': 'Matt', 'mark': 'Mark', 'luke': 'Luke', 'john': 'John',
  'acts': 'Acts', 'romans': 'Rom',
  '1 corinthians': '1Cor', '2 corinthians': '2Cor',
  'galatians': 'Gal', 'ephesians': 'Eph', 'philippians': 'Phil', 'colossians': 'Col',
  '1 thessalonians': '1Thess', '2 thessalonians': '2Thess',
  '1 timothy': '1Tim', '2 timothy': '2Tim', 'titus': 'Titus', 'philemon': 'Phlm',
  'hebrews': 'Heb', 'james': 'Jas',
  '1 peter': '1Pet', '2 peter': '2Pet',
  '1 john': '1John', '2 john': '2John', '3 john': '3John',
  'jude': 'Jude', 'revelation': 'Rev',
}

function toOSIS(ref) {
  // "Hebrews 11:6" → "Heb.11.6"
  const m = ref.match(/^(.+?)\s+(\d+)(?::(\d+))?$/)
  if (!m) return null
  const bookKey = m[1].toLowerCase()
  const ch = m[2]
  const vs = m[3]
  const osis = OSIS_MAP[bookKey]
  if (!osis) return null
  return vs ? `${osis}.${ch}.${vs}` : `${osis}.${ch}`
}

// ── Main probe script executed in-page ─────────────────────────────────────
const PROBE_SCRIPT = `
(async function() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  const results = {};

  // 1. Known verse with a note: Heb.11.6
  console.log('[PROBE] Fetching /user/notes/?reference=Heb.11.6&publication=kjv&start=0');
  try {
    const r1 = await fetch('https://www.biblegateway.com/user/notes/?reference=Heb.11.6&publication=kjv&start=0', {
      credentials: 'include',
      headers: { 'Accept': 'application/json, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const t1 = await r1.text();
    results['heb116'] = { status: r1.status, contentType: r1.headers.get('content-type'), body: t1.slice(0, 2000) };
    console.log('[PROBE] heb116 status:', r1.status, 'content-type:', r1.headers.get('content-type'));
    console.log('[PROBE] heb116 body (first 1000):', t1.slice(0, 1000));
  } catch(e) { results['heb116'] = { error: e.message }; }

  await sleep(500);

  // 2. No reference — bulk all notes
  console.log('[PROBE] Fetching /user/notes/?start=0 (no reference)');
  try {
    const r2 = await fetch('https://www.biblegateway.com/user/notes/?start=0', {
      credentials: 'include',
      headers: { 'Accept': 'application/json, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const t2 = await r2.text();
    results['bulk0'] = { status: r2.status, contentType: r2.headers.get('content-type'), body: t2.slice(0, 2000) };
    console.log('[PROBE] bulk0 status:', r2.status, 'content-type:', r2.headers.get('content-type'));
    console.log('[PROBE] bulk0 body (first 1000):', t2.slice(0, 1000));
  } catch(e) { results['bulk0'] = { error: e.message }; }

  await sleep(500);

  // 3. Bulk with start=25
  console.log('[PROBE] Fetching /user/notes/?start=25 (no reference)');
  try {
    const r3 = await fetch('https://www.biblegateway.com/user/notes/?start=25', {
      credentials: 'include',
      headers: { 'Accept': 'application/json, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const t3 = await r3.text();
    results['bulk25'] = { status: r3.status, contentType: r3.headers.get('content-type'), body: t3.slice(0, 2000) };
    console.log('[PROBE] bulk25 status:', r3.status, 'content-type:', r3.headers.get('content-type'));
    console.log('[PROBE] bulk25 body (first 500):', t3.slice(0, 500));
  } catch(e) { results['bulk25'] = { error: e.message }; }

  await sleep(500);

  // 4. Try /user/notes/ with type=note filter
  console.log('[PROBE] Fetching /user/notes/?type=note&start=0');
  try {
    const r4 = await fetch('https://www.biblegateway.com/user/notes/?type=note&start=0', {
      credentials: 'include',
      headers: { 'Accept': 'application/json, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const t4 = await r4.text();
    results['typednote'] = { status: r4.status, contentType: r4.headers.get('content-type'), body: t4.slice(0, 2000) };
    console.log('[PROBE] typednote status:', r4.status, 'content-type:', r4.headers.get('content-type'));
    console.log('[PROBE] typednote body (first 500):', t4.slice(0, 500));
  } catch(e) { results['typednote'] = { error: e.message }; }

  await sleep(500);

  // 5. GraphQL — probe for notes query
  console.log('[PROBE] Fetching /graphql/ with notes introspection');
  try {
    const r5 = await fetch('https://www.biblegateway.com/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: '{ __schema { queryType { fields { name description } } } }'
      })
    });
    const t5 = await r5.text();
    results['graphql_schema'] = { status: r5.status, contentType: r5.headers.get('content-type'), body: t5.slice(0, 3000) };
    console.log('[PROBE] graphql_schema status:', r5.status);
    console.log('[PROBE] graphql_schema body:', t5.slice(0, 2000));
  } catch(e) { results['graphql_schema'] = { error: e.message }; }

  await sleep(500);

  // 6. Check what the note modal loads — re-click first note and wait for API call
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  const firstNote = notesList ? notesList.querySelector('article.bible-item[data-note_type="note"]') : null;
  if (firstNote) {
    const noteId = firstNote.getAttribute('data-note_id');
    const link = firstNote.querySelector('.bible-item-title a');
    const href = link ? link.href : '';
    console.log('[PROBE] first note id:', noteId, 'href:', href);

    // Try edit endpoint
    if (noteId) {
      try {
        const r6 = await fetch('https://www.biblegateway.com/user/annotations/' + noteId + '/', {
          credentials: 'include',
          headers: { 'Accept': 'application/json, */*', 'X-Requested-With': 'XMLHttpRequest' }
        });
        const t6 = await r6.text();
        results['note_by_id'] = { status: r6.status, body: t6.slice(0, 1000) };
        console.log('[PROBE] note_by_id status:', r6.status, 'body:', t6.slice(0, 300));
      } catch(e) { results['note_by_id'] = { error: e.message }; }
    }
  }

  return JSON.stringify(results, null, 2);
})()
`

// ── Paginate all annotations to count total notes + collect verse refs ─────
const COUNT_ALL_PAGES_SCRIPT = `
(async function() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // First, find total note count from the page header
  const countEl = document.querySelector('[class*="count"], .annotation-count, .results-count');
  console.log('[COUNT] count element text:', countEl ? countEl.textContent.trim() : 'not found');

  // Check all text for "3,271" or similar counts
  const pageText = document.body.textContent.replace(/\\s+/g,' ');
  const countMatch = pageText.match(/(\\d[\\d,]+)\\s*(notes?|annotations?|items?)/i);
  console.log('[COUNT] count from text:', countMatch ? countMatch[0] : 'not found');

  // Get total from data attributes
  const listsWithData = Array.from(document.querySelectorAll('[data-annotations_list_type]'));
  listsWithData.forEach(function(el) {
    const type = el.getAttribute('data-annotations_list_type');
    const total = el.getAttribute('data-total') || el.getAttribute('data-count') || 'no attr';
    const items = el.querySelectorAll('article.bible-item').length;
    console.log('[COUNT] list type=' + type + ' data-total=' + total + ' visible items=' + items);
    // Log all attributes
    Array.from(el.attributes).forEach(function(a) {
      if (a.name !== 'class') console.log('[COUNT]   attr: ' + a.name + '=' + a.value.slice(0,60));
    });
  });

  // Extract notes from notes-only list
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  if (!notesList) { console.log('[COUNT] no notes list'); return JSON.stringify({error: 'no notes list'}); }

  const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'));
  console.log('[COUNT] articles on page 1:', articles.length);

  const page1Notes = articles.map(function(el) {
    const link = el.querySelector('.bible-item-title a');
    const verseRef = link ? link.textContent.trim() : '?';
    const verseHref = link ? link.href : '';
    const dateEl = el.querySelector('.bible-item-details');
    const dateRaw = dateEl ? dateEl.textContent.replace(/Delete|Undo/g,'').replace(/\\s+/g,' ').trim() : '';
    const noteId = el.getAttribute('data-note_id') || '';
    return { verseRef, verseHref, dateRaw, noteId };
  });

  console.log('[COUNT] page 1 refs:', JSON.stringify(page1Notes.map(n => n.verseRef)));

  return JSON.stringify({ page1Count: articles.length, page1Notes: page1Notes.slice(0, 5) });
})()
`

app.whenReady().then(async () => {
  const sess = session.fromPartition(PARTITION)

  // Intercept to capture the exact URL of notes API calls
  const apiCalls = []
  sess.webRequest.onCompleted({ urls: ['https://www.biblegateway.com/user/notes/*', 'https://www.biblegateway.com/graphql/*'] }, (details) => {
    console.log(`[NET-NOTES] ${details.resourceType} ${details.statusCode} ${details.url}`)
    apiCalls.push(details.url)
  })

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
    console.log('[TEST3] Exiting', code)
    app.exit(code)
  }
  setTimeout(() => { console.log('[TEST3] TIMEOUT'); quit(1) }, 10 * 60 * 1000)
  win.on('closed', () => { if (!testDone) quit(1) })

  win.webContents.on('console-message', (_e, _level, msg) => {
    if (msg.startsWith('[PROBE]') || msg.startsWith('[COUNT]')) {
      console.log(msg)
    }
  })

  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL()
    console.log(`[TEST3][${phase}] did-finish-load → ${url}`)

    const isLogin = /biblegateway\.com\/login(\/|$|\?)/.test(url)
    const isAnnotations = url.includes('/user/annotations') || url.includes('iv=notes')
    const isPassage = url.includes('/passage/')

    if (isLogin && !loginAttempted) {
      loginAttempted = true
      const deadline = Date.now() + 10000
      let result = null
      while (Date.now() < deadline) {
        result = await win.webContents.executeJavaScript(FILL_SCRIPT(USERNAME, PASSWORD)).catch(() => null)
        if (result && result !== 'no-form' && result !== 'no-inputs') break
        await new Promise(r => setTimeout(r, 500))
      }
      console.log('[TEST3] fillLoginForm:', result)
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
        else { console.error('[TEST3] Login failed'); quit(1) }
      }, 5000)
      return
    }
    if (isLogin) {
      if (loginSubmittedAt && Date.now() - loginSubmittedAt > 6000) { console.error('[TEST3] Bad credentials'); quit(1) }
      return
    }

    if (isAnnotations && phase === 'login') {
      phase = 'annotate'
      console.log('[TEST3] On annotations page — waiting 3s for React')
      await new Promise(r => setTimeout(r, 3000))

      console.log('\n[TEST3] === STEP 1: Count all notes, collect page 1 refs ===')
      const countResult = await win.webContents.executeJavaScript(COUNT_ALL_PAGES_SCRIPT).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST3] Count result:', countResult)

      console.log('\n[TEST3] === STEP 2: Navigate to passage page to trigger notes API ===')
      phase = 'passage'
      win.loadURL('https://www.biblegateway.com/passage/?search=Hebrews+11%3A6&version=KJV')
      return
    }

    if (isPassage && phase === 'passage') {
      phase = 'probe'
      console.log('[TEST3] On passage page — waiting 4s for notes API call to complete')
      await new Promise(r => setTimeout(r, 4000))

      console.log('\n[TEST3] === STEP 3: Probe notes API from passage page context ===')
      const probeResult = await win.webContents.executeJavaScript(PROBE_SCRIPT).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST3] Full probe results:')
      try {
        const parsed = JSON.parse(probeResult)
        Object.entries(parsed).forEach(([k, v]) => {
          console.log(`\n  [${k}]:`)
          console.log('  status:', v.status, '| content-type:', v.contentType)
          console.log('  body:', (v.body || v.error || '').slice(0, 800))
        })
      } catch {
        console.log(probeResult.slice(0, 3000))
      }

      console.log('\n[TEST3] === STEP 4: Navigate back to annotations page 2 ===')
      phase = 'page2'
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes&i=26`)
      return
    }

    if (isAnnotations && phase === 'page2') {
      phase = 'page2-done'
      console.log('[TEST3] On annotations page 2 — waiting 3s')
      await new Promise(r => setTimeout(r, 3000))

      const page2Script = `
(function() {
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  if (!notesList) return JSON.stringify({ error: 'no notes list' });
  const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'));
  const notes = articles.map(function(el) {
    const link = el.querySelector('.bible-item-title a');
    return {
      verseRef: link ? link.textContent.trim() : '?',
      verseHref: link ? link.href : '',
      noteId: el.getAttribute('data-note_id') || '',
    };
  });
  return JSON.stringify({ count: articles.length, notes: notes.slice(0, 5) });
})()
`
      const page2Result = await win.webContents.executeJavaScript(page2Script).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST3] Page 2 result:', page2Result)

      // Check last page (page 131 = ?i=3251)
      console.log('[TEST3] Checking last page (?i=3251)...')
      phase = 'lastpage'
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes&i=3251`)
      return
    }

    if (isAnnotations && phase === 'lastpage') {
      phase = 'lastpage-done'
      console.log('[TEST3] On last page — waiting 3s')
      await new Promise(r => setTimeout(r, 3000))

      const lastPageScript = `
(function() {
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  if (!notesList) return JSON.stringify({ error: 'no notes list' });
  const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'));
  const notes = articles.map(function(el) {
    const link = el.querySelector('.bible-item-title a');
    return { verseRef: link ? link.textContent.trim() : '?', noteId: el.getAttribute('data-note_id') || '' };
  });
  return JSON.stringify({ count: articles.length, notes });
})()
`
      const lastPageResult = await win.webContents.executeJavaScript(lastPageScript).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST3] Last page (?i=3251) result:', lastPageResult)

      // Try one past the end
      phase = 'pastend'
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes&i=9999`)
      return
    }

    if (isAnnotations && phase === 'pastend') {
      phase = 'pastend-done'
      await new Promise(r => setTimeout(r, 3000))
      const pastEndScript = `
(function() {
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  if (!notesList) return JSON.stringify({ error: 'no notes list' });
  const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'));
  return JSON.stringify({ count: articles.length });
})()
`
      const pastEndResult = await win.webContents.executeJavaScript(pastEndScript).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST3] Past-end (?i=9999) result:', pastEndResult)

      console.log('\n[TEST3] === All API calls captured ===')
      apiCalls.forEach(u => console.log('  ', u))
      quit(0)
      return
    }

    if (!isAnnotations && !isPassage) {
      console.log('[TEST3] Intermediate page, navigating to annotations')
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    }
  })

  console.log('[TEST3] Loading login URL')
  win.loadURL(LOGIN_URL)
})

app.on('window-all-closed', () => {})
