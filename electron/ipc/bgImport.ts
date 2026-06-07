import type { IpcMain } from 'electron'
import { BrowserWindow, session } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BgProgress {
  phase: 'login' | 'fetching' | 'review' | 'saving' | 'done' | 'error'
  done: number
  total: number
  message: string
  reviewNotes?: BgImportReviewNote[]
}

export interface BgImportReviewNote {
  id: string
  passage: string
  body: string
  color: string
  createdAt: number
  updatedAt: number
  status: 'new' | 'updated' | 'duplicate'
  existingId?: string
}

interface BgNote {
  id: string
  passage: string
  translation: string
  body: string
  color: string
  createdAt: number
  updatedAt: number
}

interface BgRawNote {
  verseRef: string
  osis: string
  noteId: number
  content: string
  color: string
  createdAt: number
  updatedAt: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const BG_PARTITION = 'persist:biblegateway-import'
const BG_ORIGIN    = 'https://www.biblegateway.com'
const LOGIN_URL    = `${BG_ORIGIN}/login/`

const LOG = (..._args: unknown[]) => {}

// ── Message relay ──────────────────────────────────────────────────────────────

const MESSAGE_RELAY = `
  window.addEventListener('message', function(e) {
    if (e.data && (e.data.type === 'bg-progress' || e.data.type === 'bg-error')) {
    }
  });
`

function parseBgMessage(message: string): Record<string, unknown> | null {
  if (!message.startsWith('BG:')) return null
  try { return JSON.parse(message.slice(3)) as Record<string, unknown> }
  catch { return null }
}

// ── Master import script ───────────────────────────────────────────────────────
// Runs entirely in the BG page context after login.
// Phase 1: HTML-fetches all annotation pages (concurrent batches) to collect refs.
// Phase 2: Calls /user/notes/ API per unique verse to get note content.
// Reports progress via window.postMessage (relayed by MESSAGE_RELAY).
// Returns all collected raw notes as a JSON string.

function buildMasterScript(): string {
  return `
(async function bgMasterImport() {
  function send(data) { window.postMessage(data, '*'); }
  function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

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
    'baruch':'Bar','1 esdras':'1Esd','2 esdras':'2Esd',
  };

  function toOSIS(ref) {
    var m = ref.match(/^(.+?)\\s+(\\d+)(?::(\\d+))?$/);
    if (!m) return null;
    var osis = OSIS_MAP[m[1].toLowerCase()];
    if (!osis) return null;
    return m[3] ? osis+'.'+m[2]+'.'+m[3] : osis+'.'+m[2];
  }

  function decodeHTML(html) {
    try {
      var doc = new DOMParser().parseFromString('<span>' + html + '</span>', 'text/html');
      return doc.querySelector('span').textContent;
    } catch(e) { return html; }
  }

  async function fetchAnnotationPage(offset) {
    var url = offset === 0
      ? 'https://www.biblegateway.com/user/annotations/?iv=notes'
      : 'https://www.biblegateway.com/user/annotations/?iv=notes&i=' + offset;
    for (var attempt = 0; attempt < 3; attempt++) {
      var controller = new AbortController();
      var tid = setTimeout(function() { controller.abort(); }, 20000);
      try {
        var r = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!r.ok) { clearTimeout(tid); return []; }
        var html = await r.text();
        clearTimeout(tid);
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var notesList = doc.querySelector('.annotations-list[data-annotations_list_type="notes"]');
        if (!notesList) return [];
        return Array.from(notesList.querySelectorAll('article.bible-item[data-note_type="note"]'))
          .map(function(el) {
            var link = el.querySelector('.bible-item-title a');
            if (!link) return null;
            var verseRef = link.textContent.trim();
            // Extract publication from the date detail text ("May 25 at 7:58 PM | KJV")
            var dateEl = el.querySelector('.bible-item-details');
            var dateText = dateEl ? dateEl.textContent.replace(/Delete|Undo/g, '').trim() : '';
            var pubMatch = dateText.match(/\\|\\s*([A-Za-z0-9+_-]+)\\s*$/);
            var pub = pubMatch ? pubMatch[1].toLowerCase() : 'kjv';
            return { verseRef: verseRef, pub: pub };
          })
          .filter(Boolean);
      } catch(e) {
        clearTimeout(tid);
        if (attempt < 2) await sleep(2000);
      }
    }
    return [];
  }

  async function fetchVerseNotes(ref, osis, pub) {
    var url = 'https://www.biblegateway.com/user/notes/?reference=' + encodeURIComponent(osis) + '&publication=' + encodeURIComponent(pub) + '&start=0';
    for (var attempt = 0; attempt < 3; attempt++) {
      var controller = new AbortController();
      var tid = setTimeout(function() { controller.abort(); }, 20000);
      try {
        var r = await fetch(url, {
          credentials: 'include',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          signal: controller.signal
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        clearTimeout(tid);
        return (data.notes || []).filter(function(n) { return n.type === 'note'; }).map(function(n) {
          return {
            verseRef: ref,
            osis: osis,
            noteId: n.id,
            content: decodeHTML(n.content || ''),
            color: n.color || '',
            createdAt: n.created_time || 0,
            updatedAt: n.updated || 0,
          };
        });
      } catch(e) {
        clearTimeout(tid);
        if (attempt < 2) await sleep(1000 * (attempt + 1));
      }
    }
    return [];
  }

  try {
    // ── Shared state between producer (Phase 1) and workers (Phase 2) ──────
    var queue = [];            // { ref, osis, pub } items ready to fetch
    var queueSeen = new Set(); // dedup by (osis, pub) — one API call per unique verse
    var phase1Done = false;
    var totalFound = 0;        // running total of annotation list entries (grows during scan)

    var seenNoteIds = new Set();
    var writtenNotes = [];
    var notesFetched = 0;      // unique verses fetched so far (for progress display)

    // ── Phase 1: Scan annotation pages and populate the queue ─────────────
    async function runPhase1() {
      send({ type: 'bg-progress', phase: 'fetching', done: 0, total: 0,
             message: 'Scanning notes list…' });

      var offset = 0, pageNum = 0;
      var PAGE_BATCH = 8, MAX_PAGES = 300;

      while (pageNum < MAX_PAGES) {
        var offsets = [];
        for (var b = 0; b < PAGE_BATCH; b++) {
          offsets.push(offset);
          offset = (offset === 0) ? 26 : offset + 25;
        }

        var batchResults = await Promise.all(offsets.map(function(o) {
          return fetchAnnotationPage(o);
        }));

        var batchDone = false;
        for (var b2 = 0; b2 < batchResults.length; b2++) {
          var refs = batchResults[b2];
          pageNum++;
          totalFound += refs.length;

          for (var ri = 0; ri < refs.length; ri++) {
            var osis1 = toOSIS(refs[ri].verseRef);
            if (!osis1) continue;
            var key1 = osis1 + '|' + refs[ri].pub;
            if (!queueSeen.has(key1)) {
              queueSeen.add(key1);
              queue.push({ ref: refs[ri].verseRef, osis: osis1, pub: refs[ri].pub });
            }
          }

          if (refs.length < 25) { batchDone = true; break; }
        }

        send({ type: 'bg-progress', phase: 'fetching', done: notesFetched, total: totalFound,
               message: 'Scanning: ' + totalFound + ' notes found…' });
        await sleep(300);
        if (batchDone) break;
      }

      phase1Done = true;
    }

    // ── Phase 2 workers: drain the queue as fast as Phase 1 fills it ──────
    // 5 independent workers pull items concurrently — no need to wait for
    // Phase 1 to finish before starting.  Note dedup by noteId at collection.
    var FETCH_DELAY = 150; // ms per worker between fetches

    async function runWorker() {
      while (!phase1Done || queue.length > 0) {
        if (queue.length === 0) {
          await sleep(80); // Phase 1 still running but temporarily empty
          continue;
        }
        var item = queue.shift();
        var notes = await fetchVerseNotes(item.ref, item.osis, item.pub);
        for (var n = 0; n < notes.length; n++) {
          if (!seenNoteIds.has(notes[n].noteId)) {
            seenNoteIds.add(notes[n].noteId);
            writtenNotes.push(notes[n]);
          }
        }
        notesFetched++;
        if (notesFetched % 25 === 0) {
          send({ type: 'bg-progress', phase: 'fetching', done: notesFetched, total: totalFound,
                 message: 'Fetching note content: ' + notesFetched + '/' + totalFound + '…' });
        }
        await sleep(FETCH_DELAY);
      }
    }

    // ── Launch Phase 1 + 5 workers concurrently ───────────────────────────
    var tasks = [runPhase1()];
    for (var w = 0; w < 5; w++) tasks.push(runWorker());
    await Promise.all(tasks);

    send({ type: 'bg-progress', phase: 'fetching', done: notesFetched, total: totalFound,
           message: 'Fetching note content: ' + notesFetched + '/' + totalFound + '…' });

    return JSON.stringify(writtenNotes);

  } catch(e) {
    send({ type: 'bg-error', message: String(e.message || e) });
    return JSON.stringify([]);
  }
})()
`
}

// ── Auto-fill login form ───────────────────────────────────────────────────────

async function fillLoginForm(win: BrowserWindow, username: string, password: string): Promise<boolean> {
  const fillScript = `
    (function() {
      const loginForm = (
        document.querySelector('form[action="/login/"]') ||
        document.querySelector('.login-current form') ||
        document.querySelector('.login-section:last-of-type form')
      );
      if (!loginForm) return false;
      const email = loginForm.querySelector('input[type="email"], input[name="email"]');
      const pass  = loginForm.querySelector('input[type="password"], input[name="password"]');
      if (!email || !pass) return false;
      function setVal(el, val) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, val);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setVal(email, ${JSON.stringify(username)});
      setVal(pass,  ${JSON.stringify(password)});
      const btn = loginForm.querySelector('input[type="submit"], button[type="submit"], .btn');
      if (btn) { btn.click(); return 'clicked'; }
      loginForm.submit(); return 'submitted';
    })()
  `

  LOG('fillLoginForm: polling for form (max 10s)')
  const deadline = Date.now() + 10_000
  let attempt = 0
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return false
    attempt++
    const result = await win.webContents.executeJavaScript(fillScript).catch(() => false)
    if (result) return true
    await new Promise(r => setTimeout(r, 500))
  }
  LOG('fillLoginForm: timed out after 10s')
  return false
}

// ── Phase 1 runner ─────────────────────────────────────────────────────────────
// Logs in, navigates to annotations, injects master script, awaits result.

function runPhase1Hidden(
  username: string,
  password: string,
  onMessage: (msg: string, done?: number, total?: number) => void
): Promise<BgRawNote[] | 'login-failed' | null> {
  LOG('runPhase1Hidden: opening hidden window')
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        partition: BG_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    let resolved = false
    let loginAttempted = false
    let loginSubmittedAt = 0
    let masterInjected = false

    // 30-minute safety timeout for large note collections
    const timer = setTimeout(() => {
      LOG('runPhase1Hidden: 30-minute timeout reached')
      finish(null)
    }, 30 * 60 * 1000)

    // Cancellation poller — destroy window when cancel is requested
    const cancelPoller = setInterval(() => {
      if (cancelFlag && !win.isDestroyed() && !resolved) {
        LOG('runPhase1Hidden: cancel detected — destroying window')
        clearInterval(cancelPoller)
        win.destroy()
      }
    }, 500)

    function finish(result: BgRawNote[] | 'login-failed' | null) {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      clearInterval(cancelPoller)
      try { if (!win.isDestroyed()) win.destroy() } catch {}
      resolve(result)
    }

    async function runMasterScript() {
      if (win.isDestroyed() || resolved || masterInjected) return
      masterInjected = true
      LOG('runPhase1Hidden: injecting master script')
      onMessage('Scanning notes…')

      try {
        await win.webContents.executeJavaScript(MESSAGE_RELAY)
        const resultJson = await win.webContents.executeJavaScript(buildMasterScript())
        if (cancelFlag) { finish(null); return }
        const notes = JSON.parse(resultJson as string) as BgRawNote[]
        LOG(`runPhase1Hidden: master script done — ${notes.length} notes`)
        finish(notes)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('destroyed') || cancelFlag) { finish(null); return }
        LOG('runPhase1Hidden: master script error:', msg)
        finish(null)
      }
    }

    win.webContents.on('console-message', (_e, _level, message) => {
      if (resolved) return   // ignore delayed postMessages after script has finished
      const data = parseBgMessage(message)
      if (!data) return
      if (data.type === 'bg-progress') {
        const msg = String(data.message || '')
        const done = typeof data.done === 'number' ? data.done : undefined
        const total = typeof data.total === 'number' ? data.total : undefined
        LOG('[Master]', msg)
        onMessage(msg, done, total)
      }
      if (data.type === 'bg-error') {
        LOG('[Master] error:', data.message)
        finish(null)
      }
    })

    win.on('closed', () => finish(cancelFlag ? null : null))

    win.webContents.on('did-finish-load', async () => {
      if (win.isDestroyed() || resolved) return
      const url = win.webContents.getURL()
      LOG('runPhase1Hidden: did-finish-load →', url)

      const isLoginPage = /biblegateway\.com\/login(\/|$|\?)/.test(url)

      if (isLoginPage) {
        if (!loginAttempted) {
          loginAttempted = true
          onMessage('Signing in to BibleGateway…')
          const ok = await fillLoginForm(win, username, password)
          if (ok) {
            loginSubmittedAt = Date.now()
            setTimeout(async () => {
              if (resolved || win.isDestroyed()) return
              const curUrl = win.webContents.getURL()
              const isOnAnnotations = curUrl.includes('/user/annotations') || curUrl.includes('iv=notes')
              const stillOnLogin = /biblegateway\.com\/login(\/|$|\?)/.test(curUrl)

              if (isOnAnnotations) {
                await runMasterScript()
                return
              }
              if (!stillOnLogin) {
                win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
                return
              }
              const formGone = await win.webContents.executeJavaScript(`
                !(document.querySelector('form[action="/login/"]') || document.querySelector('.login-current form'))
              `).catch(() => false)
              if (formGone) {
                onMessage('Login successful — loading annotations…')
                win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
              } else {
                finish('login-failed')
              }
            }, 5_000)
          } else {
            finish('login-failed')
          }
        } else {
          const msSinceSubmit = loginSubmittedAt ? Date.now() - loginSubmittedAt : Infinity
          if (msSinceSubmit >= 6_000) finish('login-failed')
        }
        return
      }

      if (url.includes('/user/annotations') || url.includes('iv=notes')) {
        await runMasterScript()
        return
      }

      LOG('runPhase1Hidden: intermediate page — navigating to annotations')
      win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    })

    LOG('runPhase1Hidden: loading login URL')
    win.loadURL(LOGIN_URL)
  })
}

// ── Parse helpers ──────────────────────────────────────────────────────────────

function parseDate(raw: string | number | undefined): number {
  if (!raw) return Date.now()
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000
  const d = new Date(raw as string)
  return isNaN(d.getTime()) ? Date.now() : d.getTime()
}

function bgColorToBerean(c: string): string {
  const map: Record<string, string> = {
    yellow: 'yellow', red: 'red', green: 'green', blue: 'blue',
    purple: 'purple', orange: 'orange', pink: 'pink',
  }
  return map[(c ?? '').toLowerCase()] ?? 'blue'
}

const BG_NAME_TO_ID: Record<string, string> = {
  'genesis':'GEN','exodus':'EXO','leviticus':'LEV','numbers':'NUM','deuteronomy':'DEU',
  'joshua':'JOS','judges':'JDG','ruth':'RUT',
  '1 samuel':'1SA','2 samuel':'2SA','i samuel':'1SA','ii samuel':'2SA',
  '1 kings':'1KI','2 kings':'2KI','i kings':'1KI','ii kings':'2KI',
  '1 chronicles':'1CH','2 chronicles':'2CH','i chronicles':'1CH','ii chronicles':'2CH',
  'ezra':'EZR','nehemiah':'NEH','esther':'EST','job':'JOB','psalms':'PSA','psalm':'PSA',
  'proverbs':'PRO','ecclesiastes':'ECC','song of solomon':'SNG','song of songs':'SNG',
  'isaiah':'ISA','jeremiah':'JER','lamentations':'LAM','ezekiel':'EZK','daniel':'DAN',
  'hosea':'HOS','joel':'JOL','amos':'AMO','obadiah':'OBA','jonah':'JON','micah':'MIC',
  'nahum':'NAM','habakkuk':'HAB','zephaniah':'ZEP','haggai':'HAG','zechariah':'ZEC','malachi':'MAL',
  'matthew':'MAT','mark':'MRK','luke':'LUK','john':'JHN','acts':'ACT','romans':'ROM',
  '1 corinthians':'1CO','2 corinthians':'2CO','i corinthians':'1CO','ii corinthians':'2CO',
  'galatians':'GAL','ephesians':'EPH','philippians':'PHP','colossians':'COL',
  '1 thessalonians':'1TH','2 thessalonians':'2TH','i thessalonians':'1TH','ii thessalonians':'2TH',
  '1 timothy':'1TI','2 timothy':'2TI','i timothy':'1TI','ii timothy':'2TI',
  'titus':'TIT','philemon':'PHM','hebrews':'HEB','james':'JAS',
  '1 peter':'1PE','2 peter':'2PE','i peter':'1PE','ii peter':'2PE',
  '1 john':'1JN','2 john':'2JN','3 john':'3JN','i john':'1JN','ii john':'2JN','iii john':'3JN',
  'jude':'JUD','revelation':'REV','revelations':'REV',
  'tobit':'TOB','judith':'JDT','wisdom of solomon':'WIS','sirach':'SIR',
  'baruch':'BAR','1 maccabees':'1MA','2 maccabees':'2MA',
  '1 esdras':'1ES','2 esdras':'2ES',
}

function normaliseVerseRef(passage: string): string | null {
  const raw = passage.trim().replace(/[–—]/g, '-')
  if (!raw) return null

  const m = raw.match(/^((?:\d\s+)?[A-Za-z][A-Za-z\s]+?)\s+(\d+)(?::(\d+)(?:-\d+)?)?$/i)
  if (m) {
    const bookRaw = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
    const chapter = parseInt(m[2])
    const verse = m[3] ? parseInt(m[3]) : undefined
    const bookId = BG_NAME_TO_ID[bookRaw]
    if (bookId && !isNaN(chapter)) {
      return verse ? `${bookId}.${chapter}.${verse}` : `${bookId}.${chapter}`
    }
  }

  return raw
}

// ── Categorize fetched notes ───────────────────────────────────────────────────

function categorizeNotes(notes: BgNote[]): BgImportReviewNote[] {
  const db = getBereanDb()

  const existing = new Map<string, { id: string; coreContent: string }[]>()
  const rows = db.prepare(`
    SELECT id, verse_ref, content FROM notes WHERE tags LIKE '%biblegateway%'
  `).all() as Array<{ id: string; verse_ref: string; content: string }>

  for (const row of rows) {
    const ref = (row.verse_ref || '').trim()
    if (!ref) continue
    const core = row.content
      .replace(/\n\n---\n\*Imported from BibleGateway[^*]*\*\s*$/s, '')
      .trim()
    const list = existing.get(ref) ?? []
    list.push({ id: row.id, coreContent: core })
    existing.set(ref, list)
  }

  return notes.map(note => {
    const verseRef = normaliseVerseRef(note.passage) ?? ''
    const body = note.body.trim()
    const existingForRef = verseRef ? existing.get(verseRef) : undefined

    if (!existingForRef || existingForRef.length === 0) {
      return { ...note, id: randomUUID(), status: 'new' as const }
    }
    const duplicate = existingForRef.find(e => e.coreContent === body)
    if (duplicate) {
      return { ...note, id: randomUUID(), status: 'duplicate' as const, existingId: duplicate.id }
    }
    const toUpdate = existingForRef[0]
    return { ...note, id: randomUUID(), status: 'updated' as const, existingId: toUpdate.id }
  })
}

// ── Fetch all notes ────────────────────────────────────────────────────────────

async function fetchAllNotes(
  username: string,
  password: string,
  onProgress: (done: number, total: number, message: string) => void
): Promise<{ notes: BgNote[]; error?: string }> {
  LOG('fetchAllNotes: starting')
  onProgress(0, 0, 'Connecting to BibleGateway…')

  const result = await runPhase1Hidden(username, password, (msg, done, total) => {
    if (!cancelFlag) onProgress(done ?? 0, total ?? 0, msg)
  })

  if (result === 'login-failed') {
    return { notes: [], error: 'Login failed — check your email and password.' }
  }
  if (!result || cancelFlag) {
    return { notes: [] }
  }

  LOG(`fetchAllNotes: got ${result.length} raw notes — converting`)

  const notes: BgNote[] = result
    .filter(n => n.content.trim())
    .map(n => ({
      id: randomUUID(),
      passage: n.verseRef,
      translation: 'KJV',
      body: n.content,
      color: n.color,
      createdAt: parseDate(n.createdAt),
      updatedAt: parseDate(n.updatedAt),
    }))

  return { notes }
}

// ── Save / update notes ────────────────────────────────────────────────────────

function saveSelectedNotes(
  notes: BgImportReviewNote[],
  onProgress: (done: number, total: number) => void
): { imported: number; updated: number } {
  const db = getBereanDb()
  const importedAt = new Date().toISOString()
  let imported = 0, updated = 0

  const insertStmt = db.prepare(`
    INSERT INTO notes (id, type, title, content, verse_ref, color, created_at, updated_at, tags, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateStmt = db.prepare(`
    UPDATE notes SET content = ?, color = ?, updated_at = ? WHERE id = ?
  `)

  const toProcess = notes.filter(n => n.status !== 'duplicate')
  const nowMs = Date.now()

  db.transaction(() => {
    for (const note of toProcess) {
      const verseRef = normaliseVerseRef(note.passage)
      const content = note.body.trim()

      if (note.status === 'updated' && note.existingId) {
        updateStmt.run(content, bgColorToBerean(note.color), nowMs, note.existingId)
        updated++
      } else {
        const displayTitle = note.passage.trim() || verseRef || 'BibleGateway Note'
        insertStmt.run(
          `bg-${randomUUID()}`,
          verseRef ? 'verse' : 'general',
          displayTitle,
          content,
          verseRef ?? null,
          bgColorToBerean(note.color),
          nowMs,
          nowMs,
          JSON.stringify(['biblegateway']),
          nowMs
        )
        imported++
      }

      onProgress(imported + updated, toProcess.length)
    }
  })()

  LOG(`saveSelectedNotes: imported=${imported} updated=${updated}`)
  return { imported, updated }
}

// ── Cancel flag ────────────────────────────────────────────────────────────────

let cancelFlag = false

// ── Register handlers ──────────────────────────────────────────────────────────

export function registerBgImportHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
): void {
  // Block all non-BibleGateway requests in the import session so that BG's
  // ad/tracker scripts (iqzone, kueez, omnitagjs, etc.) don't pollute the logs.
  const importSess = session.fromPartition(BG_PARTITION)
  importSess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const host = new URL(details.url).hostname
      callback({ cancel: host !== 'biblegateway.com' && !host.endsWith('.biblegateway.com') })
    } catch {
      callback({ cancel: false })
    }
  })

  function send(progress: BgProgress) {
    getMainWindow()?.webContents.send('bgImport:progress', progress)
  }

  ipcMain.handle('bgImport:start', async (_e, credentials: { username: string; password: string }) => {
    LOG('bgImport:start — handler invoked')
    cancelFlag = false

    const { username, password } = credentials ?? {}
    if (!username || !password) {
      send({ phase: 'error', done: 0, total: 0, message: 'Please enter your BibleGateway email and password.' })
      return { success: false, error: 'Missing credentials' }
    }

    try {
      send({ phase: 'login', done: 0, total: 0, message: 'Connecting to BibleGateway…' })

      const { notes, error } = await fetchAllNotes(username, password, (done, total, message) => {
        if (!cancelFlag) send({ phase: 'fetching', done, total, message })
      })

      if (error) {
        send({ phase: 'error', done: 0, total: 0, message: error })
        return { success: false, error }
      }
      if (cancelFlag) return { success: false, cancelled: true }
      if (notes.length === 0) {
        send({ phase: 'done', done: 0, total: 0, message: 'No notes found on BibleGateway.' })
        return { success: true, imported: 0 }
      }

      const reviewNotes = categorizeNotes(notes)
      const newCount     = reviewNotes.filter(n => n.status === 'new').length
      const updatedCount = reviewNotes.filter(n => n.status === 'updated').length
      const dupCount     = reviewNotes.filter(n => n.status === 'duplicate').length

      send({
        phase: 'review',
        done: notes.length,
        total: notes.length,
        message: `${newCount} new · ${updatedCount} updated · ${dupCount} already imported`,
        reviewNotes,
      })

      return { success: true }

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      LOG('bgImport:start — exception:', msg)
      send({ phase: 'error', done: 0, total: 0, message: msg })
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('bgImport:importSelected', (_e, selectedNotes: BgImportReviewNote[]) => {
    LOG(`bgImport:importSelected — ${selectedNotes.length} notes`)
    if (!selectedNotes?.length) {
      send({ phase: 'done', done: 0, total: 0, message: 'No notes selected.' })
      return { success: true, imported: 0, updated: 0 }
    }

    try {
      send({ phase: 'saving', done: 0, total: selectedNotes.length, message: `Saving ${selectedNotes.length} notes…` })
      const { imported, updated } = saveSelectedNotes(selectedNotes, (done, total) => {
        send({ phase: 'saving', done, total, message: `Saving… ${done}/${total}` })
      })

      const parts = []
      if (imported > 0) parts.push(`${imported} imported`)
      if (updated > 0) parts.push(`${updated} updated`)
      send({ phase: 'done', done: imported + updated, total: selectedNotes.length,
             message: `Done — ${parts.join(', ')}` })
      return { success: true, imported, updated }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      send({ phase: 'error', done: 0, total: 0, message: msg })
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('bgImport:cancel', () => {
    LOG('bgImport:cancel')
    cancelFlag = true
    return { success: true }
  })

  // Debug: open a visible window so the user can watch the import process
  ipcMain.handle('bgImport:debugOpen', async () => {
    LOG('bgImport:debugOpen — opening visible window')
    const win = new BrowserWindow({
      show: true,
      width: 1400, height: 900,
      title: 'BG Import — Debug',
      webPreferences: {
        partition: BG_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    win.webContents.on('console-message', (_e, _level, message) => {
      const data = parseBgMessage(message)
      if (data?.type === 'bg-progress') LOG('[DEBUG]', String(data.message || ''))
    })
    win.loadURL(`${BG_ORIGIN}/user/annotations/?iv=notes`)
    return { success: true }
  })

  ipcMain.handle('bgImport:clearSession', async () => {
    LOG('bgImport:clearSession')
    const sess = session.fromPartition(BG_PARTITION)
    await sess.clearStorageData({ storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'cachestorage'] })
    return { success: true }
  })
}
