# 10 - Performance and Resource Audit

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c` (package.json 0.8.1), checkout `/Users/roywe/Berean-audit`, detached HEAD. Purpose: identify principal runtime costs of the current Electron + Capacitor product and define what a native Swift migration could and could not be expected to change. Nothing here recommends implementing anything now.

Labels: **VERIFIED** (read in code, or measured in this audit with the command shown), **INFERRED** (follows from verified code, not observed), **UNVERIFIED** (stated by a doc or comment, not confirmed), **BLOCKED** (not checkable under the audit rules: no `npm run dev` in `/Users/roywe/Berean`, no attaching to Michael's live dev app, no ollama calls, no model downloads, no physical iPhone, no real user data or iCloud).

Every number marked "measured in this audit" was produced on the same machine: **Apple M5 MacBook Air, 32 GB, macOS 27.2 (Darwin 27.2.0), Node v24.14.0, arm64**, from `/Users/roywe/Berean-audit` built with `npm run build` (log: scratchpad `build.log`; `npm run build` took 6.4 s wall, 10.2 s user). Numbers copied from `docs/performance-audit-2026-10-19.md` ("PA-2026-10-19") or `docs/memory-and-native-feel-followup.md` ("MF") are **HISTORICAL**: they were measured on a different commit/branch (`feature/overhaul-1017`), a different macOS build (27.0.1 (26A434)), and a 530 MB copy of Michael's Berean Dev database. They are repeated here only with the label HISTORICAL and must not be compared to this audit's numbers as if they were the same experiment.

---

## 1. Measurement conditions and their limits (read first)

1. The only app launches in this audit used **fresh, empty, throwaway profiles** (`BEREAN_QA_USER_DATA=<scratchpad>/ud<k>`), so the renderer showed first-run content (onboarding), not a Scripture tab with real notes. There was no 530 MB database, no tabs, no transcripts. Anything that depends on real user data (renderer heap with 3,375 notes, chat transcripts, tab counts, search over `berean.db`) is therefore **HISTORICAL or UNVERIFIED**, not re-measured.
2. The app was launched through `node_modules/.bin/electron .` (unpackaged, loading `out/`). That is a Node launcher script plus the Electron processes. In a packaged `.app` the launcher does not exist; where a total includes it, the number is shown with the launcher separated.
3. No packaged `.app`, no `.dmg`, no MAS build, no Windows build, no iOS archive was produced. Packaged-app size, signed-app launch time and Gatekeeper first-launch cost are **BLOCKED**.
4. SQLite timings use the stock `sqlite3` 3.54.0 CLI against `data/*.db` opened with `file:...?immutable=1` (nothing written, no `-shm`/`-wal` created). The app uses `better-sqlite3` ^12.10.0 with its own bundled SQLite and an `SyncSqliteAdapter` statement cache, so absolute numbers can differ. Each query ran 2 times in one CLI session (n=2, not a distribution); queries are wrapped in `SELECT count(*) FROM (...)` so row transfer to JS and IPC are excluded.
5. No Instruments, no `sample`, no Xcode metrics. Nothing in this audit measured Swift/native code speed. **No figure here about a native implementation is a measurement; none is promised.**
6. Michael's live Berean Dev instance was not touched. Ports used: 9224 (own launcher) and 9333 (`scripts/smoke-electron.mjs`), both free before and after; `ps` showed no surviving process whose command line contained `Berean-audit` after each run.

---

## 2. Principal runtime costs of the current architecture

### 2.1 Electron/Chromium floor

Measured in this audit.

Command: `node /private/tmp/claude-501/-Users-roywe-Berean/fa975be4-1be3-4805-968a-ee7f35007f75/scratchpad/m.mjs <scratchpad>/perf` (a copy of the logic in `scripts/perf/launch.mjs` adapted for an empty profile; the repo script itself aborts on an empty profile because `window.__bereanPerf.interactive` never fires on onboarding). 5 launches, each: spawn, wait for `document.readyState==='complete'` and non-empty body, wait 8 s, `footprint -p <pid>` and `ps -o rss` for every process in the launch's process group, then `kill -9` the group.

| Quantity (5 launches, empty profile, onboarding screen) | Values | Label |
|---|---|---|
| Processes in the group | 5 each run: Node launcher (not in a packaged app), Electron main, GPU process, network utility, 1 renderer | VERIFIED |
| Physical footprint, whole group (`footprint`) | 369-376 MB (incl. ~12 MB launcher) | VERIFIED (this audit) |
| Physical footprint, the 4 Electron processes only | 357-364 MB: main 94-95, GPU 170-173, utility 13-14, renderer 78-83 | VERIFIED (this audit) |
| RSS, whole group (`ps rss`, includes shared pages) | 571-574 MB | VERIFIED (this audit) |
| Renderer JS heap (`Performance.getMetrics` `JSHeapUsedSize`) | 10 MB (4 runs), 13 MB (1 run) | VERIFIED (this audit) |
| Launch to `app ready` (main process log) | 228, 260, 276, 365, 375 ms (median 276) | VERIFIED (this audit) |
| Launch to window created | 314, 346, 359, 472, 487 ms (median 359) | VERIFIED (this audit) |
| Launch to renderer bundle evaluated (`modules-evaluated` mark) | 501, 538, 562, 765, 782 ms (median 562) | VERIFIED (this audit) |
| Launch to `app-mounted` | 524, 560, 584, 796, 819 ms (median 584) | VERIFIED (this audit) |
| Launch to first contentful paint | 637, 659, 702, 952, 957 ms (median 702) | VERIFIED (this audit) |
| `node scripts/smoke-electron.mjs` | "Smoke test passed" (renderer loaded, `window.aiLookup.listProfiles()` answered), 6.1 s wall including 1 s polling steps | VERIFIED (this audit) |

Observations:

- The run-to-run spread is large: the last two launches were ~35-40% slower in every phase than the first three (modules-evaluated 765/782 vs 501-562). Only five samples were taken, back to back, and the cause (thermal, cache, other load) was not isolated. A baseline suite must use more samples and report median and max (section 8).
- The GPU process footprint (170-173 MB) is more than twice the 77 MB recorded in PA-2026-10-19 (HISTORICAL, "Memory and long sessions"). Different macOS build, different content (onboarding with `backdrop` effects and vibrancy vs a Scripture view), and different Electron GPU settings can all contribute; **cause UNVERIFIED**. The renderer footprint here (78-83 MB, empty profile) is half of the historical 163 MB (real data loaded). Neither can be generalized.
- Electron's runtime is a fixed cost independent of Berean content: `du -sh /Users/roywe/Berean/node_modules/electron/dist/Electron.app` = 231 MB, of which `Electron Framework.framework` is 230 MB (read-only `du`, measured in this audit). The packaged `.app` also embeds the Berean renderer, main bundle and `data/*.db` (below).
- Per `electron/main.ts:140-152`, the MAS build runs the GPU in-process and disables hardware acceleration (`disable-gpu`, `disable-gpu-compositing`, `in-process-gpu`, `NetworkServiceSandbox` disabled). This is a materially different performance profile from the DMG build and nothing measured here covers it. **MAS performance: BLOCKED.** This is a notable finding for migration: the Mac App Store build of the current app renders Chromium without the GPU process, so a native-vs-Electron comparison needs to name which Electron build it compares against.

HISTORICAL (PA-2026-10-19, not re-measured): Mac physical footprint at launch about 380 MB (renderer 163, main 113, GPU 77, utility 14 + 12); startup phases app ready 227, window created 277, modules evaluated 399, FCP 503, first Scripture 570, interactive 607 ms (median of 10, built app, QA copy of a 530 MB database); idle CPU 1.35% of one core on the Mac and 0.10% (web process) on the iPhone simulator after one fix; 20 workflow rounds grew JS heap 59.2 to 60.1 MB.

### 2.2 Shipped bundle sizes

Measured in this audit with `du -sh out out/*`, `ls -l out/renderer/assets`, `ls -l out/main out/preload` after `npm run build`.

| Artifact | Size |
|---|---|
| `out/` total | 34 MB |
| `out/renderer/assets/index-CueXy9o_.js` (main renderer bundle) | 5,106,325 bytes |
| `out/renderer/assets/kokoro.worker-DHhanHPr.js` | 5,136,826 bytes |
| `out/renderer/assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm` | 21,596,019 bytes (excluded from the packaged app by `"files": ["out/**/*", "!out/renderer/assets/ort-wasm-*.wasm"]`, package.json:132-135; the runtime is downloaded from `cdn.jsdelivr.net` per `electron/ttsModelManifest.ts:42`) |
| `pdf.worker.min-*.mjs` | 1,375,838 bytes |
| `index-*.css` | 398,839 bytes |
| `SettingsModal-*.js` / `ChatTitle-*.js` / `YouTubeTab-*.js` | 270,796 / 271,708 / 174,480 bytes (approx., from the build log) |
| `out/main/index.js` | 1,094,834 bytes |
| `out/preload/index.js` | 46,353 bytes (its only `require` is `electron`, verified by grep) |

Bundled data (not code, but part of the install): `data/*.db` for the Mac `extraResources` (all `*.db` except `youtube_index.db`, package.json:138-146) totals **378,961,920 bytes**, computed with `stat -L -f %z` over the symlinked files. Largest: `youtube_seed.db` 187.4 MB, `tske_refs.db` 45.0 MB, `strongs_greek.db` 28.1 MB, `lxx.db` 23.9 MB, `cross_references.db` 19.8 MB, `kjva.db` 19.4 MB, `lxx_brenton.db` 16.3 MB, `kjv.db` 8.4 MB. The iPhone bundle list `scripts/ios/bundled-dbs.txt` totals **164,663,296 bytes** (23 databases including the 7 MB `youtube_index.db`, excluding the YouTube seed and embeddings). A native app would bundle the same SQLite files unchanged (see doc 04), so these bytes are not a migration saving. VERIFIED.

First-load JS parse and evaluation: 5.1 MB of minified JS is one chunk (`index-*.js`). HISTORICAL (PA-2026-10-19): "198 ms eval in session 1"; lazy-loading four secondary apps (-334 KB) was tried and reverted as within noise. Not re-measured.

### 2.3 Process count and background memory

VERIFIED (static): Electron runs one renderer per BrowserWindow. Window kinds (doc 02 section 4): main (each peer window is its own renderer and its own Zustand store), floating tab, presenter/viewer, Study Trail, Berean Chat, verse picker, hidden print/PDF windows, BibleGateway windows, dev-only transcript workers, and the `<webview>` YouTube guest in `persist:youtube`. Each extra window therefore adds a Chromium renderer plus (for `<webview>`) a guest process. No `utilityProcess`, `worker_threads` or child processes exist (doc 02 section 11), so every main-process handler (all 295 `handle` channels), `better-sqlite3` call, vault export, sync engine pass and Ask Berean retrieval pass runs on the **single Electron main-process JS thread**. VERIFIED.

Historical measurement of what extra windows cost: **none exists.** PA-2026-10-19 says Calendar, Study Trail window, presenter/viewer, PDF viewer, YouTube player, tag graph, compare view, TTS and importers were "NOT MEASURED in depth". Multi-window/multi-panel memory: **UNVERIFIED, BLOCKED** in this audit (would need a populated profile and driving windows over CDP, which the rules allow only against a throwaway instance; not done for time).

Background timers on the Mac (VERIFIED in code):

| Timer | Where | Interval |
|---|---|---|
| Update check | `electron/main.ts:2100` (`UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000`), each tick runs two `db.prepare(...).get()` queries on the main thread and then `autoUpdater.checkForUpdates()` | 5 min |
| Vault auto-export | `electron/ipc/vault.ts:1400` | 5 min, plus on quit; vault.ts contains 13 synchronous fs calls (`readFileSync`/`writeFileSync`/`statSync`/`readdirSync`) |
| Vault trash purge | `vault.ts:1445` | hourly |
| Theme poll | `src/App.tsx:598` and `:721` | 2 s (historical doc) |
| localStorage flush | `src/lib/debouncedStorage.ts:74` | 5 s |
| YouTube tab (webview) | `YouTubeTab.tsx:396` (5 s save), `:939` (200 ms poll), `:1074` (style apply, 1 s times a multiplier), `:1241`, `:1302` | each only while a YouTube tab with a `<webview>` is mounted |
| Study Trail window | `StudyTrailApp.tsx:254`, `:268` | 2 s |
| Sync host | `src/platform/sync/hostCore.ts:92` | 60 s fallback, 1.5 s debounce on change |
| Liquid Glass (iPhone only) | `src/platform/liquidGlass/react.tsx:433` | 350 ms tick, now gated by a dirty flag (historical fix) |

### 2.4 React rendering and Zustand

VERIFIED (static): one global store `src/store/index.ts` (3,808 lines); `ChapterView` is wrapped in `memo` (`ChapterView.tsx:1431`), `VerseRow` in `memo` (`VerseRow.tsx:2155`); `ChapterView.tsx:81` and `:92` document stable empty-array references so shallow comparison holds. A chapter's verses are cached in an LRU of 150 entries (`src/lib/chapterCache.ts:15`, `MAX_ENTRIES = 150`).

STILL OPEN from `docs/memory-and-native-feel-followup.md` (MF), re-checked in this audit's code:

- MF Memory item 2, PDF canvases never released: **still present.** `src/components/pdf/PdfPage.tsx:57-61` creates an `IntersectionObserver` whose callback only calls `setVisible(true)` (`:59`), never `false`; `PDFViewer.tsx` renders every page. VERIFIED (code read). MF's "~15-17 MB per letter page at scale 1.5 / dpr 2" is an arithmetic estimate in MF, not a measurement; not re-measured here (UNVERIFIED). This is the largest single memory risk found by either audit and it is a property of the current web implementation, not of Electron.
- MF Memory item 3, notes folder tree not virtualized: `@tanstack/react-virtual` is used in `ScriptureSearchView.tsx`, `NotesList.tsx` and `src/mobile/notes/VirtualNoteList.tsx` only (grep); `NotesFolderView.tsx` still lacks it. VERIFIED (grep).
- MF Memory item 1 (`activeTabId` fan-out) and item 5 (`expandIdiomPatterns` per row, `VerseRow.tsx`): not re-verified this audit. UNVERIFIED.

Continuous Scripture scrolling: `ContinuousChapterScroll.tsx:86-95` and `:267-280` implement its own windowing: a `WINDOW_CHAPTERS` window of mounted chapters, eviction of far chapters, and height-preserving placeholders sized from measured heights. This is application-level virtualization; its correctness (scroll jump, drift) depends on measured heights, which is a recognizable class of web-specific risk. INFERRED.

### 2.5 Large Scripture documents and the longest chapters

Measured in this audit (`sqlite3 "file:<repo>/data/kjva.db?immutable=1"`):

| Query | Result |
|---|---|
| Longest chapter by verse count, `kjva.db` | `PSA 119`, 176 verses (`SELECT book_id,chapter,count(*) ... ORDER BY 3 DESC LIMIT 3` -> PSA/119/176, 2ES/7/140, 1ES/8/96) |
| Same, `lxx_brenton.db` | `PSA 118`, 176 verses (Brenton numbering) |
| Longest by characters, `kjva.db` plain `text` | `2ES 7`: 140 verses, 18,581 chars; `1ES 8`: 13,601; `PSA 119`: 12,839 chars; `1MA 10`: 12,245 |
| Strong's-tagged text length (`text_tagged`) for the longest tagged chapters | `PSA 119`: 23,057 chars; `1KI 8`: 21,071 chars (the `2ES`/`1ES`/`1MA` rows have no tags: 0) |
| `kjva.db` verse count | 36,890 |

So the worst-case chapter the reader must render is on the order of 140-176 `VerseRow` components and 13-23 KB of text. The DOM node count, layout and paint time for those chapters in the real renderer were **not measured** in this audit (empty profile, no CDP navigation done). HISTORICAL (PA-2026-10-19): chapter navigation 57 ms (p95 69), `bible:queryChapter` 0.2 ms, Scripture scrolling 0 frames over 25 ms with 0 long tasks, on Mac Chromium; iPhone simulator (WKWebView, Debug) chapter change 94 ms, reader scroll p95 17 ms at 60 Hz. The 2,000-line `VerseRow.tsx` renders Strong's chips, highlights, tags and note dots per verse; for Psalm 119 with Strong's on this multiplies component count by words (INFERRED, not measured).

### 2.6 Database query latency

Measured in this audit (command pattern: `sqlite3 "file:$PWD/<db>?immutable=1"` with `.timer on`, query wrapped in `SELECT count(*) FROM (...)`; n=2 per query, first value is the first run in that session):

| Query (as issued by `src/platform/services/bibleService.ts:94-107, 156-181`) | `kjva.db` | `lxx_brenton.db` |
|---|---|---|
| `queryChapter` Psalm 119 (176 rows / 7 rows for LXX PSA 119) | 0.232 ms, 0.038 ms | 0.204 ms, 0.021 ms (the LXX table has 7 verses at PSA 119; PSA 118 has 176) |
| FTS `"the"`, `JOIN verses`, `ORDER BY rank LIMIT 2000` | 69.7 ms, 60.1 ms | 56.9 ms, 44.7 ms |
| same on `kjv.db` | 53.1 ms, 22.4 ms | not run |
| FTS `"grace"` (181 rows / 45 rows) | 0.89 ms, 1.25 ms | 0.47 ms, 0.33 ms |
| FTS `"yehovah"` on `kjv.db` | 0 rows, 0.26 ms | not run |

Reading: single-chapter lookups are sub-millisecond; rare-word FTS is about 1 ms; a stop-word search that must rank 12,000+ matches and return the top 2,000 costs tens of milliseconds (22-70 ms here, with high variance, n=2). HISTORICAL (PA-2026-10-19): IPC/DB calls under 5 ms except a search for "the" at 22 ms on the 530 MB DB; `getNotes` 4.6 ms; open of `berean.db` 5 ms. The 22 ms historical value coincides with the lowest value here (22.4 ms, `kjv.db` second run); the spread between runs (53 to 22 ms on the same CLI session) shows page-cache and run-order effects, so these figures give a range, not a baseline. A native app using the same SQLite files and the same FTS5 schema would run the same query plans; **a measurable native speedup for database access is not expected from the engine itself** (SQLite is the same C library). The recoverable overheads are IPC marshalling and JSON, not query time. Not measured: notes FTS, `youtube_seed.db` transcript FTS (187 MB, 4.06 M segments in the historical copy), `tske_refs.db`/`cross_references.db` lookups, the `berean.db` write path (autosave 500 ms debounce).

The Mac main process also runs `SyncSqliteAdapter` statements **synchronously** on the main JS thread (the adapter's async facade resolves immediately; `electron/db/adapters/syncSqliteAdapter.ts`). Any 50-70 ms FTS query blocks every IPC handler and every window's menu/IPC events for that duration. INFERRED from code; blocking behaviour was not observed.

### 2.7 Search latency (end to end)

HISTORICAL only (PA-2026-10-19): floating search results 85-91 ms after a debounce reduction (120 to 60 ms); Advanced Scripture Search "grace" 52-59 ms, "the" 124 ms, "yehovah" 160-191 ms; Find-in-chat first keystroke 649 ms before a fix and ~106 ms after; chat find count 1.7-5 s before and ~0.36 s after. None re-measured here (these require real keyed input over CDP against a populated profile, which was not set up). Ask Berean retrieval (keyword FTS + Strong's + TSKE + notes + transcripts + embeddings, `electron/ipc/aiLookup.ts`, 4,156 lines) is single-threaded in the main process; the model call dominates (HISTORICAL "answer in ~7 s (model)"). BLOCKED: no ollama.

### 2.8 Startup

See 2.1 for this audit's numbers. Structure (VERIFIED in code, doc 02 section 2): the main process runs `restoreFolderAccess()`, `initBereanDb()` (open + migrate, schema v49 `bereanMigrations.ts`), `initDesktopServices()`, then creates windows; the renderer evaluates a single 5.1 MB bundle then calls the shared services over IPC. `mergeYouTubeSeed` is deferred. Migration work at startup scales with how many of the 49 migrations are pending; on upgrade, `runMigrations` takes a consistent backup first (`beforeMigrate`) and runs `checkDatabase` (`bereanMigrations.ts` around line 1316). An upgrade-launch measurement (version N-1 database opening in N) was **not** taken: BLOCKED (needs a real older DB copy).

iPhone: HISTORICAL (PA-2026-10-19): web view starts about 1.58 s after `simctl launch` in a Debug simulator build (71 MB `App.debug.dylib` pre-main), JS boot +78 ms, first chapter +155 ms. PA states these are not representative of a Release build on a phone. No device or Release measurement exists. UNVERIFIED.

### 2.9 Speech and media

- **Read Aloud / Kokoro (Mac)**: inference runs in a Web Worker (`src/lib/tts/kokoro/kokoro.worker.ts`, bundle 5.1 MB) using `onnxruntime-web` WASM (21.6 MB wasm, downloaded at runtime), reading model files from `berean-model://local/` served by `electron/ttsModelProtocol.ts`. Synthesized PCM is cached in `userData/tts-audio-cache` with an LRU cap (`electron/ipc/ttsAudioCache.ts`). Synthesis latency, real-time factor, memory during synthesis: **not measured; BLOCKED** (no model download permitted). No historical number exists in either performance document ("audio / TTS ... NOT MEASURED in depth").
- **Read Aloud (iPhone)**: default `AVSpeechSynthesizer` through `BereanSpeech` (97 lines); optional Kokoro voice pack with native ONNX Runtime (`BereanVoicePackPlugin.swift`, onnxruntime-swift-package-manager 1.24.2). Already native inference on iPhone; the Mac WASM path is the part a Swift migration would replace. No measurement of either.
- **YouTube**: Mac plays inside `<webview partition="persist:youtube">` (`YouTubeTab.tsx:1836`), which is a full Chromium guest process plus the polling timers listed in 2.3. iPhone uses a separate native `WKWebView` (`BereanWebView`) for the embed and a touch player path (`TouchYouTubePlayer`). YouTube is playback of a web page in both cases; a native app would still use `WKWebView` (or the iframe player) for playback, so the YouTube tab is not a candidate for a large win from going native. INFERRED.
- `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')` (`main.ts:118`).
- Ollama: `electron/ollama.ts` sets `NUM_CTX = 16384` and a keep-alive plus idle-unload timer; its own comments record ~7 GB resident while the model is loaded. That memory is in the Ollama process, not Berean's, and is unaffected by the UI stack. A native app calling the same local Ollama server keeps the same cost. INFERRED from source comments; UNVERIFIED by measurement.

### 2.10 Large notes, images, multiple panels

HISTORICAL (PA-2026-10-19): note open 41 ms (452 KB note 67 ms), keystroke 30 ms, no leak across note switching (footprint +1-2 MB; RSS growth was reclaimable), a note with a 330 KB embedded PNG adds about 25 MB once for the decoded image. Images are stored inline as base64 while vault sync is off (CLAUDE.md section 9; extracted to `attachments/` on vault export). Large-note and large-image behaviour at tens of MB: **UNVERIFIED**. Multiple Mosaic panels (react-mosaic): no benchmark exists. Chat transcript rows use `content-visibility: auto` (historical fix). The ProseMirror editor (`src/components/notes/pm/*`) serializes markdown on a 500 ms autosave debounce.

---

## 3. What a native migration would plausibly change

Classification rule used below: **Probable** = follows directly from removing a component whose cost was measured or is structurally fixed; **Depends** = real potential but determined by how the Swift code is written; **Needs empirical verification** = no evidence either way in this audit. No percentage or millisecond improvement is claimed anywhere in this document.

### 3.1 Probable (structural; direction is not in doubt, size is not measured)

1. **Removing the bundled Chromium runtime.** The Electron framework alone is 230 MB on disk (measured, 2.1) and the app runs a separate GPU process (170-173 MB footprint in this audit's empty-profile run) and a network utility process in addition to main and renderer. A native AppKit/SwiftUI app has no equivalent fixed floor. The direction (smaller install, lower baseline memory, fewer processes) is certain; the amount is not measured for a Swift app.
2. **One process instead of 4-5+ per window set.** Native windows share one address space; opening a Study Trail, presenter or chat window no longer spawns another renderer. Multi-window memory in the current app is unmeasured (2.3), so the saving is unquantified.
3. **No JS parse/evaluation of a 5.1 MB bundle at every window start** (historical ~120 ms module evaluation; 501-782 ms launch-to-evaluated in this audit's five runs including Electron startup).
4. **Main-thread IPC and JSON marshalling removal.** 295 `ipcMain.handle` channels serialize arguments and results through structured clone; chapter payloads and large arrays (YouTube transcripts, chat transcripts, search results of 2,000 rows) are copied between processes. A native app calls the services in-process.
5. **Mac App Store build no longer needs GPU-disabled Chromium workarounds** (`main.ts:140-152`). VERIFIED that MAS currently disables GPU compositing; the performance effect on that build was never measured.
6. **Kokoro on Mac could use native ONNX/Core ML instead of WASM** the way the iPhone already uses native ONNX (`BereanVoicePackPlugin`). Probable that this removes the 21.6 MB downloaded WASM runtime and Web Worker; speed gain unverified (see 3.3).

### 3.2 Depends on implementation quality

1. **Scripture rendering of the longest chapters.** Psalm 119 (176 verses) with Strong's chips, highlights, tags and note dots, in continuous scroll across chapters. Native text layout (TextKit 2) is fast for plain text but attributed text with many inline tappable chips, and per-word highlight ranges, can be slower than the DOM if implemented as one giant `NSAttributedString`, or fine if virtualized by verse. The current code already virtualizes chapters in `ContinuousChapterScroll.tsx`; a native port must re-solve the same scroll-anchor/height-estimation problem.
2. **Selection, find-in-chapter, copy with Strong's markup, drag-select of verses** (`verseDragSelect.ts`). Browsers provide text selection, hit testing and find for free; native text views offer them with different limits. Quality depends on the chosen text stack.
3. **Notes editor.** The 20 K-line notes component set is built on ProseMirror (`src/components/notes/pm/*`), including tables, blockquote indent, slash commands, inline images, wikilinks, verse-reference decorations. Native rich text editing (`NSTextView`/TextKit 2) of large attributed documents with tables and images is a classic area where both much better and much worse than a web editor are possible. Large-note behaviour (452 KB note: 67 ms open historically) is the baseline to beat.
4. **Database layer.** SQLite is unchanged (same files, same FTS5). The gain is removing the main-thread synchronous bottleneck, but only if the Swift code puts queries off the UI thread and uses read-only connections correctly; GRDB/SQLite.swift/C API choice, prepared-statement reuse and WAL settings (`afterPack` converts bundled DBs to DELETE journal mode) all matter.
5. **Sync engine** (`src/platform/sync/*`, `electron/sync/*`): iCloud file operations (`NSFileCoordinator`, `NSMetadataQuery`) are already native on iPhone (`BereanCloudPlugin`, 346 lines). A Swift Mac app can use the same APIs. Quality depends on coordination and debounce discipline.
6. **PDF viewer.** PDFKit (`PDFView`) manages page rendering and memory natively; the current `pdfjs-dist` viewer never releases canvases (2.4). A native viewer is likely to avoid that specific leak but PDFKit has its own memory behaviour on very large documents; highlights and bookmarks are app data and must still be reimplemented.
7. **Study Trail graph, tag graph, Mosaic panel layout, presenter overlay.** These are custom canvas/React UI. Performance on a native port depends entirely on the drawing technique (Core Animation layers vs `Canvas`).

### 3.3 Needs empirical verification (no evidence in either audit)

- Native vs Electron **cold launch** of the packaged app (signed, Gatekeeper-first-launch included).
- Memory with a realistically populated profile and several windows (the historical Berean Dev copy is the right workload but is Michael's data; use a synthetic set, section 8).
- Kokoro synthesis latency and memory natively vs WASM on Mac.
- Ask Berean retrieval pipeline time after porting `aiLookup.ts` (4,156 lines) to Swift; it is mostly SQLite queries plus network/Ollama calls, so engine gains are likely small (INFERRED).
- Energy impact. The historical docs record idle CPU only (Mac 1.35% of one core). No energy or battery data exist for either platform; battery is not measurable in the simulator.
- Physical iPhone behaviour of the Capacitor app. All iPhone numbers in PA-2026-10-19 are from a Debug simulator build on Mac hardware (60 Hz); the document says so itself.
- iPhone app: the Capacitor app is already native for SQLite, iCloud, audio, speech, glass and print. What remains web is the UI. A migration of the iPhone UI to SwiftUI would change WKWebView memory (HISTORICAL simulator: app 22 MB, web content 86, GPU 16, networking 9, about 133 MB total) and scroll smoothness; the physical-device baseline needed to judge that does not exist.

### 3.4 Things a native migration will NOT speed up

SQLite query execution itself; FTS5 ranking cost for stop-word queries (section 2.6); the local LLM (Ollama, 16,384 context, multi-GB resident); network latency (YouTube Data API, GitHub release checks, Anthropic/Sefaria/Wikipedia calls); iCloud propagation delay; YouTube video playback (still a web player); `youtube_seed.db` bytes and the other 379 MB of bundled data.

---

## 4. Platform risk list observed in the current implementation (for the migration test plan)

| ID | Observation | Label |
|---|---|---|
| R1 | Everything database-related on the Mac runs on one JS thread, synchronously (`SyncSqliteAdapter`); stop-word FTS cost 22-70 ms in this audit's CLI measurement | INFERRED (block), VERIFIED (query time) |
| R2 | PDF page canvases are never released (`PdfPage.tsx:59`) | VERIFIED |
| R3 | `NotesFolderView` has no virtualization | VERIFIED |
| R4 | Mac App Store build disables the GPU and the Network Service sandbox (`main.ts:140-152`) | VERIFIED |
| R5 | `chokidar` is imported by `electron/ipc/vault.ts` but not declared in `package.json` (doc 02 section 12) | VERIFIED (from doc 02) |
| R6 | `onnxruntime-node` and `sharp` are transitive; whether they are packaged on Mac is unknown (doc 02 section 20) | UNVERIFIED, BLOCKED |
| R7 | 5-minute update check wakes the main thread and issues two sync DB reads per tick (`main.ts:2100-2108`) | VERIFIED |
| R8 | arm64-only DMG/MAS (`package.json` mac targets arm64); Windows NSIS is x64 | VERIFIED |
| R9 | Large run-to-run variance in launch time on this machine (501 to 782 ms to evaluated); baselines need many samples | VERIFIED (n=5) |

---

## 5. Existing baselines re-labelled

| Source | Claim | Status here |
|---|---|---|
| PA-2026-10-19 Startup table | first Scripture 570 ms, interactive 607 ms, app ready 227 ms | HISTORICAL; this audit's empty-profile app-ready median is 276 ms (n=5), different macOS, no Scripture view, so no like-for-like comparison |
| PA-2026-10-19 Memory | footprint ~380 MB at launch (renderer 163, main 113, GPU 77, utility 14+12) | HISTORICAL; this audit 357-364 MB for 4 Electron processes with an empty profile; GPU 170-173 vs 77 unreconciled |
| PA-2026-10-19 DB/IPC | all under 5 ms except "the" 22 ms | HISTORICAL; CLI SQL "the" 22-70 ms here |
| PA-2026-10-19 chat/find numbers, notes numbers, Scripture scroll frame data, iPhone simulator numbers | various | HISTORICAL, not re-run |
| MF memory punch list | PDF canvas leak, no folder virtualization | Re-verified in code (R2, R3); sizes unverified |
| MF native-feel items | font, accent, radius | Not performance; not re-checked |
| Doc 02 and CLAUDE.md claims of test counts and CI | n/a | not performance |

---

## 6. Files and symbols cited

`electron/main.ts` (lines 118, 123-138, 140-152, 1086, 1183, 2100-2108), `electron/db/adapters/syncSqliteAdapter.ts`, `electron/ipc/vault.ts:1400, 1445`, `electron/ipc/aiLookup.ts`, `electron/ollama.ts`, `electron/ipc/ttsAudioCache.ts`, `electron/ttsModelProtocol.ts`, `electron/ttsModelManifest.ts:42`, `src/platform/services/bibleService.ts:94-107, 156-181`, `src/lib/chapterCache.ts:15`, `src/components/bible/ChapterView.tsx:81, 92, 1431`, `src/components/bible/VerseRow.tsx:2155`, `src/components/bible/ContinuousChapterScroll.tsx:86-95, 267-280`, `src/components/pdf/PdfPage.tsx:57-61`, `src/components/youtube/YouTubeTab.tsx:396, 939, 1074, 1241, 1302, 1836`, `src/platform/liquidGlass/react.tsx:433`, `src/platform/sync/hostCore.ts:92`, `package.json` (build block lines 123-259), `scripts/perf/*`, `scripts/smoke-electron.mjs`, `scripts/ios/bundled-dbs.txt`.

---

## 7. Open items

- UNVERIFIED: Scripture DOM node count and render time for PSA 119 with Strong's on; packaged-app size; multi-window memory; Kokoro numbers; iPhone Release/device numbers.
- BLOCKED: any measurement needing ollama, a model download, Michael's data or live app, a signed build, or a device.

---

## 8. Proposed reproducible baseline suite to run before any migration decision

Principle: run the **same scripted workload** on the Electron app (DMG build and MAS build, separately) and, later, on the Swift app, with a **synthetic, committed-to-repo-free** dataset (never Michael's data), on a quiet machine, 10+ launches, median and max reported, thermal state recorded.

1. **Dataset generator** (new tooling, to be written later, not now): creates a throwaway `berean.db` through the app's own services with N notes (e.g. 500 / 3,000 / 10,000), a few of 100 KB / 1 MB / 5 MB, notes with 1 / 10 / 50 inline images, 300 chats, 167 tabs, a transcript table of fixed size. Parameters recorded in the result file. Existing `scripts/perf/*` already assume a profile copy; replace the copy with this generator.
2. **Launch**: `scripts/perf/launch.mjs`-style 10 cold-ish launches (note: true cold launch needs `sudo purge` or reboot; record which). Metrics: process spawn to app ready, window created, first contentful paint, first Scripture visible, interactive. For the Swift app, equivalent marks added by its own code (the metric definitions must be identical in wording).
3. **Footprint**: `footprint -p` per process at +8 s and after the standard workload (item 5), plus total process count, RSS, and `ps -M` thread count. Both apps under the same macOS build.
4. **Scripture**: open PSA 119 (KJV tagged, 176 verses, `text_tagged` 23,057 chars), 2ES 7 (140 verses), PSA 118 LXX; measure event-to-painted-frame for chapter open, next/prev chapter, continuous scroll across 5 chapters (frame-time histogram, count of frames over 16.7 and 25 ms), verse select + highlight, find-in-chapter, Strong's tooltip, with Strong's toggled on and off, and with 0 / 50 / 500 highlights and note dots.
5. **Workload loop** (for leak and growth checks): 20 rounds of the PA-2026-10-19 mixed workflow (tabs, chapters, find, notes, lexicon, spaces, chat panel, floating search), recording footprint every round.
6. **DB/search**: per-query p50/p95 of `queryChapter`, FTS "the", "grace", a 3-word phrase, notes FTS, transcript FTS, cross-reference lookup; 50 iterations each against the real bundled DBs opened read-only; record SQLite library version for each runtime and use identical PRAGMAs. Measure both raw SQL (CLI) and the in-app call path so IPC overhead is isolated.
7. **Notes**: open, type (key-to-paint), scroll, paste a 1 MB markdown document, insert 10 images, switch among 100 notes, autosave latency; memory before and after.
8. **PDF**: open a 300-page PDF, scroll end to end, record footprint every 25 pages (this exposes R2), close and record release.
9. **Multi-window**: open main + chat + Study Trail + presenter + 1 floating tab; footprint per process and total; repeat with the YouTube tab open and playing a fixed video (network-dependent; record network state).
10. **Speech** (needs the model download, which the audit rules forbade; run later with permission): Kokoro synthesize a fixed chapter, record time to first audio, real-time factor, peak footprint; same on `AVSpeechSynthesizer`.
11. **Idle**: 5 minutes idle with a populated profile; average CPU % (`top -pid`), wake-ups, `powermetrics` energy impact if sudo is available (record machine state).
12. **Upgrade launch**: open a profile at schema v48 with the app at v49 and record migration plus backup time (generator can write an older schema).
13. **iPhone**: a physical device in Release configuration, same dataset via iCloud-free local import; Instruments (Time Profiler, Allocations, Energy Log) for launch, Psalm 119 scroll, and note typing; record thermal state and Low Power Mode. The simulator numbers in PA-2026-10-19 cannot substitute.
14. **Reporting format**: one JSON per run with machine (model, RAM, macOS build), app build hash, dataset hash, exact command, N, median/p95/max. Results from different macOS builds must not be compared.

Existing assets to reuse (VERIFIED present): `scripts/perf/launch.mjs`, `fp.sh`, `keep.mjs`, `nav.js`, `scroll.mjs`, `notes.mjs`, `search2.mjs`, `chatfind.mjs`, `chatlong.mjs`, `ipc.js`, `bisect.mjs`, `webkitcss.js`, `scripts/smoke-electron.mjs`, and `src/lib/perfMarks.ts` (`window.__bereanPerf`). Known gap: `launch.mjs` throws on a profile that never reaches `interactive` (observed in this audit), so it needs an onboarding-bypass setting or a seeded profile.
