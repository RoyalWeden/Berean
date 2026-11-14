# Berean Native Migration — Persistent Execution Playbook

> **Purpose:** The durable, repository-resident operational reference for Claude Code implementing the macOS and iOS transition to native Swift. Designed to survive context compaction, model changes, session restarts, and long project timelines.
>
> **Status:** Prepared from the 18 uploaded audit documents and the user's reported 2026-11-07 cleanup preflight. **This is not evidence that implementation has begun.** When installed in the repository, the agent must reconcile every recorded baseline and decision with actual code, `origin/main`, and the separately supplied **Berean Native Migration Master Specification** DOCX. That DOCX was *not included in the materials supplied for creating this playbook*. Read it and incorporate any additional binding requirements before implementation; do not pretend it was inspected here.
>
> **Initial audit anchors:** code baseline `d97fb05c31b384d164cc12022e405fa923f263de`; audit documentation merge reported at `ceaaa73`; investigated source predominantly `807c2d9`; version 0.8.1 with an unreleased 0.8.2 changelog entry. All are historical snapshots, not assumed current HEAD.
>
> **Safety level:** A migration of user-created documents and multi-device synchronization. Data correctness and reversible operation outrank convenience, speed, and cosmetic parity.

## 0. Always-start-here execution protocol

Every **new or compacted Claude session** starts with this sequence:

1. Read the repository's current `CLAUDE.md` and any per-directory agent instructions. Verify instructions against current code where contradictory.
2. Read **this entire playbook** (or, when constrained, its sections 0–4, 8, 12, 15–19, and the precise sections for the next task). Do not act from a vague remembered summary.
3. Read `docs/native-migration/STATUS.md`, `TASKS.md`, `DECISIONS.md`, `HANDOFF.md`, and the latest entries in `CHANGELOG.md`.
4. Open the separately provided **Berean Native Migration Master Specification** and ensure its location is recorded in `STATUS.md`. If unavailable, do not invent content; continue only with tasks safely specified by this playbook and audits, and log the specification as missing.
5. Consult relevant original audit sections in `docs/native-migration-audit/00` through `17` before altering a sensitive subsystem.
6. Verify live evidence: `git status --porcelain=v1`, `git branch --show-current`, `git rev-parse HEAD`, `git worktree list`, relevant PR/CI results, current app identities and build scripts. Never assume an old checkpoint is still current.
7. Select the **highest-priority ready task** whose dependencies and safety gates are satisfied. Make code changes on an isolated worktree, not on canonical `main`.
8. Implement → test → repair → rerun → commit → review/PR/merge under existing repo policy → update all durable records → immediately select the next ready task. Do not stop simply because a PR or milestone finished.
9. If blocked, record the precise owner action required, choose a separate unblocked task, and continue. Only interrupt when the user is genuinely necessary; batch questions.
10. Before any session terminates, update `HANDOFF.md` with exact repository state, worktree, touched files, commands and outcomes, blockers, and next executable step. **No claim of background continuation beyond the current active agent session.**

For reader, search and navigation changes, use both actual app bundles with the immutable catalog and the native Dev identities. Check that navigation resolves a less common bundled text, and compare tab counts before and after ordinary navigation and explicit New Tab. Verify touch selection and persistent highlights separately from compile checks. Keep unnamed-workspace discovery and reversible tab cleanup in the active parity queue.

**Never infer completion from the existence of source files.** Feature completion requires actual behavior, persistence and restart checks, platform checks, and relevant parity tests.

## 1. Source hierarchy and how to resolve disagreement

| Authority | How to use it |
|---|---|
| Non-negotiable preservation/security rules in this playbook and owner's latest explicit instructions | Must be obeyed. Never override to maintain momentum. |
| Existing user data, published sync formats, current code and tests | Ground truth for compatibility. Verify current implementation; do not invent semantics. |
| Berean Native Migration Master Specification (separately provided DOCX) | Primary comprehensive implementation contract **once located and read**. Record exact path/revision. |
| The 18 audit files in `docs/native-migration-audit/` | Detailed evidence and migration proposals. Some assertions were at `807c2d9`, not final HEAD; labels VERIFIED/INFERRED/UNVERIFIED/BLOCKED must be retained. |
| Current `CLAUDE.md`, repository contracts, navigation/UX/design docs | Development workflow and intended interaction contracts. Audit found several outdated claims; verify against code. |
| `docs/native-migration/{STATUS,TASKS,DECISIONS,CHANGELOG,HANDOFF}.md` | Canonical **execution state**, not product specification. Correct drift against Git/code, with an audit trail. |

If two sources conflict: record the conflict and references; use source-code evidence for facts, user decisions for product choices, and the safer reversible approach for engineering uncertainties. Do not silently repair or reinterpret historic audit assertions. Mark unresolved gates explicitly.

### All audit files — retrieval map

| Number | Filename | Focus |
|---|---|---|
| 00 | `00-EXECUTIVE-SUMMARY.md` | Feasibility and major blockers |
| 01 | `01-REPOSITORY-STABILIZATION.md` | Commits, tests, known defects, worktrees |
| 02 | `02-CURRENT-ARCHITECTURE.md` | IPC, UI, services, data flows, release scripts |
| 03 | `03-FEATURE-INVENTORY.md` | **Full source-derived parity inventory** (Appendix A mirrors its summary) |
| 04 | `04-DATABASE-AND-DATA-MIGRATION.md` | SQLite, localStorage, backups, identity, migration |
| 05 | `05-ICLOUD-AND-SYNCHRONIZATION.md` | iCloud Documents journal, hashes, bugs, interoperability |
| 06 | `06-MACOS-NATIVE-ARCHITECTURE.md` | SwiftUI/AppKit, text, panels, windows, shortcuts |
| 07 | `07-IOS-NATIVE-ARCHITECTURE.md` | iPhone navigation and native interaction contract |
| 08 | `08-SHARED-SWIFT-ARCHITECTURE.md` | Swift modules, dependency layers, concurrency |
| 09 | `09-NATIVE-COMPONENT-REPLACEMENTS.md` | Editor, speech, runtime and third-party replacements |
| 10 | `10-PERFORMANCE-AND-RESOURCE-AUDIT.md` | Measured Electron baseline, benchmark limitations |
| 11 | `11-TESTING-AND-PARITY-STRATEGY.md` | Goldens, testing gaps, CI and acceptance |
| 12 | `12-RISK-REGISTER.md` | Risks R-01…R-44; Appendix B mirrors index |
| 13 | `13-INCREMENTAL-MIGRATION-OPTIONS.md` | Chosen parallel-app strategy and reasons |
| 14 | `14-DEPENDENCY-AND-CODE-MAP.md` | Package and source mappings |
| 15 | `15-OPEN-QUESTIONS-AND-DECISIONS.md` | Engineering A, experiments B, owner C, external D |
| 16 | `16-AUDIT-HANDOFF.md` | Audit decision priorities |
| 17 | `17-SECURITY-PRIVACY-RELEASE.md` | Security, identity, privacy and distribution |

## 2. Mission, boundaries, end state

**Mission:** Replace the Apple implementations with a native macOS application (SwiftUI + selective AppKit) and a native iPhone application (SwiftUI + selective UIKit), backed by one shared Swift codebase. Preserve user-created data, existing workflow, offline bundled text databases, and full intended functionality. No permanent Electron, React, Capacitor, ProseMirror, Zustand or JavaScript engine for the *core Apple applications*. A `WKWebView` for genuinely hosted third-party web experiences such as YouTube is allowed and does **not** make the rest of the app a web wrapper.

**Delivery method:** Option A from audit 13: build **parallel native apps bottom-up**, using Berean Dev identities, test data and a shared Swift package, while old Mac Electron/iPhone Capacitor versions remain buildable. Option C may help provide early, read-only native iPhone screens; never use it to expose unverified native writers to user data. No big-bang replacement and no direct production persistence conversion.

**Preserve:** book text, study names and theological/text conventions; current navigation contracts; notes and private Markdown dialect; word/highlight character offsets; all synced entity bookkeeping; tab/session/workspace behavior; iPhone custom three-control navigation; multi-pane Mac study workflows; existing release identity; media and accessibility features. Deferred/unimplemented features in audit 03 are **not automatically new migration deliverables** unless the master spec explicitly adds them.

**Windows:** Existing CI can produce a Windows NSIS installer, but whether users actually depend on it was unresolved. Do not remove Windows code or declare Electron fully retired until C-1 is decided. Scope of Apple-native work is macOS + iOS.

### Safety constraints — absolute

- No native production data writes until exact compatibility, interoperability, backup and recovery gates pass **and** the owner authorizes production rollout.
- Never open or test with real production database or journal just to see whether code works. Use synthetic datasets, immutable read-only copies, and separate Dev identity/container.
- Preserve exact production bundle IDs, Apple Team, App Groups, ubiquity containers, URL/deep-link schemes, signing and App Store identity until planned release decision.
- Keep SQLite on-disk schema compatible, including FTS5, triggers, user data and sync bookkeeping. Do not switch to SwiftData/Core Data.
- No unapproved schema ordinal bump during old/native coexistence; adding columns affects sync hashes, even if SQL migration appears additive.
- No accidental `localStorage` loss; bridge old apps to export every user-authored value before switching.
- No destruction of unique backups, archives, worktrees, stashes, recovery refs, keys, production containers or files. No force-delete/rebase/force-push; identify owner approval where destructive.
- No automatic app submission, notarization, production signing deployment, release publishing, or live sync schema changes.
- Do not assert green production, native parity or no bugs from compile-only success. Label evidence precisely.

## 3. Existing architecture at audited baseline

- **Mac:** Electron 32 / Node main (`electron/main.ts`), IPC handlers (`electron/ipc/*`), preload (`electron/preload.ts`) exposing typed bridge (`src/types/electron.d.ts`), React 18 renderer (`src/App.tsx` and components), Zustand store (`src/store/index.ts`), `better-sqlite3`, native Objective-C Node addons for macOS effects/iCloud. Audit counted 295 `ipcMain.handle` channels and nine categories of windows.
- **iPhone:** Capacitor 8 in a `WKWebView`, React UI in `src/mobile/*`, bridge in `src/platform/ios/*`, a native Swift `BereanSQLite` plugin, iCloud plugin, voice/ONNX code, Share Extension, Spotlight, App Intents and Widget. App is currently iPhone-focused, deployment target iOS 17 at audit time.
- **Shared TS code:** `src/platform/services/*` (24 files), `src/platform/db/*`, `src/platform/sync/*` (custom iCloud journal), `src/lib/*` reference/text/research/navigation, ProseMirror notes.
- **Persistence:** mutable `berean.db` (audit schema v49); bundled read-only SQLite texts and lexicons; localStorage; vault files; note attachments/PDF bytes; key and credential stores; iCloud Documents journals.
- **Size/complexity:** ~141,458 non-test lines of TS/TSX in `src`, ~17,036 in `electron`, ~3,095 Swift, and 5,766 passing tests at stabilized baseline. Counts are historical and must not substitute current test output.
- **Known stabilization:** PR #8–#11 fixed four sync-loss paths D1–D4, table formatting, atomic vault writes, external links, speech cache key path escape and build/test hygiene. Residual bugs remain (see §12).

### Key source-to-native replacement map

| Existing subsystem | Native destination | Evidence |
|---|---|---|
| `src/platform/db/DatabaseAdapter.ts`, SQL migrations | `BereanSQLite` / `BereanStore`, same SQLite database | 04, 08 |
| `src/platform/services/*` | `BereanDomain` platform-neutral services | 02, 08, 14 |
| `src/lib/parseRef.ts`, Bible registries, tagged tokens | `BereanReference`, `BereanText` with goldens | 03, 08 |
| `src/platform/sync/*` | `BereanSync` byte-compatible actor/journal transport | 05, 08 |
| `src/components/notes/pm/*` | `BereanMarkdown` + native block/TextKit editor | 09 |
| `src/components/shell/PanelLayout.tsx` | AppKit recursive split view, preserve mosaic JSON conversion | 06 |
| `src/components/bible/*` | AppKit/UIKit TextKit reader, tested plain/display offset map | 06, 07 |
| `src/store/*`, navigation libs | `BereanNavigation` + observable view models, persistence | 06–08 |
| `src/components/youtube/*` | Native chrome and explicitly isolated WebKit playback where needed | 06, 07 |
| `pdfjs-dist` web viewer | PDFKit, coordinate/annotation equivalence | 06, 09 |
| `kokoro-js`, phonemizer, audio | Swift text/token pipeline, ONNX native, AVAudioSession/AVAudioEngine | 09 |
| `electron/ipc/aiLookup.ts` and `src/lib/research/*` | Native research/Ask Berean services, parity depends on platform decision | 08, 09 |

## 4. Target architecture and module dependency boundaries

**Preferred shape from audit 08:** one Xcode workspace/project, separate Mac and iOS app targets plus appropriate extensions, a local Swift package `BereanKit` with multiple library targets. Swift 6 strict concurrency in new code (verify build/deployment requirements). UI platform surfaces consume shared modules; domain modules never import SwiftUI/AppKit/UIKit. Bind layer direction in SwiftPM and add a dependency boundary test/lint. Keep production vs Berean Dev `config/app-identity.json`/xcconfig model, not copy-pasted IDs.

| Layer | Module | Purpose |
|---|---|---|
| L0 | `BereanCore` | IDs, basic models, clocks, errors, identity and protocols |
| L1 | `BereanReference`, `BereanMarkdown` | Reference parsing and note dialect model/parser/serializer |
| L2 | `BereanText`, `BereanSQLite` | DisplayMap, tagging, word replacement; SQLite connection abstraction |
| L3 | `BereanStore` | Current schema, migrations, read-only texts, mutable store, change bus |
| L4 | `BereanDomain`, `BereanSearch`, `BereanNavigation` | Services, FTS, lookup, persisted tabs/workspaces/navigation |
| L5 | `BereanSync`, `BereanResearch`, `BereanSpeech` | iCloud journal, AI research, native inference/playback |
| App | `BereanMac`, `BereanIOS`, extensions | Platform lifecycle, UI, file/device services |

Layer names/proposals are from 08 §4. If the master spec differs, record an ADR and reconcile before generating empty modules. Use protocols to isolate platform integrations such as iCloud, filesystem, Haptics, Keychain, Spotlight, audio, permissions, settings and windowing. Swift concurrency and database actors must prevent UI blocking and write races without sweeping unsafe `@unchecked Sendable` exemptions.

**Project identity choice:** do not prematurely increase the OS floor; audit 08 recommended considering iOS 18/macOS 15 but confirmed existing iOS 17. Resolve owner decision C-2 with install-base facts. New APIs need `#available` or deliberate floor change.

## 5. Non-negotiable data compatibility contract

### 5.1 Database and migration

- User store `berean.db` is **SQLite schema v49 at audited baseline** (47 ordinary tables, two external-content FTS5 tables, triggers, indices; schema version in a table, not `PRAGMA user_version`). The native target can open the existing format. Bundled text/lexicon DB schemas vary; some have `text_tagged`, `title`, `sort_order`, FTS table shape differences—probe columns rather than assuming uniform schema.
- Preserve `notes`, `note_versions`, tags, highlights, workspaces, sessions, tabs, PDF metadata, research chats, Study Trail and all `sync_*` metadata, deleted/tombstone semantics and attachments. Preserve exact semantic contracts when reading/writing.
- Use correct SQLite backup API or `VACUUM INTO` under a safe snapshot protocol, not a naive copy of only the WAL main database. Validate integrity, foreign keys, FTS, record counts, schema, controlled content digests and PDF hashes before switching copies. Backup failure is fatal, not a warning.
- Ensure older binaries reject unsupported **newer** schemas before writing. Never launch old/native versions against the same live data directory simultaneously.
- Keep source old app data untouched; the native app receives a validated copy. No merging of two local databases without a designed, tested merge algorithm.
- A native downgrade is not a store downgrade; on iOS the rollback means shipping a **newer** build that can read data, not installing a lower version.

### 5.2 Other user data

- `localStorage` contains user-authored values not duplicated in SQLite (word replacer rules, custom themes, chat drafts and other app-state keys). Before release, implement a **legacy bridge exporter**, test its field-by-field coverage (audit 15 A-1), and import into native storage on first run. UI state may be lower priority but must be explicitly accounted for.
- Electron safeStorage-derived secrets/keys need re-entry or one-time authenticated migration; no assumption native can decrypt them directly.
- Mac DMG and MAS currently share a bundle ID but not a data location; sandboxed native apps cannot automatically read a non-sandboxed DMG's App Support. Test migration/export consent and resolve store/distribution route before release.
- Vault Markdown, front matter, note attachments and PDF **bytes** need exact source-preserving treatment; PDFs are not synchronized as bytes by current iCloud mechanism, only metadata. Do not delete the only PDF copy.
- Current private data stores may contain substantial notes; structural tests must disclose **counts and shape only**, never sensitive note content or secrets in logs.

### 5.3 Imports, backups and rollback

1. Inventory all source storage roots per app identity and distribution channel.
2. Establish a verified, restorable backup with intact sync bookkeeping and attachments, keeping historical backups.
3. Export localStorage and non-database user preferences via old app bridge.
4. Copy/restore into *isolated* development import target; no live mutation.
5. Compare table row counts, record digests, FTS queries, highlights, XML/Markdown structure, PDF hashes and settings.
6. Run native importer idempotently; prove it can be safely restarted after interruption.
7. Test old/native open/close, offline edits, restart, sync, conflict recovery only in Dev test environments.
8. Define reverse export and higher-build rollback before any live release.
9. Defer migration execution on production until owner approval and platform-specific release gate.

## 6. iCloud Documents journal — exact compatibility requirements

**Important correction:** The existing mechanism is **iCloud Documents, not CloudKit records**. Sync engine lives in TS. `BereanCloudPlugin.swift` is file transport using `NSFileCoordinator` and `NSMetadataQuery`. Mac uses filesystem iCloud transport and a native bridge for sandbox download. Do not silently redesign it as CloudKit; that would be a separate project.

**Observed journal path:** `<ubiquity container>/Documents/sync/v1/`, with `berean-identity.json`, `devices/<deviceId>/manifest.json`, `journal-<range>.jsonl`, snapshots; each device publishes only its own folder. Journal `SYNC_FORMAT_VERSION` was 1 in audit. `SyncOp` carries `id`, `seq`, `hlc`, `device`, `entity`, `key`, `op`, optional `fields`, `base`, `schema`, `fh`, `lin`. HLC format `<13-digit-ms>-<4-hex-counter>-<deviceId>` sorted as strings; device ID 16 hex chars without hyphens. Sync schema ordinal must remain compatible.

**Hash compatibility is release-critical.** Audit 12 R-02 records a reproduced case where a different native hash republished stale text and reverted offline edits on all devices. `hashFields`/`fieldHashes` use FNV-1a 32-bit across **JavaScript UTF-16 code units** of specific `JSON.stringify` shapes/field ordering. Native output must match JS for numbers, Unicode, emoji/surrogates, null, nested objects, keys, SELECT-column order, and normalisation. **100% conformance goldens or STOP.** Avoid raw `JSONEncoder` assumptions; its ordering/float serialization may differ.

Preserve:
- `sync_state`, `sync_outbox`, `sync_record_meta`, `sync_applied`, `sync_failed`, `sync_conflicts` and device identity.
- Hybrid logical clocks, lineage, field merge, snapshots, compaction, backpressure, per-device journal ownership.
- Three existing deletion models (including soft-deleted notes vs true tombstones); no tombstone garbage collection by assumption.
- In-flight update handling (D1), FK retry on snapshot (D2), failed-op retention (D3), vault change capture (D4): **fixed in stabilized TS**; do not reintroduce.
- D5–D7 remain unresolved: stale vault file overwrites newer DB edit, some entity capture delayed until launch, Mac account mismatch check absent.
- Official registry in `src/platform/sync/entities.ts` must be treated as authoritative: audit 05 lists **24** synchronized entity kinds, while audit 08/14 refer to 22. Investigate and reconcile before coding, not by guessing.
- `NSFileCoordinator`, dataless iCloud files, app/account changes, journal growth, old-device edits, offline and multi-device convergence.

**Interop gate order:** pure hash goldens → journal/parser goldens → in-memory multi-device simulation → local fake iCloud folder → isolated Berean Dev ubiquity container → real Dev old/new clients on multiple devices → monitored canary only after authorization. A native writer must never touch production journal before this gate passes and owner explicitly authorizes release.

**Transitional exception:** Existing TypeScript engine hosted in JavaScriptCore may reduce semantic risk; audit 13 frames it as temporary. The fully native end state requires a Swift port. Log a specific removal task/condition if any bridge is chosen.

## 7. Native macOS experience contract

**SwiftUI:** app lifecycle/scenes where suitable, sidebars, lists, forms/settings, search palette, inspectors, themes, accessible controls. **AppKit:** custom nested `NSSplitViewController` pane tree, TextKit 2 scripture display, responder chain, native menus, window restoration and unique window classes. Avoid trying to force all advanced study interaction into SwiftUI defaults.

Required parity (audit 06 and 03): five Spaces, vertical mixed-type tabs; sessions, archived groups, saved workspace/mosaic layouts; 16 Scripture layout presets (not six, despite stale `CLAUDE.md`); inspector snap widths and reading position; floating tabs, presenter, chat, verse picker, Study Trail, separate window behaviors; keyboard accelerators and context menus; theme/custom colors and contrast, native Liquid Glass in chrome; YouTube with explicitly scoped web island; PDFKit.

Text reader is a critical engineering component: stored highlights refer to **plain source verse text character offsets**, but rendered text can include word replacers, brackets/filters, Strong's annotations, superscriptions. Build `DisplayMap` mapping source ↔ displayed positions with regression tests. Native text selection, hit testing, verse/word menus, per-verse accessibility and multiple chapter scrolling require proof on long chapters such as Psalm 119 and many highlights.

Do not blindly carry nonstandard Mac shortcuts into native; owner C-5 must settle `Cmd+H`, `Cmd+G`, `Cmd+Shift+S`, `Cmd+L`, Paste Match Style collisions. Preserve intent and offer tested focus-aware command behavior.

### UI-complete gate (added 2026-11-08 at the owner's request)
A visible feature is **not UI-complete** until all of the following hold:
1. Its visible interaction has been exercised in the running app. On the Mac, use System Events menus/keys or
   explicit `cliclick dd/du`. On the iPhone, use the Simulator via Xcode MCP / probe. Service tests alone never
   count.
2. Its important workflows match the existing app's functionality.
3. Every intentional design difference has been compared against the existing app and recorded in
   `VISUAL-UX-PARITY.md`.
4. Any interaction that could not be exercised is reported as unverified.

Check specifically for buttons that do nothing, sheets and panels that never appear, commands routed to the wrong
window, duplicate controls, lost shortcuts, single-platform controls, and features that exist but can't be found.
Prefer workflow-level regression scripts (e.g. `npm run native:ui:smoke`) over "the view initialises" tests.

## 8. Native iPhone experience contract

The iPhone is **not** a mini Mac with fixed stock tabs. Audit 07 documents a special mobile navigation model:

- Bottom **Tab cards | Plus/Quick Open | Caret** control row; scroll and keyboard behaviors.
- Unlimited tabs of multiple types, per-tab history snapshots, transform-tab semantics, reuse vs new-tab intent, sessions/workspaces, archived groups.
- Tab cards with previews (data-driven, not screenshots), reorder interactions, long-press actions, VoiceOver move actions.
- Sheets are navigable surfaces with detents and native scrolling/gesture handoff; one coherent sheet coordinator.
- Quick passage opening, chapter swipes, back gestures, verse long-press/context menus, Strong's, find-in-chapter, reading position.
- iPhone reader uses SwiftUI chrome with UIKit/TextKit or another proven native text engine, `UIPageViewController` or appropriate pager where needed; prioritize actual selection/offset hit testing.
- Reuse native plugin internals that genuinely work (SQLite, cloud transport, ONNX, location, Share Extension, Spotlight, App Intents and Widget), but remove Capacitor bridge wrappers only after replacement.
- Background audio/Now Playing, downloads, deep links, file sharing and lifecycle need physical-device verification; simulator success is insufficient.

`TabView`/`NavigationStack` can implement subcomponents, but may not replace custom tab identity/history behavior. Audit 07 §14 provides the full behavior-by-behavior ledger; convert it into task checks, not a vague 'native navigation done' assertion.

## 9. Editor/Markdown and Read Aloud high-risk contracts

### 9.1 Notes editor

Current notes use ProseMirror with a **private Markdown dialect** and rich structures: headings/lists/tables, inline emphasis/links, images, verse refs, callouts, columns, threads, collapsible blocks, colored highlights, NBSP indent, wikilinks and Study Trail embeds. `swift-markdown`/cmark-gfm alone **does not ensure byte parity** with the current parser/serializer (audit 09 corrects a simpler recommendation in audit 14). Basic `TextEditor` alone is inadequate for full parity.

Preferred experiment: native Markdown AST with custom Markdown parser/serializer, backed by UIKit/AppKit TextKit 2 block surfaces where proven. Experiment with `NSTextTable`, fragmented long notes, table/column boundary selection, undo/redo, paste/clipboard and rich attachments; choose architecture after spikes B-3/B-4. Preserve unsupported nodes **verbatim**; an unsupported editing surface must not destructively normalize a note.

**Critical gate:** real note corpus structural scan (content-private), golden round-trips and fuzz cases, including post-PR-10 table formatting; exact serialization or documented intentional changes only on a real user edit. Existing notes may be very large (~9.1m characters observed for one note). No production writing until proven.

### 9.2 Read Aloud

Current Kokoro-on-iPhone can run ONNX via Swift plugin CPU, but device performance, thermals, locked-screen inference, word-level timing and native G2P parity were not proved. Test on physical iPhones, including oldest supported device; report real-time factor, peak memory, heat, background/lock behavior.

Preserve user quality and voice selection; do not replace with basic system speech as a shortcut. Native pipeline must cover spoken-text extraction, normalization, phonemization, tokenizer, `model.onnx` inference, PCM/audio queue, cache, timing, highlighting, interruptions and AVAudioSession/Now Playing.

**Licensing gate:** phonemizer dependency likely includes eSpeak NG GPLv3+; audit flags legal review, not a legal verdict. Do not assume compatibility or ship an unreviewed port. Compare permissive G2P alternatives and license terms. Test intended pronunciation of special names including Yeshua by listening, not by source comments. Neural Engine background inference may need Apple entitlement; CPU is fallback until proven.

### 9.3 Ask Berean

`electron/ipc/aiLookup.ts` is ~4,156 lines in audit; shared research logic exists in `src/lib/research/*`, but iPhone's present capabilities are more limited/model-free. Port native query policies, reference checks, model routing and safe output, not merely an empty chat. Preserve evaluation harness as golden quality gate. Resolve owner C-4 about iPhone scope before claiming parity. Provider keys, cloud research and local model runtime must be platform/entitlement-aware.

## 10. Complete feature parity rule

Appendix A reproduces the audited feature-status matrix with stable IDs (S, Q, N, H, U, M, G, A). This is the **source baseline**, not an assertion all listed features must be improved. Make a native task for every **implemented or partial** feature within final scope. For deferred items, capture the deliberate non-scope decision; never mark as migrated. Preserve Mac-only or iPhone-only distinctions unless the master spec explicitly broadens support. Check all paths and tests in `03-FEATURE-INVENTORY.md` for each specific feature.

For each parity entry record: legacy behavior, native Mac result, native iPhone result, data format, test evidence, visual interaction check, accessibility, restart behavior, sync check if applicable, source paths, status/PR. `NOT_APPLICABLE` is allowed only with justification. `COMPLETE` requires proof; `PARTIAL` is not `COMPLETE`.

## 11. Milestone plan and ordered work packages

**Execution philosophy:** Keep enough parallel work to make progress, but minimize unreviewable changes and major write-surface duplication. For **each** milestone, finish its acceptance gate before shipping or authorizing the next dangerous capability. Non-dependent future prototypes and UI-only work may continue while a dangerous gate is blocked. The list below is a concrete execution backlog; `TASKS.md` carries live status/ownership and may add child tasks without deleting stable IDs.

### Milestone M0 — cleanup and stabilized legacy baseline

- **M0-01:** Reverify repository/current CI, reconcile docs vs HEAD, no production app running, preserve user data, build/launch legacy Mac and simulator iOS.
- **M0-02:** From user's 2026-11-07 Claude preflight: Group A (`Berean-ai-integrate` and patch-equivalent agent branch), Group B (`Berean-chat-rename`, `Berean-quick-open`, `Berean-ai-upgrade`) backed up and recoverably archived; cleanup approved in prior prompt but exact state must be reverified. No force cleanup, no unique work loss. Benchmark `Berean-ai-bench/REPORT.md` archive PR; investigate Octarine unmatched `f6b1b66`, `db074d1` before branch removal.
- **M0-03:** Preserve `~/Berean-backups/`, `~/Berean-userdata-backup-2026-09-22`, private cleanup bundle `~/Berean-backups/cleanup-2026-11-07/`, all stashes/recovery refs. Investigate disappearing `Berean-dev-builds` artifacts, but avoid speculative blame.
- **Gate G0:** current legacy builds/tests green or explicitly labeled exceptions, backup restore evidence, clean canonical `main` and isolated migration branch. No core data touched.

### Milestone M1 — project, CI and compatibility oracle

- **M1-01:** Create real Xcode project/targets and shared SwiftPM package in one repo; dev identities, no production data access; Mac and iPhone boot smoke.
- **M1-02:** Configure Swift lint/concurrency checks, schemes, signatures/dev entitlements and separate Mac/iOS CI smoke jobs. Keep legacy CI.
- **M1-03:** Export TS-generated deterministic golden fixtures (reference grammar, tagged tokens, search/navigation, Markdown, SQL services, hashes/field hashes, journal, conflicts). Version fixture provenance and commit.
- **M1-04:** Establish Swift parity harness and differential test runner; fail on unintended bytes/semantic changes.
- **Gate G1:** native Mac+iOS compile/launch in isolated dev identity, golden pipeline repeatable and tested, no production write surfaces.

### Milestone M2 — shared pure core and read-only data

- **M2-01:** Port basic types, identity validation, book/reference parsing, deep links and signed text conventions; 100% goldens where exact contracts.
- **M2-02:** Port tagged tokens, Bible verse text transforms and `DisplayMap`; verify bidirectional Unicode/UTF-16 selection positions.
- **M2-03:** Native SQLite/GRDB decision, read-only bundled texts/lexicons, safe connection/concurrency, FTS5 and schema variants.
- **M2-04:** Port read-only Bible/lexicon/search/reference service functions, query semantics, caches and error boundaries.
- **Gate G2:** representative Scripture read/search on both native targets; cross-language data contracts tested; no mutable user DB writes.

### Milestone M3 — write-safe persistence and legacy bridge

- **M3-01:** Port v1–v49 migration logic/schema, user DB services with exact SQL semantics, guarded newer-schema rejection and transactional backups.
- **M3-02:** Implement read-only import of verified copies of existing user DB, separate Dev profile, integrity/count/hash/FTS/foreign key checks.
- **M3-03:** Legacy localStorage exporter for both Electron/WKWebView identities; field-by-field coverage + native importer + idempotency.
- **M3-04:** Port notes/highlights/tags/sessions/workspaces service CRUD behind a safe change-capture contract; unit/integration tests on synthetic data only.
- **M3-05:** Vault/PDF bytes/external files and app-container identity conversion design; demonstrate reliable recovery and rollback.
- **Gate G3:** synthetic writes and restart parity; verified data import on copies; no production DB or sync writes. Legacy apps remain runnable.

### Milestone M4 — synchronization interoperability

- **M4-01:** Fix/report residual D5–D7 in legacy where safely scoped, with tests; inventory every DB write that must emit change events.
- **M4-02:** Port HLC, journal, exact hashing and field merge to Swift; golden 100% parity on all active entities and edge cases.
- **M4-03:** Implement native iCloud transport using `NSFileCoordinator`/file coordination and account/container identity guards; isolated Dev only.
- **M4-04:** Simulate two+ devices including concurrent edits, offline, snapshots, deletes, FK retries, retries/quarantine, compaction, account switches, large/dataless journals, old/new coexistence.
- **M4-05:** Run Dev-container old/native clients and real device timing tests, preserving logs and exact evidence; compare hash digests and tombstones.
- **Gate G4:** zero unexplained convergence differences, exact hashes, no loss in chaos/canary, controlled rollback. **Any production use requires new owner authorization**.

### Milestone M5 — native reader and search surfaces

- **M5-01:** Mac TextKit/NSView Scripture reader and keyboard/selection/context-menu behavior; long chapters and highlight offset sweep.
- **M5-02:** iPhone UIKit/TextKit reader, chapter paging and gestures with native selection and haptics; device test.
- **M5-03:** Native strong's/lexicon, crossrefs, parallel compare, multiple editions, display prefs, word replacer and find-in-chapter.
- **M5-04:** Native full-text Scripture/notes/Strong's/lexicon/transcript search and unified palette; restore tabs/scroll/results.
- **Gate G5:** real chapter and passage navigation in both apps, restart parity, selection/offset goldens and accessible reading, measured scrolling.

### Milestone M6 — platform shells, tabs and workspaces

- **M6-01:** Mac sidebar/Spaces/sessions/vertical tabs/MRU/archived, pop-out windows, multiwindow, native menu/commands.
- **M6-02:** AppKit recursive pane layout using stored mosaic JSON; all applicable presets, dividers, inspector and restoration.
- **M6-03:** iPhone three-control navigation, tab cards, Quick Open, Caret, sheets, per-tab history and workspace actions.
- **M6-04:** Appearance, themes, accessibility, focus, platform keyboard behavior and deep links.
- **Gate G6:** layout persistence and restart, no tab identity regressions, manual + UI automated parity, old apps unbroken.

### Milestone M7 — notes and annotations

- **M7-01:** Native private Markdown AST/parser/serializer and post-fix cross-language round-trip corpus.
- **M7-02:** Editor prototypes for native tables, nested/callouts/threads/columns, selection/undo and long documents; ADR selection.
- **M7-03:** Mac and iPhone native editing UI with supported blocks, attachments/images, auto-save, version history, export/import and recovery.
- **M7-04:** Word/verse highlights, note/tag indicators, cross-device annotations and highlight offsets on controlled real-data copies when authorized.
- **Gate G7:** no destructive rewrite/loss; exact or documented intentional Markdown differences; restart, undo, import/export, backup, sync in Dev; owner reviews unsupported editing behaviors before release.

### Milestone M8 — auxiliary native features and media

- **M8-01:** PDFKit viewing, highlights, bookmarks, coordinate transforms, imported file byte integrity.
- **M8-02:** YouTube native outer UI, web island, auth/PiP tests, transcript browsing/search/packs, timestamp/notes/playlists.
- **M8-03:** Study Trail, tags graph, tasks, calendars/daily notes/sunrise, vault and importers.
- **M8-04:** Native Ask Berean research/model-free flows, provider/local runtime parity by agreed platform scope and eval harness.
- **M8-05:** Kokoro/ONNX speech, G2P licensed replacement, full audio/word timing/background behavior and device thermal benchmarks.
- **M8-06:** iOS Share Extension, Spotlight, Intents, Widget, haptics; Mac menus, external links, file access and native effects.
- **Gate G8:** feature-specific tests and device reviews; licensing/privacy/distribution blockers remain explicit; parity ledger accounts for each audited capability.

### Milestone M9 — parity, performance, hardening and release rehearsal

- **M9-01:** Sweep entire feature matrix on each platform, full UI/accessibility/regression suite and controlled large-user-data copies.
- **M9-02:** Memory, startup, CPU, 60-fps text scroll where hardware permits, search latency, write/restore performance; compare apples-to-apples baseline.
- **M9-03:** Security review (sandbox, URL/deep links, keys, entitlements, iCloud identity, privacy language, licenses) and crash/data recovery drills.
- **M9-04:** Old-to-native first-run installer/update bridge; verify separate MAS/DMG data and settings, preserved bundle/app groups, backups/rollbacks.
- **Gate G9:** all critical parity and data gates met; no open data-loss risk. Any exceptions require explicit documented owner decision.

### Milestone M10 — production transition (prepare, **do not execute automatically**)

- **M10-01:** Mac distribution route (MAS/Developer ID/both), updater, notarization and entitlement rehearsal.
- **M10-02:** iOS App Store identity, review/privacy disclosures, device support, TestFlight plan and rollback as a newer build.
- **M10-03:** Staged Dev→approved production rollout, backups and monitor plan, support/recovery procedure; release authorization required.
- **M10-04:** Deprecate Electron/Capacitor on Apple **only after** native parity and stable rollout. Preserve Windows until C-1 resolved.
- **Gate G10:** explicit owner approval, release signed/notarized or submitted as appropriate, production monitoring and restoration demonstrated.

## 12. Known residual defects, risks and hard stops

**Already fixed in stabilized TypeScript:** sync D1–D4, table-cell formatting, atomic writes, link safety, TTS cache key, iOS Swift test setup, MAS worktrees. Regression coverage must follow ports.

**Open/residual (audit 01/05/17):** D5 stale vault trust, D6 delayed profile/context sync, D7 no Mac iCloud account check; migration runner accepts too-new database and continues after failed backup; insecure Electron sandbox/webview/IPCs, permissions by origin; YouTube API key bundled; inaccurate sunrise location/privacy wording; eSpeak NG licensing; note pronunciation; weak vault/PDF tests; sharp high advisories (3, exact dependency shipping needs check); unclear Windows distribution; app identity/storage crossover.

**Stop or prevent this operation when:** hash golden mismatch; unexplained sync op burst, conflict surge or tombstone drift; backup integrity fails; unknown/newer DB schema; uncontrolled production identity selected; destructive Markdown serialization; unsupported note structures would be rewritten; missing PDF bytes; user data path cannot be verified; security/license/release gate not met. Continue unrelated safe tasks, but **do not override the blocked operation**.

See the complete R-01…R-44 risk index in Appendix B; owner/external decisions in Appendix C and 15.

## 13. Testing strategy and coverage requirements

### Legacy baseline (verify current)

At audit code `d97fb05`: 5,766 Vitest cases in 389 files; `npm run typecheck`, lint, desktop build/smoke/native addon, DMG, MAS dev/prod build, packaged sandbox launch, iOS simulator, five Swift tests, unsigned device/archive compiles passed. Not run: physical iPhone, live cross-device iCloud, actual notarization/upload, Windows, production identity. **Do not interpret that as a proven release.**

### Required new automated suites

- **Goldens:** TS exporter, Swift fixture parser, exhaustive reference/tagged text/UTF16/highlight mapping and search ranking, Markdown exact bytes, sync FNV/JSON/op/journal/HLC/merge, navigation snapshots, DB CRUD.
- **Database:** read-only bundle variants/FTS, SQL migrations from historical schemas, WAL snapshots, failed backup refusal, future schema refusal, foreign keys, attachments hashes, large DB import and idempotence.
- **Sync:** same and mixed versions/devices; edit while pushing, FK order, failed op/pruning, vault event capture; D5–D7; deletions, conflicts, journal quarantine, account switching, dataless files, slow iCloud, offline; never test against live production.
- **UI:** macOS window/pane/menu/selection, iPhone navigation/gesture/sheet/selection, notes editor structure, accessibility/VoiceOver, keyboard shortcuts, PDF and media.
- **Quality:** Ask Berean evaluation harness, real audio samples listening, deterministic speech alignment/replay and interruption.
- **CI:** separate SwiftPM + macOS + iOS simulator jobs (plus legacy TS and release build); artifacts and test evidence; build errors must not be hidden by scripts.

### Parity definition of done

A feature gets `COMPLETE` only if native UI genuinely works; model/service parity is proven; writes (if any) pass persistence/restart, backup and sync checks; user interactions/gestures/keyboard/accessibility are verified; platform targets compile; tests pass; performance regressions are understood; prior feature behavior is accounted for; PR merged and ledger updated. Mark unverifiable hardware checks `BLOCKED`, not PASS.

## 14. Performance discipline

Electron audit measured an **empty-profile** four-process physical footprint of ~357–364 MB and first contentful paint median ~702 ms over five runs. Runtime/framework bytes measured, but real-data behavior was not fully remeasured in that audit. Existing SQLite CLI query times are not the same as app path; no Swift performance was measured. Do not guarantee any particular native savings without measurement. Use matching dataset/device/build identity/conditions and representative workload. Profile app cold/warm start, peak/idle footprint, DB query latency, 60-fps reader scroll on long chapters, multiple panes, note editor typing/autosave, sync CPU and speech thermal/real-time factor. Record raw methodology, median/tails and regressions.

## 15. Autonomous operation and approvals

**Standing developer authorization:** Read code, run local tests/builds, modify Dev-only code, make well-scoped technical choices, create worktrees, commit, open/merge fully validated PRs per repository rules, maintain docs, and advance to next unblocked milestone. Do not ask for routine permission to proceed. A completed PR/milestone is a transition, not a natural pause.

**Owner action required only for:** destructive ambiguous/unique data, production DB or iCloud writes, bundle/account identity changes, external credentials/access requiring owner, physical device involvement, new release/upload/notarization, legal licensing, irreversible migration, major platform/product behavior compromises, OS floor/windows policy, sensitive content access. Batch owner decisions and keep working on independent ready tasks.

**Decision protocol:** For reversible ordinary engineering choices, evaluate alternatives and record an ADR; select best-supported default and proceed. For user-specific decisions C-1…C-17, use audited proposed defaults for experimental architecture only when reversible, but **do not treat them as owner approval**. Stop only the dependent dangerous step.

**No background-execution claim:** Within a single active Claude Code session, loop and continue. Session/tool limits, context compaction and crashes require checkpointing; they do not make unattended future work magically execute.

## 16. Mandatory execution record semantics

`STATUS.md` must answer: **What is working? What is the next exact action? What is blocked? What is the current Git state?**

`TASKS.md`: stable task IDs, dependencies, gate, scope, source audit refs, acceptance evidence, status. Legal status vocabulary: `TODO`, `READY`, `IN_PROGRESS`, `BLOCKED`, `PROTOTYPE`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED`, `MERGED`, `DEFERRED`, `NOT_APPLICABLE`—do not conflate. Only one `IN_PROGRESS` task per actual executor; declare concurrent agent ownership explicitly.

`CHANGELOG.md`: append-only date + branch/commit/PR + task IDs + what changed + exact checks + outcomes + bugs/regressions + next step; never rewrite history to remove an error.

`DECISIONS.md`: ADR ID, date, status PROPOSED/ACCEPTED/REJECTED/SUPERSEDED, problem, options, data/proof, chosen reversible course, authority/owner, consequences and revisit trigger. A proposed default is not an approved product decision.

`HANDOFF.md`: **overwrite latest recovery capsule** after each work block. Must record HEAD/branch/worktree/dirty paths, last successful tests, ongoing risky operations, blockers, any unpublished branch, next exact shell command/task, audit files to re-read, owner approval gates, and known limitations.

Every task/PR update should synchronize these files in the same commit when appropriate. For long-running workflows, create a checkpoint before context exhaustion and after any merge. Do not flood the repo with per-keystroke logs; record meaningful events.

## 17. Resumability / incident scenarios

- **Compaction:** reload this playbook, live ledger and audit sources; verify Git; resume the next `READY` task. Never claim remembered tests/changes not corroborated by code and log.
- **Interrupted dirty worktree:** do not reset or delete. Inspect `git diff`, untracked/ignored assets, worktree owners; preserve/reconstruct before continuing.
- **CI failure:** record exact failing command, fix and rerun. Do not mark a milestone verified until required checks pass.
- **Unknown test baseline:** rerun in safe profile. Label inability `BLOCKED` rather than importing stale results.
- **Sync mismatch:** disable native Dev writes, preserve journals and copied DB, record divergence and reproduction, resume only after root cause + golden.
- **Data migration interruption:** treat partial target as disposable, verify untouched source and backup; retry idempotent copy only. Do not delete old data.
- **Owner not available:** leave the dangerous dependent task `BLOCKED`, implement unrelated approved tasks, compile a short batched decision report.
- **Model handoff:** newest agent must trust repo evidence over predecessor's confident claims and must inspect code before marking work done.

## 18. Owner decision queue — required before relevant gates

The following were **unresolved in audit 15**. Do not fill in silently. Each has an engineering path that can proceed in Dev, but some final choices require owner input:

- C-1 Windows users/future, C-2 minimum OS, C-3 Mac MAS vs Developer ID/both, C-4 Ask Berean iPhone parity, C-5 shortcut conflicts, C-6 YouTube web island, C-7 privacy/location text, C-8 YouTube API key, C-9 pronunciation, C-10 intentional/editor lossy behavior, C-11 sync temporary JavaScriptCore vs direct Swift port, C-12 schema freeze, C-13 editor architecture/selection limits, C-14 vault/custom sync folder, C-15 Mac updater/Sparkle, C-16 floating/standalone windows and rail scope, C-17 minimum device for Voices.
- External D-1…D-10 include eSpeak/legal and dictionaries, Apple entitlements, App Review, Google API/sign-in, install base, text licensing and third-party identity continuity.
- Technical A-1…A-12 can be resolved from code; experiments B-1…B-21 require test/prototype/device. **Avoid interrupting owner for an answer code can provide.**

See Appendix C for all individual owner and experiment entries and audit 15 for necessary evidence/defaults.

## 19. Installation and initialization instructions

1. Place this file at `docs/native-migration/EXECUTION-PLAYBOOK.md` in the Berean repository.
2. Place companion `STATUS.md`, `TASKS.md`, `CHANGELOG.md`, `DECISIONS.md`, `HANDOFF.md` in the same directory. These are starter templates—not assertions that work happened. The agent must initialize them from Git/current tests.
3. Ensure all 18 audit Markdown files remain in `docs/native-migration-audit/` and the **actual** master-specification DOCX is at an identified accessible path; record the latter in `STATUS.md`. Convert the master spec to Markdown if convenient, but preserve the original and traceability.
4. Append the small `CLAUDE.md` bootstrap instruction from companion `CLAUDE_BOOTSTRAP_SNIPPET.md` to the repository's existing `CLAUDE.md` (do **not** replace it).
5. In Claude Code, run the supplied startup instruction in `CLAUDE_START_PROMPT.md`. The agent should read, initialize state, implement actual code, test, log and continue.
6. Version the living records with the code. Never paste secret tokens, private note content or user identifiers into them.

---

## Appendix A — Original audited feature matrix

This table is copied from `03-FEATURE-INVENTORY.md` section K, at its audited snapshot. It is included here so an agent can quickly inventory parity after compaction; individual feature sections in audit 03 carry the actual paths, limitations and test references.

| ID | Feature | Status | Plat | Verif | Diff | Doc |
|---|---|---|---|---|---|---|
| S01 | Text loading, bundled texts | implemented | M P | VERIFIED | 2 | S |
| S02 | Book/chapter/passage navigation | implemented | M P | VERIFIED | 3 | D |
| S03 | Reference parsing | implemented | M P | VERIFIED | 3 | D |
| S04 | Verse rendering and annotations | implemented | M P | VERIFIED | 5 | S |
| S05 | Strong's rendering and lexicon access | implemented | M P | VERIFIED | 3 | D |
| S06 | Interlinear | deferred | - | VERIFIED | 5 | D |
| S07 | Selection and copying | implemented | M P | VERIFIED | 4 | D |
| S08 | Verse context menus and actions | implemented | M P | VERIFIED | 2 | D |
| S09 | Multiple translations/editions | implemented | M P | VERIFIED | 2 | S |
| S10 | Reading position and history | implemented | M P | VERIFIED | 2 | D |
| S11 | Reading preferences | implemented | M P | VERIFIED | 2 | D |
| S12 | Cross-references | implemented | M P | VERIFIED | 3 | D |
| S13 | Parallel comparison | implemented | M P | VERIFIED | 3 | S |
| S14 | Very long chapter performance | implemented | M P | INFERRED | 4 | N |
| S15 | Find in chapter | implemented | M P | VERIFIED | 1 | D |
| S16 | Word replacer | implemented | M P | VERIFIED | 2 | N |
| Q01 | Scripture full-text search | implemented | M P | VERIFIED | 2 | D |
| Q02 | Reference search | implemented | M P | VERIFIED | 2 | D |
| Q03 | Strong's search | implemented | M P | VERIFIED | 2 | D |
| Q04 | Lexicon search | implemented | M P | VERIFIED | 2 | D |
| Q05 | Notes search | implemented | M P | VERIFIED | 2 | D |
| Q06 | Indexing | partial | M P | VERIFIED | 2 | N |
| Q07 | Filtering and ranking | partial | M P | VERIFIED | 3 | N |
| Q08 | Semantic search and embeddings | partial | M (dev) | VERIFIED | 4 | S |
| Q09 | Floating/unified search, palette | implemented | M P | VERIFIED | 4 | D |
| Q10 | YouTube transcript search | implemented | M P | VERIFIED | 2 | N |
| N01 | General, verse, daily notes | implemented | M P | VERIFIED | 2 | S |
| N02 | Markdown model and ProseMirror | implemented | M P | VERIFIED | 5 | S |
| N03 | Inline formatting and blocks | implemented | M P | VERIFIED | 5 | N |
| N04 | Tables | implemented | M P | INFERRED | 4 | N |
| N05 | Images and attachments | partial | M P | VERIFIED | 3 | D |
| N06 | Links, wikilinks, Scripture refs | implemented | M P | VERIFIED | 4 | D |
| N07 | Autosave | implemented | M P | VERIFIED | 3 | N |
| N08 | Undo/redo and version history | implemented | M P | VERIFIED | 2 | N |
| N09 | Export, import, print | implemented | M P | VERIFIED | 3 | N |
| N10 | Vault integration | implemented | M | VERIFIED | 4 | D |
| N11 | Folders, trash, pin, status, views | implemented | M P | VERIFIED | 3 | N |
| N12 | Daily notes, calendar, sunrise | implemented | M P | VERIFIED | 3 | N |
| N13 | Idiom/reference-book editor | implemented | M P | INFERRED | 2 | N |
| N14 | BibleGateway importer | implemented | M | VERIFIED | 4 | S |
| N15 | e-Sword importer | implemented | M | VERIFIED | 2 | N |
| H01 | Highlight storage | implemented | M P | VERIFIED | 1 | S |
| H02 | Verse/word/selection highlights, anchoring | implemented | M P | VERIFIED | 4 | S |
| H03 | Colours and categories | partial | M P | VERIFIED | 1 | S |
| H04 | Note/tag indicators | implemented | M P | VERIFIED | 2 | D |
| H05 | Cross-translation highlights | deferred | - | VERIFIED | 4 | S |
| H06 | Highlight sync | implemented | M P | VERIFIED | 3 | N |
| U01 | Spaces | implemented | M P | VERIFIED | 2 | D |
| U02 | Vertical tabs, sessions, archive | implemented | M P | VERIFIED | 4 | N |
| U03 | Pinned tabs | partial | M P | VERIFIED | 1 | X |
| U04 | Tab/session persistence | implemented | M P | VERIFIED | 3 | N |
| U05 | Workspaces and layouts | implemented | M P | VERIFIED | 4 | S |
| U06 | Resizable panels, drag and drop | implemented | M | VERIFIED | 3 | D |
| U07 | Multi-window, floating, presenter/viewer | implemented | M | VERIFIED | 5 | N |
| U08 | Navigation state and stacks | implemented | M P | VERIFIED | 3 | N |
| U09 | Menus, context actions, commands | implemented | M P | VERIFIED | 3 | D |
| U10 | Keyboard shortcuts | partial | M | INFERRED | 2 | S |
| U11 | Themes and appearance | implemented | M P | VERIFIED | 3 | N |
| U12 | Settings | implemented | M P | VERIFIED | 3 | N |
| U13 | Onboarding and hints | partial | M P | VERIFIED | 2 | S |
| U14 | Study Trail | implemented | M P | VERIFIED | 4 | N |
| U15 | Tasks panel | implemented | M | VERIFIED | 1 | N |
| U16 | Tags and tag graph | implemented | M P | VERIFIED | 3 | N |
| U17 | PDFs | partial | M P | INFERRED | 3 | N |
| U18 | Berean Chat | implemented | M P | VERIFIED | 3 | N |
| M01 | YouTube browsing and playback | implemented | M P | VERIFIED | 4 | S |
| M02 | Picture-in-Picture | partial | M P | VERIFIED | 4 | S |
| M03 | Video-linked notes, timestamps | implemented | M P | VERIFIED | 2 | S |
| M04 | Transcripts (dev-fetch, packs) | implemented | M P | VERIFIED | 3 | N |
| M05 | Read Aloud engine (Kokoro) | implemented | M P | VERIFIED | 5 | S |
| M06 | Audio playback, queue, background | implemented | M P | VERIFIED | 3 | N |
| M07 | Word-follow highlighting | implemented | M P | VERIFIED | 4 | N |
| M08 | Voice downloads and caching | implemented | M P | VERIFIED | 3 | N |
| M09 | Sleep timer (iPhone) | undocumented | P | VERIFIED | 1 | X |
| G01 | Ask: references/Strong's model-free | implemented | M P | VERIFIED | 4 | N |
| G02 | Local model runtime, picker, downloads | partial | M | VERIFIED | 5 | N |
| G03 | Modes, prose stripping, premise check | partial | M | VERIFIED | 4 | N |
| G04 | Deep Search, escalation, cancel | partial | M | VERIFIED | 4 | N |
| G05 | Collections, profiles, saved contexts | implemented | M P | VERIFIED | 3 | N |
| G06 | Verse-note influence, exclusion | partial | M | VERIFIED | 3 | N |
| G07 | Cloud model (BYO key) | partial | M | VERIFIED | 3 | N |
| G08 | Online research | partial | M P | VERIFIED | 2 | N |
| G09 | Evaluation harness | implemented | M (dev) | VERIFIED | 2 | N |
| G10 | iPhone Ask Berean (model-free) | partial | P | VERIFIED | 3 | N |
| A01 | iCloud sync journal | implemented | M P | VERIFIED (matrix BLOCKED) | 5 | N |
| A02 | Keychain / secure storage | partial | M | VERIFIED | 2 | N |
| A03 | App Groups, Share Extension | implemented | P | VERIFIED | 1 | N |
| A04 | Spotlight | implemented | P | VERIFIED | 1 | N |
| A05 | App Intents / Siri | implemented | P | VERIFIED | 1 | N |
| A06 | Deep links / URL schemes | implemented | M P | VERIFIED | 2 | N |
| A07 | Widget | implemented | P | VERIFIED | 1 | N |
| A08 | File access / providers | partial | M P | INFERRED | 2 | N |
| A09 | Notifications | deferred | - | VERIFIED | 1 | X |
| A10 | App lifecycle and updates | implemented | M P | VERIFIED | 2 | N |
| A11 | Entitlements, sandbox, identity | implemented | M P | VERIFIED | 2 | N |
| A12 | App Store requirements | partial | M P | INFERRED | 2 | N |
| A13 | Share/print to Files (iPhone) | implemented | P | VERIFIED | 2 | N |
| A14 | Accessibility | partial | P | INFERRED | 3 | N |
| A15 | Auto-update and distribution (Mac) | implemented | M | INFERRED | 2 | N |
| O02 | Crash report on next launch | implemented | M P | INFERRED | 1 | N |
| O03 | Hermas/Recognitions special handling | implemented | M P | VERIFIED | 2 | N |
| O04 | Data publication pipeline | implemented | dev | VERIFIED | 2 | N |
| O05 | Diagnostics and performance tooling | implemented | M P | VERIFIED | 2 | N |
| X-PiPstub | `PiPController.tsx` dead stub | abandoned | M | VERIFIED | 1 | S |
| X-dl | `electron/downloads/modelDownloader.ts` (tested, unused in production) | abandoned | M | VERIFIED | 1 | X |

## Appendix B — Original audited risk index

Risk IDs and summary labels from `12-RISK-REGISTER.md`. Consult that file for evidence, mitigations and fallback. These are risks, not necessarily currently observed defects.

| ID | Risk | Likelihood | Impact | Severity |
|---|---|---|---|---|
| R-01 | Data loss during first-run import | Medium | Critical | Critical |
| R-02 | Sync hash drift (S1, S12) | High | Critical | Critical |
| R-03 | Sync bookkeeping or tombstones dropped at import (S2, S3, S21) | Medium | Critical | Critical |
| R-04 | Native writes to the database or vault without capture (S24, S20, D4, D5) | Medium | High | High |
| R-05 | Device-id duplication across old and native copies (S4, S5, S22) | Medium | High | High |
| R-06 | Schema gating between old and new devices (S6, S7, S17) | High | High | High |
| R-07 | Retired devices holding unpublished edits (S8, S19, D1) | Medium | Critical | Critical |
| R-08 | Premature pull, compaction or folder cleanup (S15, S16, S17) | Medium | High | High |
| R-09 | Identifier, date and text normalisation drift (S10, S11, S12) | Medium | High | High |
| R-10 | Port inherits fixed sync defect classes (D1-D3, D5-D7, S18) | Medium | High | High |
| R-11 | Account and container mismatch (S13, S14, S25, D7) | Medium | High | High |
| R-12 | Bundle ID, team and container continuity broken | Low | Critical | High |
| R-13 | MAS versus direct-download data locations | High | High | High |
| R-14 | Sandboxed native app cannot reach DMG data | High | High | High |
| R-15 | Updater bridge for installed DMG users | High | High | High |
| R-16 | WKWebView and LevelDB localStorage state lost | High | High | High |
| R-17 | Non-portable secrets and sessions | High | Low | Low |
| R-18 | Windows users left behind | Medium | Medium | Medium |
| R-19 | Notes editor Markdown fidelity | High | Critical | Critical |
| R-20 | Parity ambiguity over formerly lossy behaviour (table cells) | Medium | Medium | Medium |
| R-21 | Highlight offset anchoring | Medium | High | High |
| R-22 | TextKit 2 stability and performance | Medium | High | High |
| R-23 | Kokoro G2P without eSpeak changes the voice | High | Medium | Medium |
| R-24 | eSpeak NG GPL exposure | Medium | High | High |
| R-25 | Neural Engine and background audio | Medium | Medium | Medium |
| R-26 | iPhone memory and jetsam | Medium | High | High |
| R-27 | Ask Berean without a bundled runtime | Medium | Medium | Medium |
| R-28 | App Store review | Medium | High | High |
| R-29 | Privacy policy inaccurate for a new submission | High | Medium | Medium |
| R-30 | YouTube Data API key in shipped bundles | Medium | Medium | Medium |
| R-31 | YouTube surface cannot be native | High | Medium | Medium |
| R-32 | Feature parity slippage | High | High | High |
| R-33 | Long dual-maintenance period | High | High | High |
| R-34 | Loss of momentum | Medium | High | High |
| R-35 | Single-developer capacity | High | High | High |
| R-36 | Minimum OS choices | Medium | Medium | Medium |
| R-37 | Test coverage gaps | High | High | High |
| R-38 | Migration backup and rollback gaps | Medium | High | High |
| R-39 | PDFs have no second copy | Medium | High | High |
| R-40 | SQLite engine and FTS differences | Medium | Medium | Medium |
| R-41 | OS-level contracts and deep links | Medium | Medium | Medium |
| R-42 | Lessons of fixed defects not carried into native code (S-8, S-17) | Medium | Medium | Medium |
| R-43 | iCloud dataless files and very large records | Medium | Medium | Medium |
| R-44 | Shortcut conflicts and muscle memory | High | Low | Low |

## Appendix C — Engineering experiments and owner/external decision index

These titles are reproduced from `15-OPEN-QUESTIONS-AND-DECISIONS.md` to preserve exact IDs. The original file explains what each decision blocks, who decides and any suggested default. Recheck current code before opening a new blocker.

| ID | Question / experiment / constraint | Category |
|---|---|---|
| A-1 | Which `localStorage` fields exist only in localStorage? | Resolve from code |
| A-2 | Which user data is absent from the vault sidecars? | Resolve from code |
| A-3 | Where is the `Cmd+Shift+M` handler, and what should `Cmd+L` do today? | Resolve from code |
| A-4 | How many synced entity kinds are there? | Resolve from code |
| A-5 | Which write paths bypass `data:changed`? | Resolve from code |
| A-6 | Can a user reach the values in `sync_conflicts`? | Resolve from code |
| A-7 | What are the consequences of the INFERRED sync behaviours? | Resolve from code |
| A-8 | Is the Windows build released and used? | Resolve from code |
| A-9 | Do `onnxruntime-node` and `sharp` ship in the packaged Mac app? | Resolve from code |
| A-10 | Is `feature/quick-open-tabs` merged at the audit commit? | Resolve from code |
| A-11 | Does `parseRef.ts` use regex features Swift `Regex` cannot match? | Resolve from code |
| A-12 | Reconcile the doc 08 and doc 04 statements on downgrade. | Resolve from code |
| B-1 | Does a TextKit 2 `NSTextView` hold 60 fps on Psalm 119 and a two-chapter scroll with 500 highlights? | Test or prototype |
| B-2 | Can `DisplayMap` reproduce every stored highlight position? | Test or prototype |
| B-3 | Does `NSTextTable` work under TextKit 2 on iOS 27 and macOS 27, and is TextKit 2 stable with custom fragments on long notes? | Test or prototype |
| B-4 | Can a Swift Markdown engine match the TypeScript bytes over the real note corpus? | Test or prototype |
| B-5 | Do Swift hashes equal TypeScript hashes? | Test or prototype |
| B-6 | Real-time factor, memory and thermals for Kokoro on a physical iPhone. | Test or prototype |
| B-7 | Does the Neural Engine run under the `audio` background mode on iOS 27? | Test or prototype |
| B-8 | How do non-eSpeak G2P options sound, and how does Yeshua sound today? | Test or prototype |
| B-9 | Does Developer ID support the iCloud Documents entitlement for a native DMG app? | Test or prototype |
| B-10 | Can a native app read Electron's `safeStorage` Keychain item? | Test or prototype |
| B-11 | Can a hidden `WKWebView` at `capacitor://localhost` dump the old localStorage? | Test or prototype |
| B-12 | Will the final Electron release accept a native app's signed zip through `electron-updater`? | Test or prototype |
| B-13 | Do Migration Assistant and backup restores preserve file birthtime? | Test or prototype |
| B-14 | Does programmatic PiP and Google sign-in work in a macOS `WKWebView`? | Test or prototype |
| B-15 | What are the iOS system SQLite version and FTS5 options on the deployment minimum, and GRDB's FTS5 requirements? | Test or prototype |
| B-16 | Is the iPhone account-token hash stable across relaunch and OS update? | Test or prototype |
| B-17 | How does real iCloud behave: timing, dataless reads, snapshot download of 4,552 files? | Test or prototype |
| B-18 | Do MAS security-scoped bookmarks survive the identity change? | Test or prototype |
| B-19 | Does gesture arbitration (edge-back, pager, native sheets) work on a device? | Test or prototype |
| B-20 | What are the baselines on the current app? | Test or prototype |
| B-21 | How does a real MAS install with data behave? | Test or prototype |
| C-1 | Fate of Windows users. | Owner decision |
| C-2 | Minimum OS versions. | Owner decision |
| C-3 | MAS versus direct distribution for the native Mac app. | Owner decision |
| C-4 | Does Ask Berean need parity on iPhone first? | Owner decision |
| C-5 | Shortcut conflicts: `Cmd+H`, `Cmd+G`, `Cmd+Shift+S`. | Owner decision |
| C-6 | Does YouTube stay web content? | Owner decision |
| C-7 | Privacy policy location wording (`docs/privacy.md`, and `privacy.html`). | Owner decision |
| C-8 | Google API key in shipped bundles. | Owner decision |
| C-9 | Yeshua pronunciation tuning. | Owner decision |
| C-10 | Known lossy behaviours: reproduce or fix in native. | Owner decision |
| C-11 | Sync engine path. | Owner decision |
| C-12 | Schema freeze during coexistence. | Owner decision |
| C-13 | Notes editor architecture and accepted limits. | Owner decision |
| C-14 | Vault location and the custom sync folder. | Owner decision |
| C-15 | Mac updater: Sparkle or MAS-only. | Owner decision |
| C-16 | Scope of standalone window and floating rail. | Owner decision |
| C-17 | Device floor for Berean Voices. | Owner decision |
| D-1 | eSpeak NG legal review. | External constraint |
| D-2 | Apple: Developer ID and the iCloud Documents entitlement. | External constraint |
| D-3 | Apple: Background Inference entitlement. | External constraint |
| D-4 | App Review. | External constraint |
| D-5 | No App Store downgrade; bundle identity is fixed by Apple. | External constraint |
| D-6 | Google: key restrictions, embedded sign-in, YouTube terms. | External constraint |
| D-7 | Install-base and usage data. | External constraint |
| D-8 | Licences of models, dictionaries and ports. | External constraint |
| D-9 | Bible text licensing. | External constraint |
| D-10 | Third-party identities the new app inherits. | External constraint |

## Appendix D — Minimum permanent acceptance certificate per milestone

Use the following record in `STATUS.md` or the PR description:

```
Milestone / Task ID:
Target branch / commit:
Mac build / launch (command + result):
iOS build / simulator / device (command + result):
Swift package tests (command + counts):
Legacy regression tests (command + counts):
Golden fixture revision and 100% / exception status:
Data migration / sync safety status:
Feature parity IDs covered:
Accessibility / performance results:
Known blocked device or external checks:
Data touched (Dev synthetic, copy, production — production requires owner authorization):
Rollback / recovery verified:
Gate decision: PASS | FAIL | BLOCKED — by whom, when, evidence:
Next ready task:
```

## Appendix E — Essential cross-document contradiction watchlist

- `CLAUDE.md` claimed six Mac layouts; current code at audit had **16**.
- `CLAUDE.md` listed wrong Bible table/column names; see database audit 04 and current DDL.
- Sync is **iCloud Documents journal**, not CloudKit records.
- Audit 05 registry says 24 entity types but audit 08/14 summarize 22—verify source before generating native registry.
- Raw Markdown mode references are stale; `Cmd+Shift+M` toggles Edit/View per audit 09.
- Note table-cell formatting loss was fixed after initial investigation (PR #10), so goldens must derive from stabilized/fresh code.
- iPhone App Intents existed (audit 07 corrected audit 03 partial read).
- `docs/privacy.md` asserted no location data, but sunrise uses location on-device, per audit 17.
- Some audit agents did not inspect every line, and many findings are INFERRED, UNVERIFIED or BLOCKED. **No document is a substitute for verification against current repo code.**
