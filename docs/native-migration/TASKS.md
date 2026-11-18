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
