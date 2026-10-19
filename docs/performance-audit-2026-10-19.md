# Performance audit — macOS and iOS (2026-10-19)

Branch `feature/overhaul-1017`. Every number here was measured in this session; "NOT MEASURED" means
exactly that. Benchmark scripts: `scripts/perf/` (see the end of this file).

## Summary

- **Ordinary use was already within target on both platforms.** Opening chapters, switching tabs
  and spaces, typing in notes, the composer and search, opening panels, and scrolling Scripture all
  respond in under 100 ms. Scripture scrolling had no frame over 25 ms. Database and IPC calls take
  under 5 ms on the 530 MB Berean Dev database, except a search for "the" (12,106 verses) at 22 ms.
- **The worst problem found was in shared CSS, and it only affects the Mac.** Tailwind's
  `space-y-*` / `divide-y` and seven `> * + *` rules use sibling selectors whose right-hand side
  matches almost any element. In Chromium, inserting an element before such siblings restyles every
  following sibling's whole subtree. Prepending one message to a 300-message transcript cost
  ~120 ms of style recalculation; it now costs 3–4 ms. WebKit (iPhone) doesn't have this problem:
  1 ms with and without the rules.
- **Find in a long conversation stalled typing.** The first keystroke took 649 ms in a 600-message
  conversation. It's now about 106 ms when typing starts immediately after ⌘F, and 47 ms median
  0.4 s after. The complete count arrives in about 0.36 s, previously 1.7–5 s.
- **A leftover diagnostic shipped.** `HIGHLIGHT_OFFSET_DEBUG = true` logged verse text on every
  Scripture selection, and the main process copied every renderer console line to disk
  synchronously.
- **iPhone idle CPU.** The Liquid Glass safety-net re-check ran every 350 ms for the life of the
  app. The web process now uses 0.10% of a core while idle, down from 1.63%.
- **Memory:** no leak found. An apparent 300 MB "growth" in RSS was freed-but-reclaimable memory;
  the physical footprint stayed flat.

## Environment

| | |
|---|---|
| Mac | Apple M5, 32 GB, macOS 27.0.1 (26A434) |
| Tooling | Xcode 27.0, Node 24.14.0, npm 11.9.0 |
| Libraries | Electron ^32.3.3, React ^18.3.1, Capacitor ^8.5.2, better-sqlite3 ^12.10.0, Tailwind 3.4.19 |
| Mac build | **Built** app (`electron-vite build`, minified, loaded from `out/`), run unpackaged as Berean Dev. Runs used a QA profile (`BEREAN_QA_USER_DATA`): an online-backup copy of the Berean Dev `berean.db` (530 MB: 3,375 notes, 45 chats, 167 tabs, 4.06 M YouTube transcript segments), with `icloudSyncEnabled` and `vaultSync` set to false in the copy. Your own Berean Dev data and iCloud were never touched. |
| Mac large-data | The same copy plus 300 conversations × 8 messages and one 600-message conversation (tables, lists, code blocks), created through the app's own chat service. |
| iPhone | Simulator iPhone 18 Pro (iOS 27.0, 60 Hz), Berean Dev Debug, existing simulator data (1 Scripture tab, 5 tabs in total). Probe build for driving it; a build without the probe for idle-CPU measurements. |
| Runs | "Warm" means the OS file cache was warm. A true cold launch, after a reboot or a cache purge, wasn't possible here. |

## Feature inventory and coverage

Columns: benchmark method · baseline · final. "Inspected" means read in the code, not benchmarked.

| Area | Main entry points | Data / services | Benchmark | Baseline | Final | Status |
|---|---|---|---|---|---|---|
| Launch / first window | electron/main.ts, src/main.tsx, App.tsx | berean.db open, migrations | launch.mjs, 10 warm launches, marks from src/lib/perfMarks.ts | first Scripture 678, interactive 735 (session 1); fixed-copy A/B reference 577 / 613 | 570 / 607 (fixed copy) | OK; see Startup |
| Chapter navigation | BiblePanel `berean:next/prevChapter`, ChapterView | bible:queryChapter (0.2 ms) | nav.js, event to painted frame | 57 / p95 69 | A/B: 67 old CSS = 67 new | OK (<100) |
| Scripture tabs | store setActiveTab | — | nav.js | 42 / 79 | A/B: 45–46 = 46–57 | OK |
| Spaces (Scripture ↔ Notes, Search, YouTube) | setActiveSpace | — | nav.js, generic.js | 36 / 49; YouTube settles in 575 (web view) | A/B 51 = 55 | OK |
| Floating search ⌘K | FloatingSearch.tsx | notes + verse FTS IPC | search.mjs, search2.mjs (real keys) | open 56, keystroke 26, results 143–155 (yehovah 212) | results **85–91** (yehovah 151), keystroke 26 | **Improved** |
| Advanced Scripture Search | ScriptureSearchView (virtualized) | bible:searchText | in-page | grace 52–59, the (12,106) 124, yehovah 160–191 | — | OK, unchanged |
| Find in chapter | FindBar, BiblePanel | — | generic.js | open 41 | — | OK |
| Strong's / lexicon / font size / sidebar / Settings | toolbar, store | lexicon IPC | generic.js | 49 / 54 / 38 / 67 (animation 263) / 78 (+35 ms JS per open) | — | OK; Settings is a minor item |
| Scripture scrolling | ChapterView | — | scroll.mjs (real wheel), rAF frames | 0 frames >25 ms, 0 long tasks | same | OK |
| Notes: open / type | NotesPanel, ProseMirror | notes IPC (getNotes 4.6 ms) | notes.mjs | open 41 (452 KB note 67), keystroke 30 | A/B 51–65 = 51–53 (16 samples) | OK |
| Notes: memory over time | — | — | bisect.mjs, footprint | flat (+1–2 MB); the image note +25 MB once | — | OK, no leak |
| Chat: open / switch / All Messages | ChatWindowApp, useChatController | aiChatsService (listChats 0.3 ms) | chat.mjs | open 335, switch 32, All Messages 122 | open 296, switch 42 (p95 85), All Messages **107** | OK / improved |
| Chat: 600-message conversation | ChatTranscript | getChat 0.3 ms | chatlong.mjs | open 156, Show Earlier 242 | **102 / 66** | **Improved** |
| Chat: Find in conversation | ChatTranscript, chatFind | — | chatfind.mjs (real keys) | first key **649**, count 1.7–5 s | typing at once ~106; after 0.4 s 47 median (p95 63); count ~0.36 s | **Fixed (P1)** |
| Chat: composer | ChatComposer, ProseMirror | — | key to paint | 22–26 | 22–26 | OK |
| Ask Berean (AI) | aiLookup IPC → Ollama | local model gemma/llama | ai.mjs | your message shows in 7 ms, answer in ~7 s (model), 0 long tasks, composer 26 ms during | — | OK; the time is the model |
| Swipe-for-times gesture | useTimestampReveal | — | earlier round | (fixed earlier this session) | 1 ms/frame style | OK |
| Calendar, Study Trail, presenter, PDF, YouTube player, Tag graph, verse compare, audio / TTS, import | various | various | inspected / spot-checked only | NOT MEASURED in depth | — | Not deeply benchmarked |
| iCloud sync | electron/sync, platform/sync/hostCore | sync engine | inspected; sync was off in the benchmark copies | NOT MEASURED (no real iCloud) | — | Limitation |
| IPC / DB layer | electron/ipc/*, services | better-sqlite3 (main process) | ipc.js | all < 5 ms except search "the" 22 ms | — | OK |
| Background timers | App.tsx (2 s theme poll, 5 min update check), debouncedStorage (5 s), Liquid Glass (350 ms) | — | idle CPU | Mac 1.35% of one core; iPhone web process **1.63%** | iPhone web process **0.10%** | **Improved (iPhone)** |
| iOS launch | ios/App, src/platform/ios/main.tsx | native SQLite plugin | ioslaunch.sh + simulator log | Web view starts ~1.58 s after `simctl launch`; JS boot +78 ms; first chapter +155 ms | — | JS fine; native part is Debug-simulator bound |
| iOS navigation / scrolling | ReaderPage, NavigationStack | — | probe | chapter change 94 (max 98), space switch 48, reader scroll p95 17 ms (60 Hz), 1 frame >25 ms of 120 | — | OK |

Features with no automated performance test before this audit: everything above. Unit tests now
cover the Find batching (`chatTranscriptPerf.test.tsx`) and the idle Liquid Glass re-check
(`liquidGlass.test.tsx`).

## Issues, root causes and fixes

| ID | Pri | Area | Evidence | Root cause | Fix | Before → after |
|---|---|---|---|---|---|---|
| P1-1 | P1 | Chat Find (Mac + iPhone) | First keystroke 649 ms (600 messages) | When a query was typed, `effectiveWindow` jumped to every row (`FIND_WINDOW_MAX` 3000), rendering ~480 rich replies synchronously on the keystroke | Grow the window in **40-row transition batches from the moment Find opens**, in idle time. The current match stays the same match while rows are prepended, keyed by message and position within it. A focused message is always rendered at once | 649 → ~106 (typing immediately) / 47 median after 0.4 s; count 1.7–5 s → 0.36 s |
| P1-2 | P1 (Mac) | Style recalculation on any prepend | One row inserted above 300 rows: 125 ms of style, 2 ms of layout; at the bottom: 1 ms | Sibling selectors with a universal right-hand side. Tailwind 3 `space-y-*` / `divide-y` / `divide-<color>` → `> :not([hidden]) ~ :not([hidden])`; also `> * + *` (chat, composer, iPhone notes), `[&>*+*]` in BiblePanel, `[&+*]` in SectionAnchorChips. Chromium then restyles every following sibling's subtree | Tailwind `corePlugins` space / divideWidth / divideColor turned off and replaced by a plugin emitting `> :not(:first-child):not([hidden])`: the same children, same specificity (0,3,0). CSS files use `> :where(:not(:first-child))` (same specificity as `* + *`). BiblePanel borders use `[&>*:not(:first-child)]`; SectionAnchorChips uses negative margins instead of next-sibling rules | 120–125 → 3–4 ms (300 / 600 rows); Show Earlier 242 → 66; synthetic Chromium test 36.8 → 0.3 ms; WebKit 1 → 1 ms |
| P2-1 | P2 | Long transcripts | Open 156 ms (120 rows × ~1.2 ms) | Initial window of 120 rich rows | `WINDOW_STEP` 120 → 60 | 156 → 102 |
| P2-2 | P2 | Off-screen chat rows | layout of skipped rows | — | `content-visibility: auto; contain-intrinsic-size: auto 88px` on transcript rows | Part of the open / Show Earlier gains (applied together with P2-1; not measured separately) |
| P2-3 | P2 | Logging (Mac, production) | 150 forwarded console lines in the production startup log; verse text logged on every selection | `HIGHLIGHT_OFFSET_DEBUG = true` ("TEMP … not meant to ship"); `console-message` forwarded every level with a synchronous `writeSync` plus electron-log | Flag set to false; packaged builds forward only warnings and errors | No per-selection logging; info-level console chatter no longer reaches disk |
| P2-4 | P2 | iPhone idle CPU | Web process 1.63% idle; 0.27% with the interval slowed to 3 s | The Liquid Glass safety-net `setInterval(schedule, 350)` hit-tested 3 points every tick, forever | The tick only re-checks after any DOM change (a broad attribute observer), a scroll, or a running animation | 1.63% → 0.10% idle; the sheet-over-bar hide and return verified in the simulator |
| P3-1 | P3 | Search debounce | Results 143–155 ms, of which 120 ms was the debounce | The debounce was most of the latency; the query itself is ~25–35 ms | 120 → 60 ms (the stale-response guard `searchGenRef` already existed) | 143–155 → 85–91 ms; keystroke still 26 ms |
| P3-2 | P3 | Settings open | ~35 ms of JS per open (Radix Presence `getAnimationName`, focus) | Library work | **Not changed** (rare action, under 100 ms) | — |
| P3-3 | P3 | Startup bundle (5.1 MB) | 198 ms eval in session 1 | All window apps imported statically | Lazy-loading the 4 secondary apps (−334 KB) was **tried and reverted**: first Scripture 577 → 570, interactive 613 → 608, within noise | — |

Tried and rejected: 12-row Find batches in idle time. They were *worse* (echo median 170–180 ms,
completion ~4–5 s) until P1-2 was fixed, and 40-row batches beat them afterwards.

## Startup

| Phase (ms after launch, median of 10) | Session-1 baseline | Fixed-copy A/B, before | Final |
|---|---|---|---|
| App ready | 231 | 233 | 227 |
| Window created | 297 | 286 | 277 |
| Modules evaluated | 493 | 403 | 399 |
| First contentful paint | 648 | 511 | 503 |
| First Scripture | 678 | 577 | 570 |
| Interactive (first idle) | 735 | 613 | 607 |

The session-1 baseline was ~100 ms slower than every later run. That includes a build with the old
CSS on the fixed copy (580 / 617), so the difference is environmental and not caused by any change
here. The fixed-copy A/B is the reliable reference. Launch spends ~230 ms before the app is ready
(Electron and the main module), ~120 ms evaluating the renderer bundle, and ~170 ms from mount to
first Scripture. Nothing in it is blocked on the database (open 5 ms) or on the network.

## Memory and long sessions

- Mac physical footprint at launch (`footprint`, i.e. Activity Monitor's "Memory"): renderer 163,
  main 113, GPU 77, utility 14 + 12 MB ≈ 380 MB. RSS reads ~670 MB because it includes shared and
  reclaimable pages.
- 20 rounds of mixed workflows (tabs, chapters, find, notes, lexicon, spaces, chat panel, floating
  search): JS heap 59.2 → 60.1 MB (+45 KB per round), DOM stable at 4,502 nodes.
- Note switching: RSS grew 245 → 570 MB and then levelled off; **footprint +1–2 MB**. The growth
  was freed memory awaiting reclaim, not a leak. The note with a 330 KB embedded PNG adds +25 MB
  once (its decoded image).
- iPhone simulator footprint: app 22 MB, web content 86, GPU 16, networking 9 ≈ 133 MB.
- Idle CPU (20–30 s): Mac app 1.35% of one core; iPhone app 0.3%, web process 0.10% (after P2-4).

## Platform notes

- **Shared:** the Find batching and the smaller transcript window (ChatTranscript is shared) and the
  Tailwind / CSS change (both bundles).
- **Mac only:** the sibling-selector cost is Chromium-specific. WebKit measured 1 ms with or without
  the rules.
- **iPhone only:** the Liquid Glass idle loop (native glass exists only on iOS).
- **Simulator limits:** a 60 Hz simulator on Mac hardware; a Debug build whose code sits in a 71 MB
  `App.debug.dylib`, so ~1.1 s of pre-main loading isn't representative of a Release build on a
  phone; no Instruments session; battery not measurable.

## Not done / not verified

- Physical iPhone (forbidden for this task); Release-configuration simulator build.
- Real iCloud sync under load (sync was off in the benchmark copies so no data reached iCloud);
  offline / reconnect.
- iOS backgrounding and foregrounding, keyboard show and hide timing, Share Extension.
- Deep benchmarks of Calendar, Study Trail window, presenter / viewer, PDF viewer, YouTube player,
  Tag graph, compare view, TTS, importers. They were exercised only incidentally.
- Notes autosave timing and durability under load (inspected only).
- Lint: `npm run lint` can't run. ESLint 9 is installed without an `eslint.config.js`; this
  predates this audit.
- Residual: Find while rows are still being added (the first ~0.4 s after ⌘F) echoes in ~100 ms.
  Matching and highlighting with all rows present costs ~40 ms per keystroke.
- Observed but not investigated: repeated "ResizeObserver loop completed with undelivered
  notifications" errors in earlier dev startup logs.

## Files changed (performance work)

- `src/lib/perfMarks.ts` (new): one-time startup marks in `window.__bereanPerf`. A map write only;
  safe in production.
- `src/main.tsx`, `src/App.tsx`, `src/components/bible/ChapterView.tsx`: the marks; the store is
  also exposed in `VITE_PERF_PROBE=1` benchmark builds (never in release builds).
- `electron/main.ts`: `BEREAN_PERF_LOG` mirror of the startup breadcrumbs (unpackaged only); no
  DevTools window in benchmark runs; packaged builds forward only warning and error console lines.
- `src/components/ailookup/ChatTranscript.tsx`: window 60, batched Find growth, stable current match.
- `src/components/ailookup/chat.css`: `content-visibility` on transcript rows; selector rewrite.
- `tailwind.config.js`: `space-*` / `divide-*` with `:not(:first-child)`.
- `src/components/ailookup/chatContent.css`, `composer/composer.css`, `src/mobile/notes/notesHome.css`,
  `src/components/bible/BiblePanel.tsx`, `src/components/settings/SectionAnchorChips.tsx`: selector rewrites.
- `src/components/bible/VerseRow.tsx`: leftover diagnostic switched off.
- `src/components/shell/FloatingSearch.tsx`: 60 ms search debounce.
- `src/platform/liquidGlass/react.tsx`: idle-free safety-net re-check.
- Tests: `src/components/ailookup/__tests__/chatTranscriptPerf.test.tsx` (new),
  `src/platform/liquidGlass/__tests__/liquidGlass.test.tsx` (new case). Both are confirmed to fail
  when their fix is removed.
- `scripts/perf/`: the benchmark harnesses.

## Re-running the benchmarks

```bash
# Profile: copy berean.db with SQLite's .backup into $PERF_DIR/userdata,
# then set icloudSyncEnabled and vaultSync to false in the copy.
npx electron-vite build                     # or VITE_PERF_PROBE=1 for store-driven suites
PERF_DIR=/tmp/berean-perf node scripts/perf/launch.mjs 10        # startup (refuses if :9224 is busy)
G=$(PERF_DIR=/tmp/berean-perf node scripts/perf/keep.mjs)       # a kept instance on CDP :9224
node scripts/perf/search2.mjs; node scripts/perf/chatfind.mjs 400   # keyboard benchmarks
scripts/perf/fp.sh $G                                            # physical footprint per process
kill -9 -$G
```
