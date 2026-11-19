# Berean Native Migration — Living Task Backlog

> Initialized 2026-11-07. `TODO` does not mean the code is absent; it means the agent has not verified its current state. Keep IDs stable. Expand each into PR-sized child tasks with explicit tests.
>
> Allowed statuses: TODO, READY, IN_PROGRESS, BLOCKED, PROTOTYPE, IMPLEMENTED_UNVERIFIED, VERIFIED, MERGED, DEFERRED, NOT_APPLICABLE.

| ID | Task | Depends on | Status | Required evidence / milestone gate |
|---|---|---|---|---|
| M0-01 | Verify current Git/CI baseline and old apps | M-1 gate | VERIFIED | main `ceaaa73` CI success (2026-11-05); `npx vitest run` 390 files / 5,771 tests on the native branch (2026-11-07). Legacy Mac launch + iOS simulator not re-run this session (unchanged code). |
| M0-02 | Complete approved archive/worktree consolidation | M-1 gate | VERIFIED | Groups A + B and Berean-ai-bench removed after verified backups; PR #13 merged (`a4e3d74`); Octarine and agent branches kept (F-02 / unmerged). |
| M0-03 | Protect backups and investigate build-directory cleanup | M-1 gate | VERIFIED | Backups listed in STATUS G0; dev-builds disappearance evidence in DECISIONS F-03; mitigation ADR-0004 (`build/apple/`). |
| M1-01 | Native app targets and local Swift package | M0 gate or independently safe | IMPLEMENTED_UNVERIFIED | `apple/Berean.xcodeproj` BereanMac + BereanIOS linking `Packages/BereanKit`; Mac launch verified locally; awaiting CI `native` job. Share/Widget targets later (M8-06). |
| M1-02 | Swift CI/identity safety | M0 gate or independently safe | IN_PROGRESS | Swift 6 language mode + complete strict concurrency; CI job `native`; identity check in `scripts/native/build.sh`. iOS Simulator launch smoke done 2026-11-07. TODO: shared schemes, `swift format lint`. |
| M1-03 | Golden corpus exporter | M0 gate or independently safe | IN_PROGRESS | `scripts/golden/corpus.ts` + `npm run golden:export`; fixtures core-json, sync-hash, hlc, journal, fractional with source sha256; drift guard `tests/unit/goldenCorpus.test.ts`. TODO: parseRef, Strong's, tagged tokens, search/navigation, Markdown, SQL services, merge/conflicts. |
| M1-04 | Swift parity harness | M0 gate or independently safe | IMPLEMENTED_UNVERIFIED | `Packages/BereanKit/Tests/BereanConformanceTests` (Swift Testing) — 19 tests, all pass; mutation checks (unsorted record keys, unescaped lone low surrogate) fail 227/305 assertions as required. |
| M2-01 | Core/reference/deep link | M1 gate or independently safe | VERIFIED (macOS + iOS Simulator tests) | BereanReference: parseRef, labels, canonical forms, Strong's ids, findReferences, KJV⇄LXX chapter map — reference/strongs/crossrefs goldens 100% on macOS and iOS Simulator. Deep links: deferred to M6 (URL scheme belongs with the app shell). |
| M2-02 | Tagged text/offset DisplayMap | M1 gate or independently safe | VERIFIED (macOS + iOS Simulator tests) | BereanText: tokens, italic/red-letter ranges, stripping, offset maps, word replacer, display/study tokens — text.json + display.json every verse, macOS and iOS Simulator. |
| M2-03 | SQLite read-only bundle layer | M1 gate or independently safe | VERIFIED (macOS + iOS Simulator tests) | BereanSQLite (system SQLite, read-only): macOS 3.54.0, iOS Simulator 3.51.0, both FTS5; all search goldens exact (ADR-0008). Real-device iOS 18 SQLite check still recommended (B-15 device). GRDB prototype moves to M3-01. |
| M2-04 | Read-only services/search | M1 gate or independently safe | VERIFIED (macOS + iOS Simulator tests) | BereanBible: Bible, Lexicon (entries/related/search/pages/occurrences), Crossrefs (Classic/TSKe/Hermas) — bible/lexicon/crossrefs goldens 100% on both. Scripture-search filters (advanced search UI) come with M5-04. |
| M3-01 | Mutable SQLite and safe migration | M2 gate or independently safe | IMPLEMENTED_UNVERIFIED | BereanStore Migrator replays recorded TS migrations (ADR-0009), schema exact at v17/18/43/47/48/49; refusals + rollback tested. TODO: GRDB evaluation note, real v48 library copy test, single-instance lock. |
| M3-02 | Import verified database copies | M2 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M3; add exact tests/PR. |
| M3-03 | Legacy localStorage exporter/importer | M2 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M3; add exact tests/PR. |
| M3-04 | CRUD and change feed on synthetic store | M2 gate or independently safe | IN_PROGRESS | Sessions/tabs/archived groups (tabs.json) and notes read + basic writes (notes.json) done. TODO: note versions, highlights, settings, workspaces, verse tags, history services. |
| M3-05 | Vault/PDF file compatibility | M2 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M3; add exact tests/PR. |
| M4-01 | Legacy sync defect reconciliation | M3 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M4; add exact tests/PR. |
| M4-02 | Hash/journal/merge Swift port | M3 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M4; add exact tests/PR. |
| M4-03 | Native iCloud Dev transport | M3 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M4; add exact tests/PR. |
| M4-04 | Simulated interoperability | M3 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M4; add exact tests/PR. |
| M4-05 | Dev multi-client interoperability | M3 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M4; add exact tests/PR. |
| M5-01 | Mac Scripture TextKit view | M4 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M5; add exact tests/PR. |
| M5-02 | iPhone Scripture reader and gestures | M4 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M5; add exact tests/PR. |
| M5-03 | Lexicons/crossrefs/compare | M4 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M5; add exact tests/PR. |
| M5-04 | Unified search surfaces | M4 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M5; add exact tests/PR. |
| M6-01 | Mac app shell/navigation/windows | M5 gate or independently safe | IN_PROGRESS | ADR-0010 sidebar (session switcher, location, New Tab, unified ordered tabs, pinned, workspaces, archive) + toolbar (history, passage pill/picker), tab history, layouts, settings — UI-verified (VISUAL-UX-PARITY.md). TODO: tab multi-select, session icons, calendar + tool rail, multi-window, ⌃Tab over unified order. |
| M6-02 | Mac resizable pane system | M5 gate or independently safe | DONE (Mac) | Study inspector (resizable), Compare mode, the 16 scripture layout presets (legacy ids, per tab, HSplit/VSplit study panels), saved workspaces (state_json v2 golden-verified; save/open/rename/delete). Follow-up: iPhone workspace UI (M8). |
| M6-03 | iPhone 3-control tabs/Quick Open | M5 gate or independently safe | IN_PROGRESS | Bottom tab cards / plus / caret, tab cards sheet with sessions (simulator launch verified). TODO: verse sheet, gestures, Quick Open parity. |
| M6-04 | Themes, commands, access | M5 gate or independently safe | IN_PROGRESS | Settings window/sheet (text, size, spacing, word replacer, theme), menu commands and shortcuts. TODO: full settings sections, accessibility pass, shortcut parity table. |
| M7-01 | Markdown grammar and goldens | M6 gate or independently safe | IN_PROGRESS | DONE: note ⇄ .md file format (`noteMarkdownFile.ts` → `NoteMarkdownFile`, golden note-markdown.json), import/export UI, note version history (golden). TODO: the vault exporter's extras (images → attachments/, highlight previews, folder layout — electron/ipc/vault.ts) with M7-03 vault sync; rich editor grammar (M7-02). |
| M7-02 | Native editor research spikes | M6 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M7; add exact tests/PR. |
| M7-03 | Mac/iOS editor implementation | M6 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M7; add exact tests/PR. |
| M7-04 | Highlights/annotations parity | M6 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M7; add exact tests/PR. |
| M8-01 | PDFKit parity | M7 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M8; add exact tests/PR. |
| M8-02 | YouTube and transcripts | M7 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M8; add exact tests/PR. |
| M8-03 | Study Trail/tags/tasks/calendar/imports | M7 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M8; add exact tests/PR. |
| M8-04 | Ask Berean research | M7 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M8; add exact tests/PR. |
| M8-05 | Speech/ONNX/G2P | M7 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M8; add exact tests/PR. |
| M8-06 | Extensions and platform services | M7 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M8; add exact tests/PR. |
| M9-01 | Full parity and UI accessibility | M8 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M9; add exact tests/PR. |
| M9-02 | Performance profiling | M8 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M9; add exact tests/PR. |
| M9-03 | Security and recovery drills | M8 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M9; add exact tests/PR. |
| M9-04 | Identity and release bridge | M8 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M9; add exact tests/PR. |
| M10-01 | Mac production release planning | M9 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M10; add exact tests/PR. |
| M10-02 | iOS store release planning | M9 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M10; add exact tests/PR. |
| M10-03 | Owner-approved staged launch | M9 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M10; add exact tests/PR. |
| M10-04 | Legacy Apple retirement after stability | M9 gate or independently safe | TODO | See `EXECUTION-PLAYBOOK.md` M10; add exact tests/PR. |

## Feature parity implementation ledger
One row per ID from `03-FEATURE-INVENTORY.md` section K / playbook Appendix A (105 rows, generated 2026-11-07). Deferred/abandoned legacy features are NOT_APPLICABLE until the owner says otherwise. The sync wire primitives ported in M1 (hashes, HLC, journal, order keys) are infrastructure for S-/D- sync rows, not feature parity by themselves.

| Feature ID | Feature | Legacy status | Legacy plat | Mac status | iOS status | Native source | Tests | Original behavior | Gaps | PR |
|---|---|---|---|---|---|---|---|---|---|---|
| S01 | Text loading, bundled texts | implemented | M P | TODO | TODO | — | — | audit 03 §S (S01) | — | — |
| S02 | Book/chapter/passage navigation | implemented | M P | TODO | TODO | — | — | audit 03 §S (S02) | — | — |
| S03 | Reference parsing | implemented | M P | TODO | TODO | — | — | audit 03 §S (S03) | — | — |
| S04 | Verse rendering and annotations | implemented | M P | TODO | TODO | — | — | audit 03 §S (S04) | — | — |
| S05 | Strong's rendering and lexicon access | implemented | M P | TODO | TODO | — | — | audit 03 §S (S05) | — | — |
| S06 | Interlinear | deferred | - | NOT_APPLICABLE | NOT_APPLICABLE | — | — | audit 03 §S (S06) | — | — |
| S07 | Selection and copying | implemented | M P | TODO | TODO | — | — | audit 03 §S (S07) | — | — |
| S08 | Verse context menus and actions | implemented | M P | TODO | TODO | — | — | audit 03 §S (S08) | — | — |
| S09 | Multiple translations/editions | implemented | M P | TODO | TODO | — | — | audit 03 §S (S09) | — | — |
| S10 | Reading position and history | implemented | M P | TODO | TODO | — | — | audit 03 §S (S10) | — | — |
| S11 | Reading preferences | implemented | M P | TODO | TODO | — | — | audit 03 §S (S11) | — | — |
| S12 | Cross-references | implemented | M P | TODO | TODO | — | — | audit 03 §S (S12) | — | — |
| S13 | Parallel comparison | implemented | M P | TODO | TODO | — | — | audit 03 §S (S13) | — | — |
| S14 | Very long chapter performance | implemented | M P | TODO | TODO | — | — | audit 03 §S (S14) | — | — |
| S15 | Find in chapter | implemented | M P | TODO | TODO | — | — | audit 03 §S (S15) | — | — |
| S16 | Word replacer | implemented | M P | TODO | TODO | — | — | audit 03 §S (S16) | — | — |
| Q01 | Scripture full-text search | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q01) | — | — |
| Q02 | Reference search | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q02) | — | — |
| Q03 | Strong's search | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q03) | — | — |
| Q04 | Lexicon search | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q04) | — | — |
| Q05 | Notes search | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q05) | — | — |
| Q06 | Indexing | partial | M P | TODO | TODO | — | — | audit 03 §Q (Q06) | — | — |
| Q07 | Filtering and ranking | partial | M P | TODO | TODO | — | — | audit 03 §Q (Q07) | — | — |
| Q08 | Semantic search and embeddings | partial | M (dev) | TODO | TODO | — | — | audit 03 §Q (Q08) | — | — |
| Q09 | Floating/unified search, palette | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q09) | — | — |
| Q10 | YouTube transcript search | implemented | M P | TODO | TODO | — | — | audit 03 §Q (Q10) | — | — |
| N01 | General, verse, daily notes | implemented | M P | TODO | TODO | — | — | audit 03 §N (N01) | — | — |
| N02 | Markdown model and ProseMirror | implemented | M P | TODO | TODO | — | — | audit 03 §N (N02) | — | — |
| N03 | Inline formatting and blocks | implemented | M P | TODO | TODO | — | — | audit 03 §N (N03) | — | — |
| N04 | Tables | implemented | M P | TODO | TODO | — | — | audit 03 §N (N04) | — | — |
| N05 | Images and attachments | partial | M P | TODO | TODO | — | — | audit 03 §N (N05) | — | — |
| N06 | Links, wikilinks, Scripture refs | implemented | M P | TODO | TODO | — | — | audit 03 §N (N06) | — | — |
| N07 | Autosave | implemented | M P | TODO | TODO | — | — | audit 03 §N (N07) | — | — |
| N08 | Undo/redo and version history | implemented | M P | TODO | TODO | — | — | audit 03 §N (N08) | — | — |
| N09 | Export, import, print | implemented | M P | TODO | TODO | — | — | audit 03 §N (N09) | — | — |
| N10 | Vault integration | implemented | M | TODO | TODO | — | — | audit 03 §N (N10) | — | — |
| N11 | Folders, trash, pin, status, views | implemented | M P | TODO | TODO | — | — | audit 03 §N (N11) | — | — |
| N12 | Daily notes, calendar, sunrise | implemented | M P | TODO | TODO | — | — | audit 03 §N (N12) | — | — |
| N13 | Idiom/reference-book editor | implemented | M P | TODO | TODO | — | — | audit 03 §N (N13) | — | — |
| N14 | BibleGateway importer | implemented | M | TODO | TODO | — | — | audit 03 §N (N14) | — | — |
| N15 | e-Sword importer | implemented | M | TODO | TODO | — | — | audit 03 §N (N15) | — | — |
| H01 | Highlight storage | implemented | M P | TODO | TODO | — | — | audit 03 §H (H01) | — | — |
| H02 | Verse/word/selection highlights, anchoring | implemented | M P | TODO | TODO | — | — | audit 03 §H (H02) | — | — |
| H03 | Colours and categories | partial | M P | TODO | TODO | — | — | audit 03 §H (H03) | — | — |
| H04 | Note/tag indicators | implemented | M P | TODO | TODO | — | — | audit 03 §H (H04) | — | — |
| H05 | Cross-translation highlights | deferred | - | NOT_APPLICABLE | NOT_APPLICABLE | — | — | audit 03 §H (H05) | — | — |
| H06 | Highlight sync | implemented | M P | TODO | TODO | — | — | audit 03 §H (H06) | — | — |
| U01 | Spaces | implemented | M P | TODO | TODO | — | — | audit 03 §U (U01) | — | — |
| U02 | Vertical tabs, sessions, archive | implemented | M P | TODO | TODO | — | — | audit 03 §U (U02) | — | — |
| U03 | Pinned tabs | partial | M P | TODO | TODO | — | — | audit 03 §U (U03) | — | — |
| U04 | Tab/session persistence | implemented | M P | TODO | TODO | — | — | audit 03 §U (U04) | — | — |
| U05 | Workspaces and layouts | implemented | M P | TODO | TODO | — | — | audit 03 §U (U05) | — | — |
| U06 | Resizable panels, drag and drop | implemented | M | TODO | TODO | — | — | audit 03 §U (U06) | — | — |
| U07 | Multi-window, floating, presenter/viewer | implemented | M | TODO | TODO | — | — | audit 03 §U (U07) | — | — |
| U08 | Navigation state and stacks | implemented | M P | TODO | TODO | — | — | audit 03 §U (U08) | — | — |
| U09 | Menus, context actions, commands | implemented | M P | TODO | TODO | — | — | audit 03 §U (U09) | — | — |
| U10 | Keyboard shortcuts | partial | M | TODO | TODO | — | — | audit 03 §U (U10) | — | — |
| U11 | Themes and appearance | implemented | M P | TODO | TODO | — | — | audit 03 §U (U11) | — | — |
| U12 | Settings | implemented | M P | TODO | TODO | — | — | audit 03 §U (U12) | — | — |
| U13 | Onboarding and hints | partial | M P | TODO | TODO | — | — | audit 03 §U (U13) | — | — |
| U14 | Study Trail | implemented | M P | TODO | TODO | — | — | audit 03 §U (U14) | — | — |
| U15 | Tasks panel | implemented | M | TODO | TODO | — | — | audit 03 §U (U15) | — | — |
| U16 | Tags and tag graph | implemented | M P | TODO | TODO | — | — | audit 03 §U (U16) | — | — |
| U17 | PDFs | partial | M P | TODO | TODO | — | — | audit 03 §U (U17) | — | — |
| U18 | Berean Chat | implemented | M P | TODO | TODO | — | — | audit 03 §U (U18) | — | — |
| M01 | YouTube browsing and playback | implemented | M P | TODO | TODO | — | — | audit 03 §M (M01) | — | — |
| M02 | Picture-in-Picture | partial | M P | TODO | TODO | — | — | audit 03 §M (M02) | — | — |
| M03 | Video-linked notes, timestamps | implemented | M P | TODO | TODO | — | — | audit 03 §M (M03) | — | — |
| M04 | Transcripts (dev-fetch, packs) | implemented | M P | TODO | TODO | — | — | audit 03 §M (M04) | — | — |
| M05 | Read Aloud engine (Kokoro) | implemented | M P | TODO | TODO | — | — | audit 03 §M (M05) | — | — |
| M06 | Audio playback, queue, background | implemented | M P | TODO | TODO | — | — | audit 03 §M (M06) | — | — |
| M07 | Word-follow highlighting | implemented | M P | TODO | TODO | — | — | audit 03 §M (M07) | — | — |
| M08 | Voice downloads and caching | implemented | M P | TODO | TODO | — | — | audit 03 §M (M08) | — | — |
| M09 | Sleep timer (iPhone) | undocumented | P | TODO | TODO | — | — | audit 03 §M (M09) | — | — |
| G01 | Ask: references/Strong's model-free | implemented | M P | TODO | TODO | — | — | audit 03 §G (G01) | — | — |
| G02 | Local model runtime, picker, downloads | partial | M | TODO | TODO | — | — | audit 03 §G (G02) | — | — |
| G03 | Modes, prose stripping, premise check | partial | M | TODO | TODO | — | — | audit 03 §G (G03) | — | — |
| G04 | Deep Search, escalation, cancel | partial | M | TODO | TODO | — | — | audit 03 §G (G04) | — | — |
| G05 | Collections, profiles, saved contexts | implemented | M P | TODO | TODO | — | — | audit 03 §G (G05) | — | — |
| G06 | Verse-note influence, exclusion | partial | M | TODO | TODO | — | — | audit 03 §G (G06) | — | — |
| G07 | Cloud model (BYO key) | partial | M | TODO | TODO | — | — | audit 03 §G (G07) | — | — |
| G08 | Online research | partial | M P | TODO | TODO | — | — | audit 03 §G (G08) | — | — |
| G09 | Evaluation harness | implemented | M (dev) | TODO | TODO | — | — | audit 03 §G (G09) | — | — |
| G10 | iPhone Ask Berean (model-free) | partial | P | TODO | TODO | — | — | audit 03 §G (G10) | — | — |
| A01 | iCloud sync journal | implemented | M P | TODO | TODO | — | — | audit 03 §A (A01) | — | — |
| A02 | Keychain / secure storage | partial | M | TODO | TODO | — | — | audit 03 §A (A02) | — | — |
| A03 | App Groups, Share Extension | implemented | P | TODO | TODO | — | — | audit 03 §A (A03) | — | — |
| A04 | Spotlight | implemented | P | TODO | TODO | — | — | audit 03 §A (A04) | — | — |
| A05 | App Intents / Siri | implemented | P | TODO | TODO | — | — | audit 03 §A (A05) | — | — |
| A06 | Deep links / URL schemes | implemented | M P | TODO | TODO | — | — | audit 03 §A (A06) | — | — |
| A07 | Widget | implemented | P | TODO | TODO | — | — | audit 03 §A (A07) | — | — |
| A08 | File access / providers | partial | M P | TODO | TODO | — | — | audit 03 §A (A08) | — | — |
| A09 | Notifications | deferred | - | NOT_APPLICABLE | NOT_APPLICABLE | — | — | audit 03 §A (A09) | — | — |
| A10 | App lifecycle and updates | implemented | M P | TODO | TODO | — | — | audit 03 §A (A10) | — | — |
| A11 | Entitlements, sandbox, identity | implemented | M P | TODO | TODO | — | — | audit 03 §A (A11) | — | — |
| A12 | App Store requirements | partial | M P | TODO | TODO | — | — | audit 03 §A (A12) | — | — |
| A13 | Share/print to Files (iPhone) | implemented | P | TODO | TODO | — | — | audit 03 §A (A13) | — | — |
| A14 | Accessibility | partial | P | TODO | TODO | — | — | audit 03 §A (A14) | — | — |
| A15 | Auto-update and distribution (Mac) | implemented | M | TODO | TODO | — | — | audit 03 §A (A15) | — | — |
| O02 | Crash report on next launch | implemented | M P | TODO | TODO | — | — | audit 03 §O (O02) | — | — |
| O03 | Hermas/Recognitions special handling | implemented | M P | TODO | TODO | — | — | audit 03 §O (O03) | — | — |
| O04 | Data publication pipeline | implemented | dev | TODO | TODO | — | — | audit 03 §O (O04) | — | — |
| O05 | Diagnostics and performance tooling | implemented | M P | TODO | TODO | — | — | audit 03 §O (O05) | — | — |
| X-PiPstub | `PiPController.tsx` dead stub | abandoned | M | NOT_APPLICABLE | NOT_APPLICABLE | — | — | audit 03 (X-PiPstub) | — | — |
| X-dl | `electron/downloads/modelDownloader.ts` (tested, unused in production) | abandoned | M | NOT_APPLICABLE | NOT_APPLICABLE | — | — | audit 03 (X-dl) | — | — |

## Current agent assignment
- Active task: M1 first slice (PR from `native/m0-execution-records`)
- Next ready: M1-02 remainder, M1-03 reference goldens, M2-01 BereanReference
- Gate: G1 (native Mac+iOS compile/launch in dev identity, golden pipeline repeatable, no production write surfaces)
- Blocking decision: none for M1–M3

## Owner UI batch 2026-11-08 (explicit tasks)
| ID | Task | Status | Evidence / next |
|---|---|---|---|
| UI-01 | Share caret removed | DONE | menuIndicator(.hidden) |
| UI-02 | Modern Scripture typography (system font, setting) | DONE | screenshot, CHANGELOG 13:30 |
| UI-03 | Verse numbers / Strong's visibly clickable | DONE (Mac) | hover underline + pointer + click verified; iPhone rows TODO |
| UI-04 | Back/Forward beside sidebar button, visible when collapsed | DONE | verified |
| UI-05 | Window drag from empty sidebar | DONE | verified (position changed) |
| UI-06 | No "Sessions" wording; unified Workspaces | DONE (Mac) | ADR-0011; iPhone in UI-14 |
| UI-07 | Yab-style rows + active highlight | DONE (first pass) | ADR-0012; pinned grid, density, edge reveal TODO |
| UI-08 | Smooth drag reordering | DONE (live reorder) | auto-scroll near edges and drop line TODO |
| UI-09 | Passage navigator: history, internal back, all-text search, texts column | DONE | Enoch search → 1 Enoch 6 verified |
| UI-10 | Consolidated texts (one KJV, one LXX) + lxx→Brenton mapping fix | DONE | CHANGELOG 13:30 |
| UI-11 | Continuous cross-verse selection + copy formats | DONE (Mac) | Lev 8:2-4 copy verified; iPhone TODO |
| UI-12 | Rich-text note editor (no visible Markdown), Copy as Plain Text | DONE (live preview, ADR-0014) | Mac verified; iPhone builds (not yet tapped); table grid / image preview / columns chrome TODO (M7-02) |
| UI-13 | Physical iPhone workflow | DONE | npm run native:ios:device; installed + launched on iPhone 16e |
| UI-14 | iPhone navigation simplification + Plus fix + Workspaces wording | DONE (first pass) | ADR-0013; real-tap verified in Simulator |
| UI-15 | Storage unification of sessions/workspaces | DEFERRED | until legacy clients retire (ADR-0011) |

## 2026-11-12 follow-up queue

| Task | Scope | Evidence / acceptance |
|---|---|---|
| SHARED-UX-020 — tame tabs and unnamed workspaces | Mac and iPhone | Implemented name and contained-tab search, passage previews, eligible destination reuse, and reversible archive. iPhone search is visible in Tabs, Workspaces and Archived Tabs. Both Move to Workspace menus show passage previews. Next: test duplicate names and larger lists on both platforms, then add duplicate review. Preserve pinned tabs, explicit New Tab, existing IDs and persisted state semantics. |
| IOS-FUNC-002 verification | iPhone | Drag selection handles across verses, inspect copied text/reference, create/reopen a partial highlight and verify swipe arbitration. |
| U14 Study Trail | shared service, then Mac/iPhone UI | Port the legacy service with deterministic golden fixtures first. |
| SHARED-FUNC-017 | Mac and iPhone | Port legacy sunrise calculation and fallback semantics before connecting any location provider. |
| SHARED-FUNC-014 / M4 | both | Remaining Settings sections, then sync through OD-5 gates. |

See [Native implementation backlog](IMPLEMENTATION-BACKLOG.md) for source references and acceptance scenarios across the legacy Electron and Capacitor apps.

### 2026-11-17 interaction follow-up queue

- Cmd+L mixed-type identity/history fix implemented and runtime checked; extend to explicit Notes Search, Lexicon Search, utility/daily destinations and deep result/reader scroll positions.
- Native note-title [[ completion implemented. Next isolate Mac following-typing undo, verify software keyboard/IME/VoiceOver and chooser scroll behavior, then add Scripture/book suggestions from original autocomplete.
- Investigate exact multiword note-title search with numeric suffixes (Gallery matches; Gallery QA 07 did not in palette QA). Do not change persistence or FTS schema without evidence.

### 2026-11-17 verified follow-up results

- Completed live same-type Lexicon and Notes query replacement/history; utility Calendar/History/Tags kept current identity. Exact deep-scroll and daily destination matrix remain.
- Completed explicit Mac note-completion Undo/Redo separation, superseding the previous following-typing coalescing item for the tested path.
- Both native builds pass; optimized simulator conformance passes all 156 tests/46 suites, and five legacy chat regression tests pass. Fixed the two diagnosed prior CI failures; inspect the next pushed run before claiming remote green.
- Numeric full-title palette lookup remains reproducible; direct read-only NotesService and raw FTS return the expected note. Temporary trace removed because CUA cannot currently disambiguate two running Dev app instances with the same bundle ID. Keep regular Dev untouched.

### 2026-11-17 Lexicon result follow-up queue

- Verify deep Back/Forward and cross-tab offset isolation, then explicit query/language changes seeded at the top. Check current Mac full-row activation and hover when the isolated QA instance can be targeted, then cover VoiceOver and physical iPhone.
- Run the full updated optimized simulator suite and confirm GitHub native CI on `91a5c259`. See [HANDOFF](HANDOFF.md) for the CI run and local evidence.

- Notes completion preview: simulator passage/excerpt/insertion/Undo passed; verify Mac keyboard/hover target changes, empty/deleted notes, short editor heights, software keyboard and VoiceOver. Next original autocomplete slice is plain verse/Strong’s block insertion, separate from [[ notes.

### 2026-11-17 note block suggestion follow-up

- Verify each Notes toggle dismisses current and queued work, and exercise rapid caret/note switching with pending lookups. Cover Mac insertion and Undo when isolated targeting is available, then iPhone software keyboard and VoiceOver.
- Continue cross-chapter block support and rerun optimized simulator conformance against the new head. See [HANDOFF](HANDOFF.md) for the tested paths and prior CI run.

### 2026-11-18 owner UX queue

- Identify top-right double-chevron control and make its purpose clear or remove redundant chrome.
- Pinned tab hover: clickable unpin icon beside Close, with stable title space.
- Notes formatting: pleasant shortcut presentation and faster common formatting access.
- Empty folder: center icon, No Notes message and creation action in both axes.
- Daily Notes folder: calendar-oriented discovery and date-aware creation; Verse Notes folder: create an attached verse note directly.
- Folders with children: collapsed by default at every nesting level, independently expandable.
- Audit pointing cursors over noninteractive Notes backgrounds and across other screens. Review home section order; retain Recently Edited at bottom only if it remains sensible.
- Compare: simplify per-column ellipses and verse numbering, reject unavailable LXX/New Testament comparisons, audit the overall native presentation.
- Scripture native character selection: show only actual verse glyphs, excluding gutter/numbers and line-leading/trailing blank space; repair partial-highlight appearance from owner screenshot.
- Tune top/bottom chapter gestures for sensitivity, feedback and interrupted transitions.
- Continue original-quality Kokoro/Berean Voices Read Aloud; Apple voices remain explicitly rejected.
- Make tab switch chrome and saved viewport feel immediate; audit delayed toolbar changes and restoration rather than masking them with animation.

### M05 resume — 2026-11-18
- Completed foundation only: KokoroChunks neural latency/alignment policy,48original-oracle cases and native conformance. Full177sharedtests and both app builds pass. M05 remainsTODO overall.
- Next: original buildSpokenWords/textPrep parity including WordReplacer+Strong’s/the suppression and spoken-only pronunciation/number/abbreviation handling; then voice/model/cache contracts, native inference and streamed audio/word alignment/cancel/skip/settings. No Apple voices. Do not present chunk planning as audible ReadAloud.

M05 continuation18Nov: speech preparation/SpokenText service completed with original oracle conformance (179sharedtests/104originalTTS tests, both apps build). Remaining engine can reuse legacy BereanVoicePackPlugin’s native ONNX inference core; first establish original-compatible phonemization/tokenization/style vectors and fp32 asset manifest/download, then audio streaming/word timing/cancel/skip/UI. Do not mark playback complete. See HANDOFF for exact files/results.

### Reader persistence / responsiveness — evidence18Nov
P1: detailed Scripture viewport map is memory-only. Add bounded per-edition local tab viewport records, validation, settled-scroll/lifecycle capture and explicit-jump invalidation; extend native/TS local allowlists and test sync isolation/legacy preservation. Test both apps: tab/workspace switch, long chapters, KJV/LXX flips, background/relaunch, changed width/font/selection and history. Existing numerical scrollPosition is local but unused natively. Keep production stores/sync/IDs protected.
Mac tooltip-induced full reader rebuild removed; native-helper regression/build pass, live arrival/deep-scroll/selection and measured tab latency still open. iPhone direct-pan release implemented; bottom automation often reports zero actual input, so physical sensitivity and cue timing remain acceptance work.

### 2026-11-18 — Viewport checkpoint follow-through
- [x] Persist bounded validated native Scripture reading geometry in local-only tab state on both platforms; preserve original sync and numeric scrollPosition.
- [x] Check actual Mac/iPhone simulator relaunch at deep viewport and Mac switch-away/back.
- [ ] Broaden explicit jump/selection/end/width/font/LXX return matrix across relaunch; other tab-type viewport persistence and measured toolbar latency remain open.
- [ ] Continue Kokoro native phoneme resource compilation and original fp32 inference/playback; no native audio claimed.


M05 phonemizer checkpoint18Nov: official pinned resources compile; native raw IPA32cases per platform match original on Mac/iPhone simulator. Opt-in scripts/native/phonemizer-probe preserves reproduction. Still need resource/license integration decision, kokoro-js normalization/token IDs, original fp32 inference/style, streaming/cancel and listening; do not mark playback complete.

### 2026-11-18 — Note discovery query lifecycle
- [x] Reproduce and fix Mac palette full-title missing hits with current-query rendering fallback; rapid replacement/no-match/Return checked.
- [x] Apply same current-query fallback to iPhone Go; full-title replacement/tap-to-open checked.
- [ ] Broader IME/paste/metadata-change and CmdL note discovery matrix; note-title wrapping and measured reader/chrome latency remain.


18Nov: wrapping note titles implemented; iPhone full title and both-platform Return-to-body verified, Mac multiline paste normalized without changing title. Software keyboard/DynamicType/IME/Undo matrix remains.


18Nov M05: native KokoroEnglish90normalization/segments+22IPA oracle cases implemented; expanded52raw+52complete native comparisons pass each platform. Original data+trace API required; compiled-resources alternative remains incompatible. Next tokenizer/ONNX/streaming/integrity/licensing/listening. OWNER priority next: smooth reader scroll, immediate chapter display, top-pull feel and bottom pull on short chapters.

### 2026-11-18 — Reader gesture checkpoint
iPhone short-page pulls now use passive raw touch travel; deliberate chapter turns have explicit start/end arrival. Mac scroll checkpoints reuse one idle timer; short pages allow elasticity. Both builds and intent checks pass; simulator boundary cycle and Mac checkpoint/relaunch verified. Loading flash and physical gesture feel remain open. See HANDOFF latest checkpoint for evidence and continuation.

### 2026-11-18 — Prepared chapter-turn checkpoint
Added16chapter read-only preparation cache, shared in-flight loads, actual-neighbor prefetch, outgoing viewport capture and atomic destination rows/annotations/selection for explicit turns. Both native builds pass; Mac history/selection and iPhone short-page cycle checked. Removed iPhone empty system glass circle when chrome tucks. Other navigation paths can still show loading; global frame pacing remains open. See latest HANDOFF for scope, exact evidence and queued CI status.

### 2026-11-18 — Direct warm Scripture presentation
Cached chapters and revision-scoped annotations now render directly for warm navigation; location-scoped selection/scroll targets prevent stale state. Native view reuse captures outgoing viewport;16entry cache protects visible chapter and coalesced waiters publish before returning. Both final native builds pass; Mac34step boundary/history test, local selection/highlight refresh, phone mapped Psalm return and tab restoration checked. Cold misses/frame pacing remain open. Prior-head CI cancelled before runner assignment due hosted macOS capacity; see HANDOFF for exact evidence and next work.

### 2026-11-18 — Working tabs first on iPhone
Tab overview now opens expanded and shows current tabs before creation/cleanup/archive controls and recent duplicates. Existing actions and optional compact detent remain. Simulator existing119→G5463→119 navigation preserves viewport; nine tabs unchanged. Final iOS build passes. See HANDOFF for exact evidence, remaining large-workspace/accessibility checks and hosted CI capacity cancellation.

### 2026-11-18 — Passage preview prepares the reader
Shared previews now reuse a bounded prepared chapter with separately retained raw rows, warming both Mac palette/CmdL and iPhoneGo destinations without changing excerpts or navigation semantics. Both builds and raw LXXPsalm 3 heading→bodyverse2 UI checks pass; current-tab reuse leaves13MacQA/9phone tabs unchanged. Fast submit before preview is ready can still be cold. See HANDOFF for oracle/evidence and remaining selection/performance work.


### 2026-11-18 — Reader selection gesture checkpoint
Reader selection: VERIFIED targeted simulator rapid adjacent body taps, rapid number taps, single number toggle, native word-mode handoff and Strong's link/scroll. TODO physical phone/VoiceOver/accessibility-size timing, broader word-action matrix, frame-pacing measurement and cold fast-submit. Next annotation-domain revision reuse must retain live Notes/tag/highlight invalidation. See HANDOFF for exact builds and fixtures.


### 2026-11-18 — Reader release and sidebar restoration
VERIFIED targeted: independent Notes/tag/highlight live invalidation on Mac; final clean iPhone117→116END→117START→118START pull cycle; Mac sidebar placement, hide/show and Back/Forward selection restoration. IMPLEMENTED_UNVERIFIED: pin slide on physical hover (idle trailing position verified). TODO physical pull/selection timing, narrow toolbar/hover, cold fast-submit and frame pacing. M05 Kokoro and broader parity backlog remain active.

### 2026-11-18 next verification queue
- Verify latest body-first Psalm numbering in both builds and actual Mac/iPhone: title+body1, next2, Psalm 50 two-title collapse, typed references/ranges, copy/action label, flip, Compare alignment; ensure raw IDs/old links stay stable. Supersedes numbered-title task.
- Finish LXXbadge hover-motion check (idle-right verified); retained pin behavior.
- Physical slow Mac pulls/FPS audit remains open; no universal choppiness fix claimed.
- Implement per-edition Compare selection + whole-block lifted drag, then generic pane architecture per TAB-SPLIT-DESIGN.md.
- Implement scoped native cursor ownership per CURSOR-AUDIT-2026-11-18.md; global overrides still present.

Body-first reader/picker/action-label/Compare mapping implementation now verified:192Swift tests, both apps build, actualMacPS3/PS50+Compare/flip and iPhonePS3selection. Ancillary export/study-label additions compile on both. Remaining: new notes/Markdown link-numbering vs legacy-link identity audit; intermittent CmdL prefilling/select-all focus race; iPhone first body-tap and multi-selection walkthrough. Physical Mac trackpad, cursor replacement, arbitrary tabsplit and Compareselection/drag remain queued.


## 2026-11-18 — location input, native cursor ownership and iPhone verse taps

- Mac ⌘L now owns keyboard focus before its field mounts, preserves early keys/paste, selects the current destination once, and replaces the current tab across Scripture, Search, Lexicon and Notes. QA verified the original tab identity, 13-tab count and unchanged note content/update time. Explicit Shift-Return creates a tab; closing it currently selects its neighbor, not necessarily its origin.
- Removed global cursor swizzles/private toolbar hooks and forced hands. Native controls, text, links and dividers own their cursors. Source audit and builds passed; physical pointer-motion/flicker coverage remains open.
- iPhone body taps use a passive touch observer: rapid verse1/2/5 accumulation, targeted deselection, native word double-tap, 400ms taps, 900ms long-press, scroll cancellation, chapter pull and inline Strong’s were exercised in the Simulator. The new pure reader-taps harness joins CI. Physical iPhone/VoiceOver and handle dragging remain unverified.
- Added a 44pt accessible Close Study Panel control; final fresh-launch Simulator check dismissed the G2962 inspector. Restored Psalm 3 LXX, Strong’s OFF, no verse selection, 9 tabs. Both final local builds PASS: `/tmp/berean-study-close-final-mac.log` and `/tmp/berean-study-close-final-ios.log`.
- Online rendering verified again: [Brenton Psalm 3](https://biblehub.com/sep/psalms/3.htm) combines the title and first body line as verse1. [Brenton Psalm51 / LXX50](https://biblehub.com/sep/psalms/51.htm) does the same for its longer title. Preserve Septuagint chapter numbering and raw stored IDs; display/copy/accessibility numbering follows the reader. Do not reinterpret persisted links or rewrite production data.
- Next: per-edition Compare selection and whole-block dragging; generic all-tab split previews; physical cursor motion and Mac scroll/pull feel; note reference formatting/preferences; M05 Kokoro playback. These remain unfinished. Owner-only merge order #22 → #23 → draft #24 remains unchanged.


## 2026-11-18 — corpus-wide Brenton rendering and combined verse compatibility

The actual 151-Psalm corpus check found that stored LXX 115:4 contains both the cup and vows sentences, with no stored verse 5. The reader now labels that record 4–5, preserves all its words/annotation identity, resolves human-entered verse 5 to stored4, and maps KJV 116:14 to that existing record in Compare/flip. Verse6 and following keep their numbers. Labels, selected references, chapter export, partial copy and accessibility use the range. Raw persisted links, tag spans and note/highlight keys are not rewritten.

Online witnesses: [Bible Hub Psalm 3](https://biblehub.com/sep/psalms/3.htm) and [MT51/LXX50](https://biblehub.com/sep/psalms/51.htm) combine superscription and first body as verse1. [eBible Brenton115](https://ebible.org/eng-Brenton/PSA115.htm) calls the second sentence4a; [Bible Hub MT116](https://biblehub.com/sep/psalms/116.htm) separates the two sentences at13–14. Reader 4–5 is the numeric presentation of that combined record, consistent with the chosen body-first convention, rather than a claim that every online edition uses identical labels. Keep actual LXX chapter numbering; do not substitute a site's MT chapter headings.

Verification: all 195 shared tests/57 suites PASS in139.323 s from a temporary native-build source snapshot; all 120 package source/test/fixture SHA256 values were checked against the repository with zero mismatches. Log `/tmp/berean-online-brenton-final-suite.log`; manifest `/tmp/berean-online-psalter-source/source-sha256.json`. Initial corpus test correctly failed on115's gap and motivated the range fix. Direct checkout test attempts were interrupted only after diagnosing cloud-backed Git/build database waits; no caches or usage were reset.

First range builds BOTH PASS: `/tmp/berean-brenton-range-final-{mac,ios}.log`. Fresh iPhone PID32126 verified Go 115:5→115:4–5, readable gutter label, both sentences selected, verse 6 unchanged and9 tabs. Selecting6 then exposed separate outlines at the missing stored5. Final source fixes drawing/reveal grouping by actual row order while still breaking at unselected rows or real rows without layout; persistence stays unchanged. Reader tap + adjacency harness PASS with immutable inputs `/tmp/berean-final-range-selection-checks` (explicit temporary module-cache path after a sandbox cache-write failure). Final grouping builds and Mac/iPhone UI checks subsequently PASS; see verified publication checkpoint below. Reference labels also coalesce adjacent displayed ranges without changing saved raw groups.

The single4–6 outline, copy/reference labels and fixture restoration are now verified on both apps. Publish only the tested source and its checkpoint. Audit combined-record cross-reference aggregation and newly generated Markdown/link display vs raw IDs; original legacy links must keep their meaning. Generic all-tab split previews, per-edition Compare selection/whole-block drag, physical pointer/flicker, Mac scroll/pull feel and M05 playback remain open.


### Verified publication checkpoint — source `8492a161`

Both final grouping builds PASS (`/tmp/berean-brenton-group-final-mac.log`, `/tmp/berean-brenton-group-final-ios.log`). iPhone fresh PID33697 showed one outline around 4–5 + 6, correct targeted deselect/reselect and native Copy→Paste containing `Psalms 115:4-6 LXX`, range label4–5 and verse 6, without extra text/rows. Restored Psalm 3 LXX, no selection, Strong’s OFF, inspector closed,9 tabs. Mac fresh QA launch verified ⌘L115:5→115:4–5, Shift-click 6→one4–6 outline, Copy Reference→immediate ⌘L paste exactly `Psalms 115:4-6 LXX`, then restored Psalm 50:1 LXX (raw 3),13 tabs. Readonly DB confirms original tabID0456641d-da15-49d2-8620-cdf2b9d1f0bd/typeBible retained and GalleryQA07 content SHA256 AND updated_at unchanged.

Full 195 shared tests/57 suites passed; after adding corpus-version coherence assertions, the 3 focused tests passed again (`/tmp/berean-brenton-corpus-coherence-final.log`). All120 package snapshot hashes matched repo. Tap + visual-adjacency harness passed. No application code changed after final builds/UI checks. Physical iPhone/VoiceOver, physical cursor-motion/flicker, full Mac scrolling performance and combined-record cross-reference aggregation remain open.

Commits: faf8589d location focus/input;3c38eb5c native cursor ownership;819f9954 iPhone body taps/CI;59bbd436 accessible inspector close;8492a161 combined Brenton records/visual adjacency. The next docs commit records this checkpoint. Publish the complete checkpoint to **github**/native/reader-notes, existing draft24; compare remote head with local HEAD and read CI for that exact PR head. Prior74aeb6c5/CI44391471644 is historical evidence only. PR22/23/24 were rechecked OPEN,24draft/base native/m6-navigation; owner-only merge order unchanged. Do not merge or inherit old green checks.


## 2026-11-19 — reader presentation follow-up

- **READER-PSALM-PRESENTATION — VERIFIED (standard Mac / Simulator):** one verse number precedes superscription + body; title indentation, grouped1–2 selection and iPhone title tap work; native word handles retained. Font/number-hidden/Dynamic Type/VoiceOver variants remain TODO.
- **READER-NUMBERING-METADATA — VERIFIED (standard Mac / Simulator):** quiet secondary chapter correspondence + on-demand popover; native additions cover Joel2 and Jonah1–2, existing structural explanations retained. Shared metadata tests and11 independently sourced online boundary witnesses pass alongside all151-Psalm preservation checks. Source739c5e41; ONLINE-BRENTON.md and HANDOFF hold evidence.
- **READER-CROSSREF-IDENTITIES — READY:** runtime LXX Psalm50 whole-chapter TSKe shows three groups labeledVerse1 because raw KJV source numbers pass through LXX display conversion. Add reader-only service entry points mapping visible stored LXX rows to canonical sources, including joins/splits and combined115:4→KJV116:13–14; merge duplicates, preserve headings/order and legacy conformance APIs. Verify selected/chapter scopes, Classic/TSKe, actual labels/destinations, no false exact mapping for structurally unmatched texts. Do not rewrite golden fixtures or persisted IDs.
- Compare per-column selection/whole-block drag is still READY; only inspected this round. Generic tab splits remain design-only with no implementation gates passed.


## 2026-11-19 — native references, toolbar responsiveness and Strong’s continuity

- 42d34bbe: additive native cross-reference APIs map verified stored LXX rows to canonical sources; correct chapter grouping and combined-record aggregation. Legacy service entry points/goldens remain intact. Classic/TSKe selected and chapter UI checked on both apps; structural unverified alignments remain open.
- fce2b88e: native navigation ControlGroup replaces fixed-size HStack; measured Mac toolbar CPU loop resolved while retaining sidebar titlebar placement. Baseline99.5% CPU/AX20–40s → idle0–3.3%/AX0.1–0.4s. This supersedes prior automation-latency diagnosis; broader physical interaction checks remain.
- 3bbecdea: native readers retain the visible body line when Strong’s toggles, preferring a visible selected verse and excluding inline metadata from anchor offsets. Mac selected/unselected and iPhone mid-chapter on/off verified; physical phone and full edge/width matrix pending.
- Validation: full202 shared tests; final6 focused cross-reference checks include all151 Psalms source bounds. Fresh reader intent/reflow harness passes Unicode/metadata mapping and prior tap/adjacency checks. Both final native builds pass. See current HANDOFF for exact logs, QA restoration and remaining tasks; source corpus/production/sync/identities unchanged.


## 2026-11-19 — Compare selection and floating actions (d6f7cced)

Each edition now owns its selectable verse numbers and action target. Additive taps/Mac Shift use actual stored row order; selection itself does not change the anchor passage or history. Adjacent visible selected rows share one faint/dashed outline; stacked interleaved editions remain outside each other’s outlines. Reduced Motion pauses animation. The adaptive glass action bar reuses reader control styling and supports copy/highlight/tag/note/reference/reader/share/clear operations. iPhone dock safe-area clearance was verified after an initial hidden-bar failure. Mac Command-C was verified after fixing a focus-routing failure. Clearing and exiting Compare does not restore an old selection. Shared title rendering uses the Scripture font and folds source title newlines.

Both local Dev builds and the expanded native reader harness pass. Mac LXX50/KJV51 copy and action destinations, Mac Shift group/Escape, and iPhone stacked selection/copy feedback/reader transfer/final dock gap/clear-exit passed. See HANDOFF for exact logs and QA restoration. No note contents/timestamps changed;4 Mac/9 iPhone tabs preserved. Prior baselinecce95bf0 CI44493859591 is green, including203 shared tests; this is not evidence for the new source’s pending CI.

Remaining before full Compare parity: view-state retention across tabs/relaunch, independent/pinned/cross-chapter/duplicate/4-column/width/accessibility matrix, actual mutation-and-undo action checks, native word-copy precedence, body-tap selection, selected-line reveal, and whole-block drag previews/grab-anywhere. Generic arbitrary-tab splitting and Kokoro playback remain separate open work.


## 2026-11-19 — Compare tab return and explicit location intent (3090db5c)

A bounded local snapshot per open tab now restores the selected Compare column/edition/chapter, selected stored rows, focus and original Shift anchor across tab switches. Close/explicit Compare arrival clear the cache. It is observation-ignored memory, with no new persisted/synced fields; restart retention remains open. Incoming explicit references override old local selection, including same-chapter and repeated identical commands. A fresh jump revision also restores the requested scroll position. Ordinary Go deduplication still uses the original one-argument isShown match, which excludes Compare.

Final Mac/iOS builds pass (`/tmp/berean-compare-intent-complete-{mac,ios}.log`), and expanded native harness passes retained-anchor and unavailable-row cases. Mac UI verified LXXGenesis12 → Notes → return retaining selection; new/repeated Go to KJVGenesis11 replaces it, and repeat Go moves from near-end offset back to verse11. iPhone verified KJVPsalm3v1 → existing G5463 → return retaining that edition/selection.4 Mac/9 iPhone tabs preserved; original QA passages restored and all7 Mac QA note contents/timestamps unchanged. Earlier repeated-command failure and intermediate method-reference compile errors were corrected, not counted as passes. Full independent/pinned/history/restart/4-column/accessibility coverage, native word-copy precedence and whole-block dragging remain open.


## 2026-11-19 — Compare passage lift follow-up (7d365304)

Native Mac drag sources now cover headers, verse-cell whitespace and independent panes, with a readable glass passage preview, faded source and destination wash. Reorder remaps edition selection/scroll caches without changing legacy column records. Aligned two-edition reorder in both directions, exact mid-chapter scroll retention, Escape cancellation and native word-copy precedence passed. Both local native builds pass. Preview is a reconstructed visible excerpt; system-owned ghost pixels and physical feel were not captured. Pinned independent attempts did not demonstrate a successful drop; keep that matrix,4-column/duplicate/narrow/accessibility and selection removal/action writes open. CUA requires a final destination click to complete the native drop in this environment; do not misdiagnose its pending session as a stuck app. See HANDOFF/CHANGELOG for exact evidence/restored QA and CI scope. Generic arbitrary-tab splitting remains planned only. Strong’s body-word reading continuity is delivered; long-verse/end/width/hardware checks remain.


## 2026-11-19 — Compare Strong’s continuity (f0b8752e)

Shared Compare scroll now follows a visible verse through Strong’s reflow, preferring visible selected focus; independent and stacked hosts also receive verse-based restoration. Deferred work yields to newer explicit navigation/current-tab/passage/Compare-mode changes. Main Reader retains the finer body-word position separately. Mac aligned UI verified verse8 retained on enabling and selected11 retained on disabling; final guarded Mac/iOS builds PASS. Guard race matrix, independent/stacked/iPhone runtime and full width/long-verse/hardware checks remain. Nested drag-source removal experiment did not establish a pinned-drop fix and was fully reverted; pinned native dragging remains open. See HANDOFF/CHANGELOG for exact logs, QA restoration and CI status.


## 2026-11-19 — Notes formatting and context-menu follow-up

347cf74a routes native inline formatting through a shared, source-preserving cell edit: confirmed table pipes/rules/padding remain intact; mixed cells toggle together; existing inline constructs keep their rendering/source rather than becoming malformed enclosing marks.9 focused regressions and all212 package tests pass. Mac whole-table bold/toggle/Undo/Redo and exact persisted source verified. Arbitrary nested marks and the separate colored multi-cell highlight adapter remain open.04079bdf shortens the iPhone preview and groups Share/Print/Export; simulator now shows the entire primary menu including Trash and its action worked. Both final native builds pass. iPhone grid rendering passed; iPhone formatting/Undo remains unverified because remote keyboard input changed text unexpectedly. All original7Mac/17iOS note contents/timestamps unchanged, synthetic notes in recoverable Trash, original passages restored/4Mac/9current-iPhone tabs. Read HANDOFF for logs, simulator container relocation, input failures and next gates; no production/sync/schema changes or merge.


## 2026-11-19 — Multi-cell/multiline note highlights (8adef50b)

Default/color/Remove Highlight now share one source-preserving edit across cells and paragraphs, including partial recolor/removal and mapped selection. Color application is idempotent; structural Markdown/line endings and existing code/links/other marks survive. Other marks remain protected rather than gaining nested styling. Escape atoms stay together even under partial selection (initial failed readable-text case corrected).20 focused tests and all223 package tests pass; both native builds pass. Mac actual6-run Blue→Undo/Redo→Green→Remove restored the exact original source and grid; synthetic note in recoverable Trash, original7 note hashes/timestamps and4workspace tabs unchanged. iPhone8ade runtime and full native partial/nested/width/hardware matrix remain open. See HANDOFF for exact logs, evidence limits and pending exact-head CI.


## 2026-11-19 — Combined note rendering (09eb7d84 /6555fd0e)

Existing strong/emphasis combinations now use Foundation source positions while custom marks/raw IDs remain source-preserving. Literal code and link destinations stay intact; the native punctuation-only mark fallback remains. Bounded thread-safe process cache avoids reparsing unchanged bodies; synthetic parser timing matches the old path after caching (not a whole-editor latency claim). Highlight backgrounds now exclude hidden glyphs; real Mac empty blue strip disappeared.9new tests,46focused and all232package tests pass; both final native builds pass. Mac combined styles/table, plain copy and Command-B round trip verified with exact source retained; synthetic note trashed, original7 note hashes/timestamps and4workspace tabs unchanged. Whole protected highlight runs can be cleared; unsupported partial nested edits remain unchanged and full rich-mark mutation parity remains open. iPhone runtime/physical/accessibility/large-note matrix and GFM escaped wiki-alias identity verification remain queued. See HANDOFF for exact logs and CI scope.

## 2026-11-19 — iPhone formatting target survives Undo/Redo

All iPhone programmatic note formatting uses the existing literal-source undo path with validated text/selection bounds. This fixes Redo collapsing selection and a subsequent format button inserting empty marks at the caret. Real simulator touch Bold→Undo→Redo→Bold and Highlight→Undo→Redo→Highlight restore the exact whole original table fixture; selected Prayer retains visible handles. iOS build passes (`/tmp/berean-note-selection-undo-ios.log`). Original17 notes unchanged,47active tabs retained, synthetic notes recoverably trashed. Mac/package unchanged; previous232tests/Mac build are baseline, not fresh checks. Broader multi-cell/combined-style/color/typing/IME/accessibility parity remains open. See HANDOFF for IDs and clipboard method.

## 2026-11-19 — Combined formatting of visible note text

Shared native formatting now adds styles to existing styled text and toggles exact marked runs independently, including bold+italic shared boundaries. It verifies plain text and prior style coverage before accepting the source edit. Mac and iPhone actual UI passed a selected table word through Bold→Italic, independent Bold removal, Undo and independent Italic removal; exact saved source confirmed.236tests and both SDK27.2 builds pass (HANDOFF has logs). Partial removal inside a larger mark, whole-table combined editing and broader rich-editor parity remain open. Table wiki-link normalization is deferred because actual legacy serialization proves an identity collision; see NOTE-TABLE-LINK-COMPATIBILITY.md.

## 2026-11-19 — Remove note styles from part of a passage

Native Notes now removes a style only from selected visible text while retaining surrounding formatting, including nested emphasis. Global visible-character/semantic validation protects neighbouring styles and link/code identities. Mac and iPhone live checks passed sequential Bold/Italic removal from Bravo inside a formatted table phrase, plus exact Undo/Redo and selection retention.240tests and both final SDK27.2 builds pass; HANDOFF contains logs, initial failures and cleanup evidence. Whole-cell/table mixed hidden-syntax edits and broader rich-editor parity remain open.

## 2026-11-19 — Generic tab-split model groundwork

Added process-local pane-tree edits/geometry, atomic layout undo and scoped/versioned tab-drag payload validation.8focused tests include484ordered tab-family/edge cases. Full248tests and both SDK27.2 builds pass (`/tmp/berean-pane-layout-*` logs). No split UI, drag target/type, app command routing or persistence is enabled; TAB-SPLIT-DESIGN.md specifies the next extraction and remaining gates. Separately, actual Mac Compare independent KJV10/LXX5 reading positions survived Strong’sON/OFF; exact intra-row position and broader matrices remain open. Original notes unchanged; HANDOFF has precise evidence.

## 2026-11-19 — Explicit Mac tab content host

MacRootView now delegates its current single document to MacTabContentHost(tabID:), preserving identity/toolbar/inspector behavior and handling a stale tab explicitly. Mac build and real Scripture/Notes/Calendar/History/Tags/Lexicon/Search checks pass; exact37original tabs and7original notes preserved. Shared248tests/iOS model-build baseline unchanged. Background-pane command/focus/toolbar/editor coordination and actual drag previews/splits remain unfinished; see TAB-SPLIT-DESIGN/HANDOFF.
