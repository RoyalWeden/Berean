/**
 * bg-test2.js — intercept BG network requests to find annotation JSON API
 *
 * Run with:
 *   BG_USER=you@email.com BG_PASS=yourpass \
 *     /Users/roywe/Berean/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     /Users/roywe/Berean/scripts/bg-test2.js
 */

const { app, BrowserWindow, session } = require('electron')

const BG_ORIGIN  = 'https://www.biblegateway.com'
const LOGIN_URL  = `${BG_ORIGIN}/login/`
const PARTITION  = 'persist:bg-test-debug'

const USERNAME = process.env.BG_USER || ''
const PASSWORD = process.env.BG_PASS || ''
if (!USERNAME || !PASSWORD) { console.error('Set BG_USER and BG_PASS'); process.exit(1) }

// ── What we learned from test1 ─────────────────────────────────────────────
// • 3,271 notes total
// • Pagination: ?iv=notes → page1, ?iv=notes&i=26 → page2, etc. (25/page)
// • Page renders 4 lists at once: all/favorites/highlights/notes
// • Note text (.bible-item-text) is EMPTY on the list page
// • Need to find the JSON API BG uses to load note content

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

// ── Phase 1 extraction script: reads only from the notes list ────────────────
// Uses .annotations-list[data-annotations_list_type="notes"] to get only notes
const EXTRACT_NOTES_SCRIPT = `
(function() {
  // Only look in the notes-type list, not highlights/all/favorites
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  if (!notesList) {
    return JSON.stringify({ error: 'no notes list found', lists: Array.from(document.querySelectorAll('[data-annotations_list_type]')).map(el => el.getAttribute('data-annotations_list_type')) });
  }
  const articles = Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'));
  const notes = articles.map(function(el) {
    const verseRef = (el.querySelector('.bible-item-title a') || {}).textContent?.trim() || '?';
    const verseHref = (el.querySelector('.bible-item-title a') || {}).href || '';
    const dateRaw = (el.querySelector('.bible-item-details') || {}).textContent?.replace(/Delete|Undo/g,'').replace(/\s+/g,' ').trim() || '';
    const bodyText = (el.querySelector('.bible-item-text') || {}).textContent?.trim() || '';
    const noteId = el.getAttribute('data-note_id') || '';
    return { verseRef, verseHref, dateRaw, bodyText, noteId };
  });
  return JSON.stringify({ count: notes.length, notes: notes.slice(0, 5) });
})()
`

// ── Script that clicks the first note to see what happens ───────────────────
const CLICK_NOTE_SCRIPT = `
(async function() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  if (!notesList) return JSON.stringify({ error: 'no notes list' });
  const firstNote = notesList.querySelector('article.bible-item[data-note_type="note"]');
  if (!firstNote) return JSON.stringify({ error: 'no note article' });
  const link = firstNote.querySelector('.bible-item-title a');
  if (!link) return JSON.stringify({ error: 'no title link' });

  // Intercept the click to prevent navigation, so we can see what modal opens
  const verseRef = link.textContent.trim();
  const href = link.href;

  // Also look for an edit link / click handler
  const deleteLink = firstNote.querySelector('.delete-annotation-link');
  const deleteLinkHtml = deleteLink ? deleteLink.outerHTML : 'none';

  // Check for any click handlers on the article
  const articleHtml = firstNote.outerHTML;

  // Try clicking without navigating — preventDefault the link click
  let modalAppeared = false;
  link.addEventListener('click', function(e) { e.preventDefault(); }, { once: true, capture: true });
  link.click();
  await sleep(500);

  // Check if a modal appeared
  const modals = document.querySelectorAll('.modal, [role="dialog"], .popup, .overlay, .edit-annotation, [class*="modal"], [class*="dialog"]');
  modalAppeared = modals.length > 0;
  const modalHtml = modals.length > 0 ? modals[0].outerHTML.slice(0, 500) : 'none';

  return JSON.stringify({
    verseRef,
    href,
    noteId: firstNote.getAttribute('data-note_id'),
    deleteLinkHtml: deleteLinkHtml.slice(0, 200),
    modalAppeared,
    modalHtml,
    articleHtml: articleHtml.slice(0, 600),
  });
})()
`

app.whenReady().then(async () => {
  const sess = session.fromPartition(PARTITION)
  // Don't clear session - reuse from test1 if possible
  console.log('[TEST2] Starting')

  // ── Intercept ALL network requests ────────────────────────────────────────
  const apiCalls = []
  sess.webRequest.onCompleted({ urls: ['https://www.biblegateway.com/*'] }, (details) => {
    const url = details.url
    const status = details.statusCode
    const type = details.resourceType
    // Only log XHR/fetch/JSON-looking calls
    if (type === 'xhr' || type === 'fetch' || url.includes('/api/') || url.includes('.json') || url.includes('annotations')) {
      if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.ico')) {
        console.log(`[NET] ${type} ${status} ${url}`)
        apiCalls.push({ url, status, type })
      }
    }
  })

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
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
  let phase = 'login' // login → annotate → note-extract → api-probe → passage → done

  function quit(code = 0) {
    if (testDone) return; testDone = true
    console.log('[TEST2] Exiting', code)
    app.exit(code)
  }
  setTimeout(() => { console.log('[TEST2] TIMEOUT'); quit(1) }, 8 * 60 * 1000)

  win.on('closed', () => { if (!testDone) quit(1) })

  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL()
    console.log(`[TEST2][${phase}] did-finish-load → ${url}`)

    const isLogin = /biblegateway\.com\/login(\/|$|\?)/.test(url)
    const isAnnotations = url.includes('/user/annotations') || url.includes('iv=notes')
    const isPassage = url.includes('/passage/')

    // ── LOGIN ──────────────────────────────────────────────────────────────
    if (isLogin && !loginAttempted) {
      loginAttempted = true
      const deadline = Date.now() + 10000
      let result = null
      while (Date.now() < deadline) {
        result = await win.webContents.executeJavaScript(FILL_SCRIPT(USERNAME, PASSWORD)).catch(() => null)
        if (result && result !== 'no-form' && result !== 'no-inputs') break
        await new Promise(r => setTimeout(r, 500))
      }
      console.log('[TEST2] fillLoginForm:', result)
      loginSubmittedAt = Date.now()
      setTimeout(async () => {
        if (testDone) return
        const curUrl = win.webContents.getURL()
        console.log('[TEST2] post-submit URL:', curUrl)
        if (curUrl.includes('/user/annotations') || curUrl.includes('iv=notes')) return
        if (!/biblegateway\.com\/login/.test(curUrl)) {
          win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
          return
        }
        const formGone = await win.webContents.executeJavaScript(
          `!(document.querySelector('form[action="/login/"]') || document.querySelector('.login-current form'))`
        ).catch(() => false)
        if (formGone) win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
        else { console.error('[TEST2] Login failed'); quit(1) }
      }, 5000)
      return
    }
    if (isLogin) {
      if (loginSubmittedAt && Date.now() - loginSubmittedAt > 6000) { console.error('[TEST2] Bad credentials'); quit(1) }
      return
    }

    // ── ANNOTATIONS PAGE ──────────────────────────────────────────────────
    if (isAnnotations && phase === 'login') {
      phase = 'annotate'
      console.log('[TEST2] On annotations page — waiting 3s for React')
      await new Promise(r => setTimeout(r, 3000))

      // 1. Extract notes from notes-only list
      console.log('\n[TEST2] === STEP 1: Extract notes from notes-only list ===')
      const extractResult = await win.webContents.executeJavaScript(EXTRACT_NOTES_SCRIPT).catch(e => JSON.stringify({error: e.message}))
      const extracted = JSON.parse(extractResult)
      console.log('[TEST2] Notes list found:', JSON.stringify(extracted, null, 2))

      // 2. Click first note to see if modal appears
      console.log('\n[TEST2] === STEP 2: Click first note ===')
      const clickResult = await win.webContents.executeJavaScript(CLICK_NOTE_SCRIPT).catch(e => JSON.stringify({error: e.message}))
      const clicked = JSON.parse(clickResult)
      console.log('[TEST2] Click result:', JSON.stringify(clicked, null, 2))

      // 3. Log all API calls captured so far
      console.log('\n[TEST2] === STEP 3: API calls captured so far ===')
      apiCalls.forEach(c => console.log('  ', c.type, c.status, c.url))

      // 4. Try direct API probe — common BG annotation API patterns
      console.log('\n[TEST2] === STEP 4: Probe annotation API endpoints ===')
      const probeScript = `
(async function() {
  const notesList = document.querySelector('.annotations-list[data-annotations_list_type="notes"]');
  const firstArticle = notesList ? notesList.querySelector('article.bible-item') : null;
  const noteId = firstArticle ? firstArticle.getAttribute('data-note_id') : null;
  console.log('[PROBE] first note_id: ' + noteId);

  // Try BG's likely API endpoints using existing cookies
  const endpoints = [
    '/reader/api/annotations/',
    '/api/annotations/',
    '/user/annotations/json/',
    '/user/notes.json',
    '/api/user/annotations/',
    '/reader/api/user/annotations/?format=json',
    noteId ? '/user/annotations/' + noteId + '/' : null,
    noteId ? '/api/annotations/' + noteId + '/' : null,
    noteId ? '/reader/api/annotations/' + noteId + '/' : null,
  ].filter(Boolean);

  const results = {};
  for (const ep of endpoints) {
    try {
      const r = await fetch('https://www.biblegateway.com' + ep, {
        credentials: 'include',
        headers: { 'Accept': 'application/json, */*' }
      });
      const text = await r.text();
      results[ep] = { status: r.status, preview: text.slice(0, 200) };
      console.log('[PROBE] ' + ep + ' → ' + r.status + ': ' + text.slice(0, 100));
    } catch(e) {
      results[ep] = { error: e.message };
    }
  }
  return JSON.stringify(results);
})()
`
      const probeResult = await win.webContents.executeJavaScript(probeScript).catch(e => JSON.stringify({error: e.message}))
      console.log('[TEST2] Probe results:', probeResult)

      // 5. Navigate to passage page of first note to see sidebar text
      if (extracted.notes && extracted.notes.length > 0) {
        const firstNote = extracted.notes[0]
        const passageUrl = firstNote.verseHref || `${BG_ORIGIN}/passage/?search=${encodeURIComponent(firstNote.verseRef)}&version=KJV`
        console.log(`\n[TEST2] === STEP 5: Navigate to passage page: ${passageUrl} ===`)
        phase = 'passage'
        win.loadURL(passageUrl.includes('biblegateway.com') ? passageUrl : `${BG_ORIGIN}${passageUrl}`)
      } else {
        console.log('[TEST2] No notes found to check passage page')
        quit(0)
      }
      return
    }

    // ── PASSAGE PAGE ────────────────────────────────────────────────────────
    if (isPassage && phase === 'passage') {
      phase = 'passage-done'
      console.log('[TEST2] On passage page — waiting 5s for sidebar to render')
      await new Promise(r => setTimeout(r, 5000))

      const passageScript = `
(async function() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Find the Notes tab
  const allTabs = Array.from(document.querySelectorAll('li[data-tab], [data-pane], .tab-pane, nav a'));
  console.log('[PASSAGE] tabs found: ' + allTabs.map(t => t.textContent.trim().slice(0,20)).join(', '));

  let notesTab = document.querySelector('li[data-tab="notes"], a[data-pane="notes"], [data-target*="notes"]');
  console.log('[PASSAGE] notes tab: ' + (notesTab ? notesTab.outerHTML.slice(0,200) : 'not found'));

  if (notesTab) {
    notesTab.click();
    await sleep(2000);
  }

  // Look for any text that looks like a user note
  const sidebarSelectors = [
    '.sticky-resources', '.sidebar-resources', '.notes-panel', '.note-content',
    '[class*="sidebar"]', '.resource-panel', '.passage-resources',
    '.info-viewer', '.user-note', '[data-resource-panel]',
  ];

  for (const sel of sidebarSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      console.log('[PASSAGE] found: ' + sel + ' text: ' + el.textContent.replace(/\\s+/g,' ').trim().slice(0, 200));
    }
  }

  // Look for any h3/h4 that says "Notes" or "Your Notes"
  Array.from(document.querySelectorAll('h2,h3,h4,h5')).forEach(function(h) {
    if (/note|your content/i.test(h.textContent)) {
      console.log('[PASSAGE] heading: "' + h.textContent.trim() + '" next: ' + (h.nextElementSibling || {}).textContent?.slice(0,150));
    }
  });

  // Full page text summary
  console.log('[PASSAGE] page text (first 500): ' + document.body.textContent.replace(/\\s+/g,' ').slice(0,500));

  return 'done';
})()
`
      await win.webContents.executeJavaScript(passageScript).catch(e => console.error('[TEST2] passage script error:', e.message))
      console.log('\n[TEST2] === Final API call log ===')
      apiCalls.forEach(c => console.log('  ', c.type, c.status, c.url))
      quit(0)
      return
    }

    // ── OTHER PAGES ─────────────────────────────────────────────────────────
    if (!isPassage) {
      console.log('[TEST2] Intermediate page, navigating to annotations')
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    }
  })

  console.log('[TEST2] Loading login URL')
  win.loadURL(LOGIN_URL)
})

app.on('window-all-closed', () => {})
