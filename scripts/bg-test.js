/**
 * bg-test.js — standalone BibleGateway annotation scraper test
 *
 * Run with:
 *   BG_USER=you@email.com BG_PASS=yourpassword \
 *     /Users/roywe/Berean/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     /Users/roywe/Berean/scripts/bg-test.js
 *
 * All output goes to stdout. No files written. Exits when done.
 */

const { app, BrowserWindow, session } = require('electron')

const BG_ORIGIN    = 'https://www.biblegateway.com'
const LOGIN_URL    = `${BG_ORIGIN}/login/`
const PARTITION    = 'persist:bg-test-debug'

const USERNAME = process.env.BG_USER || ''
const PASSWORD = process.env.BG_PASS || ''

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: set BG_USER and BG_PASS environment variables')
  process.exit(1)
}

// ── Message relay: window.postMessage → console.log → Electron console-message ──

const MESSAGE_RELAY = `
  window.addEventListener('message', function(e) {
    if (e.data && typeof e.data.type === 'string' && e.data.type.startsWith('bg-')) {
      console.log('BG:' + JSON.stringify(e.data));
    }
  });
`

// ── Deep inspection script injected into the annotations page ────────────────

const INSPECT_SCRIPT = `
(async function bgInspect() {
  function log(msg) { window.postMessage({ type: 'bg-log', message: String(msg) }, '*'); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  log('=== INSPECT START: ' + location.href + ' ===');
  log('Document title: ' + document.title);

  const SELECTORS = [
    'article.bible-item',
    '.bible-item',
    '.annotation-item',
    '.note-item',
    '[data-annotation-id]',
    '.user-annotation',
    '[data-note_type]',
    'li.annotation',
    '[class*="annotation"]',
    '[class*="note-item"]',
    '[class*="bible-item"]',
  ];

  // --- 1. Per-selector counts -------------------------------------------------
  log('\\n--- 1. Per-selector element counts ---');
  for (const sel of SELECTORS) {
    try { log('  [' + document.querySelectorAll(sel).length + '] ' + sel); }
    catch(e) { log('  [ERR] ' + sel + ': ' + e.message); }
  }

  // --- 2. Unique elements from combined selector ------------------------------
  const COMBINED = SELECTORS.join(',');
  const allEls = Array.from(document.querySelectorAll(COMBINED));
  log('\\n--- 2. Combined unique elements: ' + allEls.length + ' ---');

  // --- 3. All unique CSS classes on matched elements -------------------------
  const classFreq = {};
  allEls.forEach(function(el) {
    Array.from(el.classList).forEach(function(c) {
      classFreq[c] = (classFreq[c] || 0) + 1;
    });
  });
  log('\\n--- 3. CSS class frequency on matched elements ---');
  Object.entries(classFreq).sort((a,b) => b[1]-a[1]).forEach(function([c,n]) {
    log('  [' + n + '] .' + c);
  });

  // --- 4. Data-attribute distribution ----------------------------------------
  log('\\n--- 4. Data-attribute distribution ---');
  const dataKeys = {};
  allEls.forEach(function(el) {
    Array.from(el.attributes).forEach(function(a) {
      if (a.name.startsWith('data-')) {
        dataKeys[a.name] = dataKeys[a.name] || new Set();
        dataKeys[a.name].add(a.value.slice(0, 40));
      }
    });
  });
  Object.entries(dataKeys).forEach(function([k, vs]) {
    log('  ' + k + ': [' + [...vs].slice(0,5).join(' | ') + ']');
  });

  // --- 5. Full HTML of first 5 elements -------------------------------------
  log('\\n--- 5. First 5 elements (outerHTML, up to 800 chars each) ---');
  allEls.slice(0, 5).forEach(function(el, i) {
    log('\\nEl[' + i + ']:');
    log(el.outerHTML.slice(0, 800));
  });

  // --- 6. Pagination / navigation links -------------------------------------
  log('\\n--- 6. Annotation/pagination links on page ---');
  Array.from(document.querySelectorAll('a[href]')).forEach(function(a) {
    const h = a.href;
    if (h.includes('annotation') || h.includes('iv=') || h.includes('&i=') || h.includes('?i=')) {
      log('  href=' + h + '  text="' + (a.textContent||'').trim().slice(0,50) + '"');
    }
  });

  // --- 7. "Load more" buttons -----------------------------------------------
  log('\\n--- 7. Load-more / next-page buttons ---');
  let foundLoadMore = false;
  Array.from(document.querySelectorAll('button,[role="button"],[class*="load"],[class*="more"],[class*="pagination"]')).forEach(function(btn) {
    const txt = (btn.textContent||'').trim();
    const lower = txt.toLowerCase();
    const cls = btn.className || '';
    if (lower.includes('more')||lower.includes('load')||lower.includes('next')||lower.includes('page')||cls.includes('pagination')) {
      log('  [' + btn.tagName + '] "' + txt.slice(0,60) + '" class="' + cls.slice(0,80) + '"');
      foundLoadMore = true;
    }
  });
  if (!foundLoadMore) log('  (none found)');

  // --- 8. Scroll test: 6 rounds, 2s wait each --------------------------------
  log('\\n--- 8. Scroll-load test ---');
  log('Before scroll: ' + allEls.length + ' elements, docHeight=' + document.body.scrollHeight);
  let prevCount = allEls.length;
  for (let i = 1; i <= 6; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2000);
    const cur = document.querySelectorAll(COMBINED).length;
    const delta = cur - prevCount;
    log('Scroll #' + i + ': ' + cur + ' elements (' + (delta > 0 ? '+'+delta : delta) + ') docH=' + document.body.scrollHeight);
    prevCount = cur;
  }

  // --- 9. Try different page URL parameters ---------------------------------
  log('\\n--- 9. Final note dump (type | verseRef | text snippet) ---');
  const finalEls = Array.from(document.querySelectorAll(COMBINED));
  log('Total after scrolling: ' + finalEls.length);
  finalEls.forEach(function(el, i) {
    const noteType = el.getAttribute('data-note_type') || el.getAttribute('data-type') || '(none)';
    const verseRef = (
      (el.querySelector('.bible-item-title a[href*=passage]') || {}).textContent ||
      (el.querySelector('a[href*=passage]') || {}).textContent ||
      el.getAttribute('data-reference') || el.getAttribute('data-verse') || '?'
    ).trim().slice(0, 50);
    const rawText = (el.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 100);
    log('[' + i + '] type=' + noteType + ' | ref="' + verseRef + '" | text="' + rawText + '"');
  });

  log('\\n=== INSPECT DONE: ' + finalEls.length + ' total elements ===');
  window.postMessage({ type: 'bg-inspect-done', total: finalEls.length }, '*');
})();
`

// ── Fill login form (same approach as the app) ────────────────────────────────

const FILL_SCRIPT = (username, password) => `
(function() {
  const loginForm = (
    document.querySelector('form[action="/login/"]') ||
    document.querySelector('.login-current form') ||
    document.querySelector('.login-section:last-of-type form')
  );
  if (!loginForm) return 'no-form:' + Array.from(document.querySelectorAll('form')).map(f=>f.action).join(',');
  const email = loginForm.querySelector('input[type="email"],input[name="email"]');
  const pass  = loginForm.querySelector('input[type="password"],input[name="password"]');
  if (!email || !pass) return 'no-inputs';
  function setVal(el, val) {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    s.call(el, val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  setVal(email, ${JSON.stringify(username)});
  setVal(pass, ${JSON.stringify(password)});
  const btn = loginForm.querySelector('input[type="submit"],button[type="submit"],.btn');
  if (btn) { btn.click(); return 'clicked:'+btn.tagName+'.'+btn.className; }
  loginForm.submit(); return 'form-submit';
})()
`

// ── Main test runner ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Clear any stale session data from previous test runs
  const sess = session.fromPartition(PARTITION)
  await sess.clearStorageData({ storages: ['cookies','localstorage','sessionstorage'] })
  console.log('[TEST] Session cleared')

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
  let inspectPhase = false // true once we've started the inspect script

  function quit(code = 0) {
    if (testDone) return
    testDone = true
    console.log('[TEST] Exiting with code', code)
    app.exit(code)
  }

  // Safety timeout: 5 minutes
  setTimeout(() => { console.log('[TEST] TIMEOUT'); quit(1) }, 5 * 60 * 1000)

  // ── Relay BG postMessage → stdout ────────────────────────────────────────
  win.webContents.on('console-message', (_e, _level, msg) => {
    if (!msg.startsWith('BG:')) return
    try {
      const data = JSON.parse(msg.slice(3))
      if (data.type === 'bg-log') {
        console.log('[BG]', data.message)
      }
      if (data.type === 'bg-inspect-done') {
        console.log('[TEST] Inspect complete — total elements:', data.total)
        quit(0)
      }
    } catch {}
  })

  // ── Page load handler ────────────────────────────────────────────────────
  win.webContents.on('did-finish-load', async () => {
    const url = win.webContents.getURL()
    console.log('[TEST] did-finish-load →', url)

    const isLogin = /biblegateway\.com\/login(\/|$|\?)/.test(url)
    const isAnnotations = url.includes('/user/annotations') || url.includes('iv=notes')

    if (isAnnotations && !inspectPhase) {
      inspectPhase = true
      console.log('[TEST] On annotations page — waiting 3s for React then injecting inspect script')
      await new Promise(r => setTimeout(r, 3000))
      await win.webContents.executeJavaScript(MESSAGE_RELAY).catch(() => {})
      await win.webContents.executeJavaScript(INSPECT_SCRIPT).catch(e => {
        console.error('[TEST] Inspect script error:', e.message)
        quit(1)
      })
      return
    }

    if (isLogin) {
      if (!loginAttempted) {
        loginAttempted = true
        console.log('[TEST] Login page — filling form')
        // Poll up to 10s for form
        const deadline = Date.now() + 10000
        let result = null
        while (Date.now() < deadline) {
          result = await win.webContents.executeJavaScript(FILL_SCRIPT(USERNAME, PASSWORD)).catch(() => null)
          if (result && result !== 'no-form:' && result !== 'no-inputs' && !result.startsWith('no-form:')) break
          console.log('[TEST] Form not ready yet:', result, '— retrying')
          await new Promise(r => setTimeout(r, 500))
        }
        console.log('[TEST] fillLoginForm result:', result)
        if (!result || result === 'no-form:' || result === 'no-inputs' || result.startsWith('no-form:')) {
          console.error('[TEST] Could not fill login form — aborting')
          quit(1)
          return
        }
        loginSubmittedAt = Date.now()
        // 5s post-submit timer to handle AJAX login
        setTimeout(async () => {
          if (testDone) return
          const currentUrl = win.webContents.getURL()
          console.log('[TEST] Post-submit timer — current URL:', currentUrl)
          const isOnAnnotations = currentUrl.includes('/user/annotations') || currentUrl.includes('iv=notes')
          const stillOnLogin = /biblegateway\.com\/login(\/|$|\?)/.test(currentUrl)
          if (isOnAnnotations) {
            console.log('[TEST] Post-submit: on annotations, inspect will fire via did-finish-load')
            return
          }
          if (!stillOnLogin) {
            console.log('[TEST] Post-submit: intermediate page, navigating to annotations')
            win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
            return
          }
          // Check if form is gone (AJAX login success)
          const formGone = await win.webContents.executeJavaScript(`
            !(document.querySelector('form[action="/login/"]') || document.querySelector('.login-current form'))
          `).catch(() => false)
          if (formGone) {
            console.log('[TEST] Post-submit: AJAX login succeeded, navigating to annotations')
            win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
          } else {
            console.error('[TEST] Post-submit: login form still visible — bad credentials?')
            quit(1)
          }
        }, 5000)
      } else {
        const ms = loginSubmittedAt ? Date.now() - loginSubmittedAt : Infinity
        if (ms > 6000) {
          console.error('[TEST] Returned to login after submit — bad credentials')
          quit(1)
        } else {
          console.log('[TEST] Revisit to login within grace period, ignoring')
        }
      }
      return
    }

    if (!inspectPhase) {
      console.log('[TEST] Intermediate page, navigating to annotations')
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    }
  })

  win.on('closed', () => { if (!testDone) quit(1) })

  console.log('[TEST] Starting — navigating to login page')
  console.log('[TEST] Username:', USERNAME)
  win.loadURL(LOGIN_URL)
})

app.on('window-all-closed', () => {}) // prevent auto-quit
