# Berean Native Migration — Durable Architecture & Owner Decisions

> Do not invent approval. **PROPOSED** is not **ACCEPTED**. Audit 15 IDs remain open until explicitly resolved.

## ADR template
### ADR-XXXX — Title
- Date/time and author:
- Status: PROPOSED / ACCEPTED / REJECTED / SUPERSEDED
- Decision type: engineering / owner / external
- Problem and exact source evidence:
- Alternatives, including reversible fallback:
- Result and rationale:
- Compatibility/data/privacy/release consequences:
- Required tests and revisit trigger:
- Owner approval reference (when needed):
- Supersedes / superseded by:

## Recorded decisions

### ADR-0001 — Native project location and file format
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED (engineering, reversible)
- Problem: spec §3 asks for one Xcode build graph plus `Packages/BereanKit`. Xcode 27.2's New Project writes the
  new text `project.xcproj` format, which the GitHub `macos-latest` runner's Xcode cannot read.
- Result: `apple/Berean.xcodeproj` in the classic `project.pbxproj` format (objectVersion 77, file-system-synchronized
  folders `apple/BereanMac`, `apple/BereanIOS`, `apple/Shared`), build settings in `apple/Config/*.xcconfig`,
  local package reference `../Packages/BereanKit`. `Packages/BereanKit` is a SwiftPM package (tools 6.0, Swift 6
  language mode) so its tests run with plain `swift test` on any Mac.
- Alternatives: Xcode 27 `project.xcproj` (revisit once CI runners ship Xcode 27); XcodeGen/Tuist (not installed,
  extra dependency).
- Consequences: Electron `native/` (Liquid Glass bridge) and Capacitor `ios/` are untouched.

### ADR-0002 — Native development identities (M1–M3)
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED for M1–M3; the M4 part is PROPOSED (owner)
- Problem: native dev builds must never open production data or collide with the Capacitor/Electron
  "Berean Dev" (`com.berean.app.dev`, `iCloud.com.berean.app.dev`, `group.com.berean.app.dev`).
- Result: `com.berean.native.mac.dev` (sandboxed, hardened runtime, ad-hoc "Sign to Run Locally") and
  `com.berean.native.ios.dev` (automatic signing, no team committed). No iCloud container, no App Group, no URL
  scheme. `scripts/native/build.sh` fails the build if the built bundle id differs.
- PROPOSED for M4: interop tests need the native Dev apps to read/write the **Dev** container
  `iCloud.com.berean.app.dev` (never production). That needs the team's Dev entitlement on the new bundle ids —
  an owner decision, asked in the M4 batch.
- Production identity (`com.berean.app`, `iCloud.com.berean.app`, `group.com.berean.app`) is untouched; any change is
  a release decision (D-5, R-12).

### ADR-0003 — Trial deployment floor
- Date/author: 2026-11-07, Claude (engineering default from spec C2)
- Status: ACCEPTED as a trial; owner decision C-2 still OPEN
- Result: macOS 15.0 / iOS 18.0 in `apple/Config` and `Package.swift`; newer visual APIs behind availability checks.
- Revisit: install-base data (D-7), SQLite/TextKit evidence (B-1, B-3, B-15).

### ADR-0004 — Native build outputs stay inside the checkout
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Problem: `~/Berean-dev-builds` contents disappeared twice (F-03); outputs outside the repo are unaccounted for.
- Result: `scripts/native/build.sh` uses `-derivedDataPath build/apple/DerivedData` and `--scratch-path build/apple/swiftpm`
  (gitignored). Nothing is written to `~/Library/Developer/Xcode/DerivedData` or the home folder by the scripts.

### ADR-0005 — JavaScript-compatibility model and the golden oracle
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Problem: sync hashes are FNV-1a over the UTF-16 code units of `JSON.stringify` output (`engine.ts` `hashFields`,
  `merge.ts` `fieldHashes`). Swift `String` cannot hold unpaired surrogates, Swift string `<` is not JS `<`, and Swift
  dictionaries do not keep JS property order (array-index keys first).
- Result: `BereanCore` models JS values exactly: `JSString` = UTF-16 code units, `JSObject` = JS property order,
  `JSON.parse`/`JSON.stringify` per ECMA-262 (well-formed stringify, `Number::toString` layout over Swift's shortest
  round-trip digits). The TypeScript code is the oracle: `scripts/golden/corpus.ts` exports seeded fixtures with the
  sha256 of every source they pin; `tests/unit/goldenCorpus.test.ts` fails when TypeScript behaviour drifts from the
  committed fixtures; `BereanConformanceTests` must reproduce 100% of them.
- Revisit: any change to `src/platform/sync/*` → re-export, rerun `npm run native:test`.

### ADR-0006 — SQLite access: system SQLite first, GRDB prototype deferred to the user store
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED for read-only corpora; GRDB prototype still required before M3 (spec §3)
- Result: `BereanSQLite` is a thin wrapper over the system `libsqlite3` (no third-party dependency): read-only
  open (`SQLITE_OPEN_READONLY`), prepared statements, bound parameters, column cache. `BereanBible` ports
  `bibleService.ts` with identical SQL. GRDB is evaluated for the mutable store (WAL, migrations, observation)
  in M3-01, with this wrapper as the fallback.
- Evidence: bible.json golden — all 20 bundled texts' books, 3 chapters per book, verses and 316 searches match the
  TypeScript service, except equal-rank ordering (F-05).

### ADR-0007 — macOS 27 target and Xcode 27 in CI (implements OD-2)
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED (CI image availability verified by the PR's own CI run — see CHANGELOG)
- Result: `apple/Config/BereanMac.xcconfig` MACOSX_DEPLOYMENT_TARGET = 27.0.
- CI evidence (PR #16): GitHub's `macos-26` image offers Xcode 26.0 … 26.6 only — no Xcode 27, so no macOS 27 SDK. The native
  job therefore selects the newest installed Xcode, always runs the BereanKit conformance tests and the iOS Simulator build, and
  builds BereanMac only when an Xcode ≥ 27 is present. Until then the Mac build (`scripts/native/build.sh mac`, Xcode 27.2 locally)
  is a required pre-merge check recorded in each PR. Revisit when GitHub ships Xcode 27 or if the owner adds a self-hosted runner.
- BereanKit's Package.swift floor stays macOS 15 / iOS 18 (pure logic; no reason to restrict).

### ADR-0008 — Deterministic search ordering contract (implements OD-4, resolves F-05)
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Contract: relevance stays primary; a unique row id breaks ties.
  Scripture FTS: `ORDER BY rank, v.id` (verse row id = canonical book/chapter/verse insertion order) — bibleService.ts,
  electron/ipc/bible.ts (both copies), BereanBible. YouTube transcripts: `ORDER BY rank, s.id` (electron/ipc/youtube.ts) and
  `ORDER BY cand.rank, cand.rowid` (youtubeService.ts). Notes search (ordered by recency, not rank): `ORDER BY n.updated_at DESC, n.id`
  (notesService.ts ×2, electron/ipc/aiLookup.ts). The relevance function itself is unchanged.
- Evidence: bible.json exported on SQLite 3.51.2 (Node 24) and 3.53.4 (Node 22) is byte-identical (it differed before), and Swift on
  macOS SQLite 3.54.0 matches every one of the 316 searches exactly; the drift guard and Swift suite no longer allow tie-order
  differences. Regression tests: bibleService.contract.test.ts (equal-relevance order + SQL contract on all four FTS paths).
- User-visible effect: only the order of results that were exactly tied, now fixed instead of build-dependent.

### ADR-0009 — Native schema migrations by replaying the recorded TypeScript statements
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Problem: berean.db's 48 migrations (v1–v49, v18 deliberately absent) must be identical in the native store. Hand-porting
  ~1,300 lines of SQL invites drift; migrations 1–17 also contain data-dependent JavaScript (backfills, conditional ALTERs).
- Result: `scripts/golden/schema.ts` records every statement the TypeScript runs per version on a NEW database and generates
  `BereanStore/Generated/RecordedMigrations.swift`; `Migrator` replays it. Policy:
  new library → replay all; existing library ≥ v42 → replay pending steps; existing library ≤ v41 →
  `requiresLegacyUpgrade` (open once in the current Berean, which runs the JS logic). CORRECTION 2026-11-08: the first version of this
  ADR said "≥ v18 / pure SQL"; a proper per-version scan showed v42 (and many earlier steps) contain data-dependent JavaScript or
  try/catch ALTERs. v43–v49 are replay-safe (CREATE, SQL backfill, ALTERs behind hasColumn guards that are no-ops only on re-runs). newer than supported → refuse untouched;
  `PRAGMA quick_check` failure → refuse; pre-migration backup failure → STOP (stricter than legacy, per spec §5.1); failing step →
  rolled back, previous version kept. `migrate(to:)` lets a production build freeze at the production level (v48) while
  development uses v49 (spec: keep v48 production and v49 development distinct).
- Evidence: schema.json — Swift replay equals the TypeScript sqlite_master + seeded settings + schema_version at v17, v18, v43, v47,
  v48 and v49; v48→v49 upgrade equals fresh v49; refusal and rollback tests. Connections use WAL + foreign keys like electron/db/berean.ts.
- Drift guard: tests/unit/goldenCorpus.test.ts fails if bereanMigrations.ts changes without regenerating.

## Owner decisions — 2026-11-07 (second authorization message)

### OD-1 — Vault layout (resolves F-02)
- Status: ACCEPTED (owner delegated the choice; criteria: preserve notes/metadata, vault compatibility, sync reliability, minimal migration, maintainability)
- Result: keep the shipped layout (sidecar JSON at the vault root, `Verse Notes/`, `Daily/`, `YouTube/`, `Idioms/`, `.trash/`, `.attachments/`).
  The Octarine branch's only differences from main were moving sidecars into a hidden `.berean/` folder (one-time filesystem move)
  and a one-off `scripts/migrate-to-octarine.js`; its user-facing features (wikilink path normalisation, underline, emoji highlight
  colours) are already on main. Switching would require converting every existing vault and gives no data-safety or sync benefit.
- Branch retired: tagged `archive/octarine-vault-integration` (= `db074d1`, pushed to origin), then the local branch deleted.
  Also preserved in `~/Berean-backups/cleanup-2026-11-07/berean-refs.bundle`.

### OD-2 — Deployment targets (resolves C-2 for the native apps)
- Status: ACCEPTED. Native Mac: latest stable macOS — **macOS 27** (dev machine macOS 27.2, Xcode 27.2, SDK 27.2). Use current
  SwiftUI/AppKit, materials, Liquid Glass, toolbars, window management freely; no macOS 15 support needed.
  Native iOS: iOS 18 minimum for now, latest SDK. Electron/Capacitor targets unchanged. BereanKit (pure logic) keeps a lower floor.
- Consequence: CI must build with Xcode 27 (the default `macos-latest` image ships Xcode 26.6) — see ADR-0007.
- Supersedes ADR-0003 for the Mac app.

### OD-3 — Number-word search (F-04)
- Status: ACCEPTED — keep current behaviour (compatibility). Logged as a possible future search improvement; no migration time spent.

### OD-4 — Deterministic search ordering (F-05)
- Status: ACCEPTED — implement in BOTH legacy and native: keep FTS `rank` as the primary key and add a stable tie-breaker so equal-rank
  results order identically on every SQLite build. Regression tests + golden update. See ADR-0008 for the exact contract.

### OD-5 — Synchronization continuity (completes ADR-0002)
- Status: ACCEPTED. Native apps continue Berean's existing iCloud Documents journal sync — no CloudKit, no new store, no new history.
  Development native builds use `iCloud.com.berean.app.dev`; production native builds will use the existing production identity,
  container, App Group and entitlements at the release transition.
- Authorized now: configure and test native Dev builds against `iCloud.com.berean.app.dev` once the compatibility gates pass
  (hash/journal/tombstone/merge conformance), with controlled test records, separate native dev database copies, single-instance
  database locking, distinct device ids (never shared with the Capacitor/Electron Dev installs), and backups.
- Still prohibited: production sync writes, journal-format changes, resetting sync history.

## Findings resolved from code (audit 15 A-items and M0 investigations)

### F-01 — A-4 synced entity kinds (24 vs 22)
`src/platform/sync/entities.ts` registers 24 adapters, but `SYNCED_ENTITY_KINDS` (live change capture) lists 22:
`study_profile` and `ai_saved_context` are adapters without live capture (defect D6). Audit 05's "24" and audits
08/14's "22" are both right about different sets. The native registry must carry 24 adapters and fix D6 deliberately
(owner-visible behaviour change, tracked under M4-01).

### F-02 — Octarine branch `feature/octarine-vault-integration` (`f6b1b66`, `db074d1`)
The branch is superseded by the vault integration that shipped on main; its unmatched commits put the vault sidecar
data in a hidden `.berean/` folder, whereas main writes sidecars at the vault root. Branch KEPT (also in the cleanup
bundle). Owner question: keep the shipped vault-root layout (default) or revisit the hidden-folder idea? Deleting the
branch waits for that answer.

### F-03 — `~/Berean-dev-builds` disappearance
Evidence: `mac/` and `obsolete/` vanished 2026-10-25 16:41 (the same minute `dist/Electron.app` vanished), `ios/`
vanished 2026-11-06 21:27. DiskFox was first configured 2026-10-27, so it cannot explain 10-25 but is a candidate for
11-06; CleanupBuddy (a keyboard lock) is excluded; no Claude session, launchd or cron job in the records touched the
folder. Cause not proven — no blame assigned. Mitigation: ADR-0004.

## Open owner decisions (do not treat as approved)
| ID | Decision | Authority | Status | Refer to |
|---|---|---|---|---|
| C-1 | Windows support and Electron retirement | Owner | OPEN | Audit 15 C-1 |
| C-2 | Minimum iOS/macOS versions | Owner | RESOLVED for native apps — OD-2 (macOS 27, iOS 18) | 15 C-2 |
| C-3 | Native Mac MAS vs Developer ID vs both | Owner | OPEN | 15 C-3 |
| C-4 | Ask Berean iPhone parity scope | Owner | OPEN | 15 C-4 |
| C-5 | Keyboard shortcut conflicts | Owner | OPEN | 15 C-5 |
| C-6 | YouTube hosted WebKit exception | Owner | OPEN | 15 C-6 |
| C-7 | Privacy wording/labels | Owner | OPEN | 15 C-7 |
| C-8 | YouTube API key provisioning | Owner | OPEN | 15 C-8 |
| C-9 | Spoken-name pronunciation tuning | Owner | OPEN | 15 C-9 |
| C-10 | Legacy lossy Markdown behavior | Owner | OPEN | 15 C-10 |
| C-11 | Sync port strategy | Owner informed by tests | RESOLVED — OD-5 (continue existing journal sync; Swift port verified against TS) | 15 C-11 |
| C-12 | Schema freeze/coexistence | Owner | OPEN | 15 C-12 |
| C-13 | Native editor architecture/limits | Owner after spike | OPEN | 15 C-13 |
| C-14 | Vault/custom sync folder scope | Owner | OPEN | 15 C-14 |
| C-15 | Mac updater approach | Owner | OPEN | 15 C-15 |
| C-16 | Floating windows/rail scope | Owner | OPEN | 15 C-16 |
| C-17 | Voices minimum-device floor | Owner | OPEN | 15 C-17 |

Use the live table in audit 15 to identify the engineering A, experimental B and external D prerequisites; group owner questions rather than blocking all engineering work.

### F-04 — Number-word search expansion drops "twenty", "sixty", "eighty"
`src/lib/numberWords.ts` (and the main-process copy) set 20/60/80 to "score"/"threescore"/"fourscore" after the
regular tens, so "twenty" is never expanded to "20" and "20" expands to "score". Reproduced exactly in Swift
(`BibleText.numberTokenAlternates`). Candidate for the owner's lossy-behaviour decision C-10 (fix in both or keep).

### F-05 — FTS result order among equal ranks depends on the SQLite version (B-15 evidence)
`searchText` orders by `rank` only. For `love` scoped to JHN+1JN, Node's SQLite 3.51.2 and macOS's 3.54.0 return the
same 65 rows but order equal-rank ties differently (verified with the raw SQL in both). Electron's better-sqlite3 has its
own SQLite build, so the desktop order is already version-dependent. Conformance tests therefore require exact order
except within equal-rank ties, where the identical row set is required and reported. RESOLVED by OD-4 / ADR-0008.

### ADR-0010 — Native Mac navigation keeps the existing sidebar model (2026-11-08)
**Context.** The owner's review found that the native sidebar had stopped resembling Berean. Tabs were grouped
under Space headers, sessions sat in a small menu, and workspaces could only be found in Settings. A side-by-side
capture against the existing app (VISUAL-UX-PARITY.md) confirmed that the existing sidebar is a different model:
a session control in the header, a location field, "+ New Tab", and **one tab list in the user's own order**
(`sessionDisplayOrders` ⇄ synced `display_order_key`).

**Decision.**
- The native sidebar follows that model, built from native components: a `Menu` session switcher with tab counts
  and saved workspaces, a location field that opens ⌘K, New Tab, pinned tabs first and then the display order,
  type-coloured symbols, close on hover, and drag reorder that writes the display order.
- Saved workspaces get a sidebar section of their own; Settings keeps a management list.
- Archived tab groups are shown and restorable (`archived_groups`, tabs_json in the JS tab shape).
- Grouping by Space remains a per-viewer option (`@AppStorage`), off by default.
- The Scripture toolbar uses history ← → plus the passage pill (‹ book chapter ›, with a book/chapter popover),
  matching the existing toolbar.

**Rejected.**
- A horizontal tab strip: it wastes reading width and loses the user's order and the type cues.
- Spaces as top-level sidebar sections: the existing app dropped those in favour of the unified list.

**Compatibility.** No stored structure changed. The display order, pins, archived groups and workspace v2 JSON
use the existing columns and shapes.

### ADR-0011 — One user-facing "Workspace" over the existing sessions + saved workspaces (2026-11-08, owner request)
**Decision.** The UI shows one list of **Workspaces**. A live workspace is a `sessions` row; a saved workspace that is not open is a
`workspaces` row (a frozen v2 snapshot). Opening a saved one creates its session `ws:<id>`. From then on only the live entry is listed,
so nothing appears twice.

**Actions:**
- New: a session named "Workspace N".
- Rename: the session, plus its linked snapshot.
- Duplicate: a new session with fresh tab ids, the same states and order.
- Delete: the session plus its linked snapshot, or a snapshot that is not open. The last live workspace cannot be deleted.
- Save Snapshot… (secondary): writes a `workspaces` row.

**Compatibility.** No table is merged, rewritten or deleted. Old clients still see their sessions and Settings → Workspaces rows. The
storage unification is deferred until legacy clients retire (recorded in TASKS).

### ADR-0012 — Mac sidebar rows in the Arc/Yab style (2026-11-08, owner request)
**Reference.** The Yab manual (sidebar: window buttons, back/forward, pinned, tabs; density; edge resize). Yab was inspected installed
locally. Its manual does not describe the active-tab look; the owner's reference is the familiar Arc/Yab treatment: a raised, rounded,
near-white card on the translucent sidebar (light) or a lighter translucent card (dark), a soft hover fill, and a close × on hover.

**Decision.**
- A custom row (`SidebarTabRow`) replaces `List` selection: corner radius 10 (continuous), height 34, 13-pt text, type-coloured symbol,
  shadow 1.5.
- Live drag reordering: the row moves as the pointer enters a target (snappy 0.18 s); dropping into the pinned group pins the tab, and
  dropping outside it unpins.
- Empty sidebar space moves the window (AppKit `performDrag`; double-click zooms). The drag area stops at the title bar so the toolbar's
  sidebar button keeps its clicks.
- Back / Forward sit beside the system sidebar button and stay there when the sidebar is collapsed; ⌃⌘S toggles the sidebar.

**Not yet matched.** Pinned tabs as a grid of squares, edge-hover reveal of a hidden sidebar, density setting, hover preview cards.

### ADR-0013 — iPhone navigation: three fixed jobs (2026-11-08, owner request §17)
**Problem.** The existing iPhone app spread actions over the plus sheet (destinations, experiences, recent places, search), the caret
(commands plus go-to), tab cards (sessions, archive, sort, select) and More pages. The native Plus opened a clipped 520-pt palette with
no visible actions, so it looked broken.

**Decision.** The bottom bar has exactly three buttons, each with one job, in the same place on every screen:
- **Tabs** (left): this workspace's tabs, the Workspaces page and archived tabs.
- **New** (centre, prominent): one field (reference / Strong's / words), plus Scripture (continue reading), New Note, Today's Note, Notes,
  and Recent passages.
- **More** (right): the current tab's commands (Back / Forward, Cross References, chapter notes, Strong's, Compare), then Duplicate /
  Close Tab, then Settings (always last).

The passage pill in the top bar opens the passage navigator (book / chapter / text / history). The old plus sheet's "experiences"
(History, Calendar, Study Trail, Tags…) arrive as those features land, under New.

**Workflow comparison (taps, from the reader):**

| Task | Existing iPhone app | Native |
|---|---|---|
| Open a book and chapter | title → picker → book → chapter (4) | pill → book → chapter (3) |
| Search Scripture | plus → type → Return (2 + typing) | New → type → Return (2 + typing) |
| New note | plus → New Note (2) | New → New Note (2) |
| Switch tab | tab cards → card (2) | Tabs → row (2) |
| Change workspace | tab cards → Workspaces chip → row (3) | Tabs → workspace row → workspace (3) |
| Cross references | verse → sheet → Refs (3) | More → Cross References (2) |
| Highlight / tag a verse | verse → sheet → action (3) | verse number → action (2) |
| Previous passage | caret → ‹ (2) | More → Back (2) |

### ADR-0014 — Notes editor: live preview over the verbatim Markdown source (2026-11-08, owner request §4)
**Problem.** The owner wants a formatted editor with no visible Markdown. Notes must keep the ProseMirror dialect exactly: callouts,
columns, threads, Study Trail embeds, tables, coloured highlights, images and wikilinks. A native rich-text model that re-serializes on
save risks rewriting or dropping constructs it does not fully understand.

**Decision.** The editor's text storage is the note's Markdown, unchanged. `BereanNotes.MarkdownLiveSpans` computes styling spans:
- markup characters become null glyphs (no width, no caret stops — the caret skips them);
- list markers draw as "•", task boxes as □ / ☑, and callout markers as their label ("Note:");
- headings, bold, italic, underline, strike, code, highlights, links and wikilinks get native fonts and colours;
- tables use monospace with faint pipes, and berean:* structure comment lines are hidden but kept.

Edits change only what the user typed, so saving cannot rewrite anything else. Formatting commands insert the dialect's own markup
(⌘B `**`, ⌘I `*`, ⌘U `<u>`, ⇧⌘X `~~`, ⇧⌘H `==`, ⌥⌘1–3 headings, ⇧⌘8 bullets). View ▸ Show Markdown Source (⇧⌘M) remains an explicit
advanced action.

**Clipboard.**
- Copy: RTF (formatted) + plain text + `com.berean.note-markdown` (the source, used when pasting back into a note).
- Copy as Plain Text (⌥⇧⌘C, and in the context / edit menu): readable text only.
- Paste: the note type when present, otherwise plain text.

**Limitations (tracked).** Tables are styled source, not a grid editor; images show their alt text, not the picture; columns and threads
show their content without the side-by-side or thread chrome. A full structured editor remains M7-02.

### ADR-0015 — Reader navigation reuses eligible tabs (2026-11-12)

- iPhone’s labeled Tabs / Go / More dock supersedes the center Plus presentation in ADR-0013. Go opens a destination in the active compatible unpinned tab in its Space, another eligible tab, or a new tab when needed. iPhone Scripture search results reuse a reader. Tabs → New Tab provides deliberate creation. Mac command behavior is preserved.
- iPhone chapter text uses UIKit TextKit with the same display-to-storage highlight offsets as Mac. Verse and Strong’s links keep their affordance through position and color with no underline.
- Calendar persists only the existing month and selected date keys. It uses the same daily-note date lookup and deterministic create path as Today’s Note. Native sunrise-aware Today remains open.

## 2026-11-14 evening (Claude Code) — decisions taken during the parity/polish session

- **D-2026-11-14-a Mac pointer:** a global `resetCursorRects` hook (`apple/BereanMac/ClickableCursor.swift`) gives every enabled
  NSButton / NSSegmentedControl / NSToolbarItemViewer the pointing hand; disabled toolbar items keep the arrow. SwiftUI plain buttons use
  `.interactivePlain`; native-look menus/pickers may add `clickableCursor()`. Reason: SwiftUI `pointerStyle` cannot reach AppKit-hosted controls.
- **D-2026-11-14-b No new tab-state keys:** Lexicon search query lives in memory (`AppModel.lexiconSearches`); a Lexicon tab with
  `strongsNum: ""` is the search view. Annotation hiding uses the existing `hiddenAnnotations`; workspace icons store the original Lucide names.
- **D-2026-11-14-c Search tab:** a single-verse query shows that verse's cross references (original auto mode); chapter references still navigate.
- **D-2026-11-14-d Daily notes:** the editor shows the long date (Saturday = Sabbath) read-only; the stored "Daily — YYYY-MM-DD" title is untouched.
- **D-2026-11-14-e Generated tables:** Psalm superscriptions (`PsalmTitleData.swift`) and BDB abbreviations (`BdbNotes.swift`) are generated
  from the TS sources; regenerate rather than hand-edit.
- **D-2026-11-14-f Compare layout:** grid vs stacked is chosen by measured width (≥ 280 pt per column), not `ViewThatFits`; iOS-only
  modifiers must be wrapped as whole modifiers (an empty macOS `.safeAreaInset` collapsed Compare — MAC-FUNC-037).

## 2026-11-15 (Claude Code, 00:00–01:44)

- **D-2026-11-15-a In-memory UI state, no new tab keys:** note-return pill (`AppModel.noteReturn`), lexicon search query, iPhone tab
  layout (`@AppStorage("tabCardsLayout")`) and chrome hiding are local; synced tab state only uses keys the Electron app already knows
  (`bookIds`, `scopeTexts`, `hiddenAnnotations`, `status`, `folderId`).
- **D-2026-11-15-b Tab-type switch = open new + close old** (`AppModel.switchTab`), never mutating a tab's `type` in storage.
- **D-2026-11-15-c Display-only daily titles:** daily notes/tabs/history show long or compact dates; stored titles unchanged.
- **D-2026-11-15-d Note references auto-link** by reusing the `berean-note:` route (passage first, then note title) instead of a new scheme.
- **D-2026-11-15-e Auto em dash** follows the original: on by default, never converts dashes that start a line (keeps `---` dividers).

## 2026-11-17 current-location search

- Explicit palette search replacement uses the search scope described by the selected action and clears previous result restrictions. Sort and grouping remain presentation preferences. History identifies a Search destination by query and result-defining filters, including the focused edition.
- Command-L changes a Compare tab's anchor passage while retaining Compare and its column-following rules. Mac runtime verified replacement and Back in a pinned tab.

## 2026-11-17 Notes browse presentation

- Gallery is a device-local Notes preference under `nativeNotesHomeLayout`. List is the default. The same note button supplies activation, selection and context actions for both presentations.
- Native Notes `listFolderId` is persisted with local tab state. It already exists in the legacy NoteTabState model. Its absence from the allow-list caused a verified relaunch reset. The sync field set and database schema keep their existing contracts.

## 2026-11-17 Notes section navigation

- Notes disclosure state is scoped to folder and grouping and stored locally. Search shows every matching result regardless of browse disclosure state.
- Bulk selection explicitly names Select Visible when sections are collapsed. Existing selections retain their counts and actions across disclosure changes.
- Folder note opening records the clicked note as its return anchor. A collapsed destination uses the section heading as a fallback.

## 2026-11-17 voice quality and native browse controls

- Owner explicitly rejected Apple speech voices for quality. Native Read Aloud must use the original Kokoro/Berean Voices quality path, including the model integrity and licensing gates in the master specification.
- Native Notes navigation uses full-row targets with leading multiline content. Mac folder groups use rectangular Liquid Glass on current systems and material fallback on earlier supported systems.
- Cursor resolution uses delivered event coordinates and registered SwiftUI intent regions after AppKit dispatch. Explicit SwiftUI enabled state takes priority over a toolbar wrapper with an unavailable enabled-state accessor.

## 2026-11-17 home browsing and rendered control hits

- Mac Notes home uses the existing per-tab Notes position store with a nil folder location. Direct destination anchors take priority on return, with a Recently Edited fallback for removed recent entries.
- Notes editor return labels follow the destination used by the existing return action.
- SwiftUI rendered controls may hit an enclosing hosting view. Passive cursor regions accept that relationship within their clipped event bounds. Unmanaged hits remain under native cursor ownership and are visible to opt-in diagnostics.

### 2026-11-17 — iPhone Notes home scroll ownership

Use a grouped ScrollView with explicit stable targets for iPhone Notes home. The initial native List compiled but failed the observed recent-note return; replacing it preserved the grouped appearance and made explicit anchor return work. Retain device-local per-tab state and missing-recent fallback. Do not claim idle touch-scroll restoration from this explicit-return evidence. Native switches are separate NSControl instances and need cursor handling alongside NSButton and NSSegmentedControl.

### 2026-11-17 — Location editing owns a tab identity

Cmd+L is explicit replacement of the active tab even across content types and Spaces. It takes priority over matching another destination tab, including a pinned destination. Preserve source ID, pin and global order. Move the source record between Space buckets and keep a full typed location snapshot for history. Ordinary navigation may still reuse an existing destination; explicit New Tab creates one. Use the existing compatible tab-row upsert rather than adding a schema or duplicate tab identity.

### 2026-11-17 — Source-preserving note completion

Complete note-title wikilinks through native text edits rather than replacing the Markdown-backed editor or converting source to attachments. Validate the trigger against the current selection/content when accepting a suggestion. Query titles only, preserving legacy title-based links and avoiding note content/image loading. Restrict this increment to safe note titles; book/chapter suggestions remain a separate N06 gap. Mac keyboard/pointer and iPhone touch choice share the same source helper.

### 2026-11-17 — Auxiliary search state is a navigation location

A Notes query/filter snapshot or Lexicon query/language belongs to Back/Forward even when the tab type and ID stay fixed. External Lexicon navigation seeds the visible view through a tab-scoped request; local typing remains a debounced search. Persist settled Lexicon queries through the existing searchQuery/searchLang allow-list, with no schema or new sync fields. Nil Notes history options mean default/unfiltered options. Explicit completion undo is owned as a literal inverse edit, separate from native typing coalescing.

### 2026-11-17 — Lexicon results retain local viewport state

Key live offsets by tab, query, and language. Store the current offset in existing device-local `searchScrollTop` and capture the live value in history. Start explicitly seeded searches at zero. Keep query and language in the established sync allow-list. The current search task owns result publication through typing, Clear, and Return.

Measure bounded Lexicon search rows eagerly so language changes do not use lazy height estimates when restoring offsets. This is limited to the small SQL-capped search result set.

### 2026-11-17 — Preview only the selected note

Preserve the title-only completion index. Read one selected note for a bounded plain excerpt and formatted attachment reference, in a task keyed by target identity. Keep typing/insertion owned by the editor and omit preview where editor height is constrained. Original [[ targets notes; Scripture/Strong's block suggestions are separate workflows.

### 2026-11-17 — Optional dictionary restore assignment

Evaluate the active-tab fallback as an explicitly typed String? before storing in [SpaceId:String?]. Its subscript assignment expects String?? and can otherwise lift a nil preferred value into .some(nil), bypassing the fallback. Keep the regression matrix for public Parsed mutations as well as normal parse paths.

### 2026-11-17 — Plain reference suggestions preserve note source

Use existing Notes suggestion settings and native undo. Resolve preview content asynchronously and require a matching note, caret and full source before editing. Strong’s uses original dictionary copy text. Scripture requires all requested verses and uses the resolved edition and Word Replacer, preserving the LXX marker where applicable.

### 2026-11-18 — Contextual Notes creation and bounded cursor ownership

Use the folder’s meaning when creating: Scripture notes choose an attachment; daily notes choose a local day and reuse NotesService’s existing daily identity. Folder expansion is explicit, device-local and collapsed by default, independent of note-group section collapse. Keep whole-row opening separate from a44pt disclosure target. Cursor regions must include both real window-space bounds and local visible bounds; checking only visibleRect permitted distant controls to claim passive space. Preserve native text and resize ownership. Keep navigation icons in one intrinsic-width cluster so Forward cannot alone disappear into overflow.

### 2026-11-18 — Compare uses real corpus availability; native highlights follow readable glyphs
Validate comparison candidates against mapped chapterNumbers rather than catalog counts. Preserve unavailable saved records and expose repair/removal instead of silently retargeting or deleting their metadata. Keep raw-column keys for existing history/scroll even when the visible projection excludes an unavailable column. Mac verse context actions belong in the existing context menu, retaining touch menus on iPhone.

For native character selection and saved highlights, derive each fill from the character range, readable glyph horizontal bounds and line used height. Exclude bereanSkip controls while preserving their intentional tag/hover fills. Do not intersect with paragraph-fill rectangles, whose blank regions are the defect being replaced. Keep selection/copy/persisted offset semantics intact. The actual shared renderer has an offscreen AppKit regression in CI.

### 2026-11-18 — Daily dates in the folder; formatting owns its Undo
Keep daily discovery inside the DailyNotes folder, with month navigation and day-presence markers, while reusing the existing daily identity/open path. The calendar month is presentation-local; no new persisted/sync fields. Keep standalone Calendar available for timeline/sunrise features. Expose Checklist/Table as direct Mac toolbar actions alongside broader menus. Treat every explicit Mac formatting edit as separate from native typing, using the same validated inverse registration already used for completion.

NotesHome uses an explicit accessible large iPhone heading and inline empty navigation title because persistent search above its independent scrolling body can leave UIKit’s large-title area blank after tab/editor transitions. This heading is fixed; do not claim native collapsing behavior.

### 2026-11-18 — Chapter turns require a fresh edge gesture
Record eligible top/bottom edges when direct dragging starts. Do not turn a chapter merely because a long ordinary scroll arrives at its boundary. Use separate arm/disarm distances so ready feedback tolerates small retreats but users can retract before release. Keep momentum, cancelled/selection-blocked gestures and unavailable destinations ineligible. Physical sensitivity remains a runtime acceptance item.

### 2026-11-18 — Neural ReadAloud uses its original latency policy
Keep Kokoro’s12/40-word startup/streaming policy separate from WebSpeech’s cutoff-oriented chunks. Preserve UTF16 positions and blank/multi-word slots so replacements do not shift word highlighting. Plan chunks from already-prepared speech tokens; do not change theological/display substitutions in the chunker. Validate against generated original TypeScript fixtures; no Apple speech fallback. This foundation is not a playback engine.

### 2026-11-18 — Prepared speech owns its alignment string
Return prepared speech text, preserving spaces used by word offsets, rather than a raw collapsed text string that disagrees with prepared tokens. Apply display/text and Strong’s rules before spoken-only preparation. Preserve blank suppressed-the slots and multi-word replacements as one reader word slot. Correct the original plain path as the oracle; this changes speech cache content hashes, not user IDs/schema/sync. Reuse original native ONNX inference work; no Apple speech fallback or unverified replacement model.

### 2026-11-18 — Hover metadata is not reader content
Keep asynchronous Strong’s tooltip values out of the reader’s content/style render key. Update only tooltip attributes on existing links, preserving text/selection and avoiding full chapter replacement/scroll restoration. Chapter pull intent uses actual finger travel plus a calibrated indirect overscroll fallback and evaluates release; do not infer physical sensitivity from simulator attempts that delivered zero input.

### 2026-11-18 — Reading geometry is bounded local presentation
Store native reader geometry under local-only nativeReaderPositions, separate from legacy numeric scrollPosition and synced passage destination. Use explicit recency because canonical JSON reorders keys. Validate finite geometry and cap records to24 per tab. Keep edition-return navigation hints memory-only. Checkpoint settled scrolling plus lifecycle and clear only the requested edition on deliberate passage jumps.


Native speech prototype18Nov: compile phoneme/intonation/dictionary resources from the exact pinned engine revision. Voice initialization precedes dictionary compilation. Keep this opt-in probe separate from app dependencies until resource packaging/license and complete Kokoro token/audio compatibility are established. Test Mac and simulator against the original phonemizer, without synthesis or user library access.

18Nov current-query Notes results: cached synchronous lookup may enrich previews, but a mismatched cache cannot suppress current-query content rows. Render bounded fresh hits as fallback, matching submit behavior; use text-change lifecycle for synchronous cache refresh. Preserve FTS semantics. Keep QA signing/container configuration consistent and inspect open DB path when fixtures unexpectedly differ.


18Nov note title presentation: permit up to5 wrapped visible title lines while retaining single-line stored metadata. Collapse pasted/input line breaks to spaces, keep daily titles read-only, and keep Return/Next advancing to body.


18Nov Kokoro compatibility: preserve original phonemizer resource data and synthesis-trace IPA semantics rather than assuming current upstream tables or directTextToPhonemes are identical. Expanded cases proved vowel/stress differences. Keep engine/resources in opt-in probe pending packaging/integrity/G2P licensing gate; only UI-free KokoroEnglish preprocessing enters shared app code. Never patch pronunciation ad hoc to hide backend drift.

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
Use documented dynamic UIGestureRecognizer failure priority for rapid different-verse body intent (touch timestamps within500ms), rather than UITouch.tapCount: actual UIKit double-tap crossed verses while public tapCount stayed1. Marker taps are controls; non-verse links remain UIKit-owned. Preserve native same-body double-tap/longpress and clear whole-verse mode only after a meaningful native range survives the representable update. No private recognizer class conditions, no delegate replacement. See HANDOFF for traces and rejected tapCount prototype.


### 2026-11-18 — Reader release and sidebar restoration
A passive touch observer can receive release while UIScrollView still tracks. Runtime proved an explicit incoming START was later overwritten by outgoing deceleration; one queue turn alone also failed. Use public tracking/dragging flags with a weak, passage/token-guarded release gate, then stopScrollingAndZooming before navigation. Preserve ordinary scrolling momentum. Restore shown-sidebar .automatic toolbar placement at the user’s direction; retain grouped controls and stable accessibility IDs. Keep pin/title layout stable while the pin moves into the adjacent hover slot.

### 2026-11-18 — Body-first Brenton Psalm display, raw identity preserved
User clarified title + first body belong to verse1, following Bible Hub/BiblIndex Brenton presentation. Supersedes the short-lived separately numbered-title decision. Fold title rows only with a complete first body, number bodies from1, preserve source IDs and annotation offsets. Human reference entry converts to source IDs; persisted native links retain legacy semantics. Exact split/combined Psalm correspondence runs remain authoritative. LXX chapter numbers remain LXX.


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


## 2026-11-19 — Psalm title ownership and quiet correspondence metadata

A Psalm superscription belongs to the opening body verse, with one marker at the group's beginning. Native typography uses a line separator inside the group rather than a title paragraph plus a second number. This follows the requested body-first presentation; stored source IDs and body annotation offsets stay unchanged. iPhone title taps use the same passive verse-selection intent as body taps and leave long-press text selection native.

Keep long versification explanations out of the reading flow. Add native summary/detail accessors beside the unchanged legacy ChapterMap API; summaries are secondary links, full text appears in an on-demand native popover. “About this edition” deliberately avoids suggesting an exact one-to-one KJV destination for structural differences. ONLINE-BRENTON.md records source witnesses and the deliberate4–5 vs eBible4a convention. Do not generalize website MT headings into LXX chapter numbers or silently reinterpret saved raw links.


## 2026-11-19 — native references, toolbar responsiveness and Strong’s continuity

- 42d34bbe: additive native cross-reference APIs map verified stored LXX rows to canonical sources; correct chapter grouping and combined-record aggregation. Legacy service entry points/goldens remain intact. Classic/TSKe selected and chapter UI checked on both apps; structural unverified alignments remain open.
- fce2b88e: native navigation ControlGroup replaces fixed-size HStack; measured Mac toolbar CPU loop resolved while retaining sidebar titlebar placement. Baseline99.5% CPU/AX20–40s → idle0–3.3%/AX0.1–0.4s. This supersedes prior automation-latency diagnosis; broader physical interaction checks remain.
- 3bbecdea: native readers retain the visible body line when Strong’s toggles, preferring a visible selected verse and excluding inline metadata from anchor offsets. Mac selected/unselected and iPhone mid-chapter on/off verified; physical phone and full edge/width matrix pending.
- Validation: full202 shared tests; final6 focused cross-reference checks include all151 Psalms source bounds. Fresh reader intent/reflow harness passes Unicode/metadata mapping and prior tap/adjacency checks. Both final native builds pass. See current HANDOFF for exact logs, QA restoration and remaining tasks; source corpus/production/sync/identities unchanged.

Implementation decisions: keep reader-specific canonical mapping additive so Electron golden APIs retain their contract; use actual prepared row order as the grouping authority. Use the native navigation control group to avoid competing toolbar intrinsic-width calculations. Keep Strong’s reflow anchors transient and word-based, without changing saved highlights, selection identities or tab history. Preserve chapter-start behavior and clamp naturally at document edges.


## 2026-11-19 — Compare selection and floating actions (d6f7cced)

Each edition now owns its selectable verse numbers and action target. Additive taps/Mac Shift use actual stored row order; selection itself does not change the anchor passage or history. Adjacent visible selected rows share one faint/dashed outline; stacked interleaved editions remain outside each other’s outlines. Reduced Motion pauses animation. The adaptive glass action bar reuses reader control styling and supports copy/highlight/tag/note/reference/reader/share/clear operations. iPhone dock safe-area clearance was verified after an initial hidden-bar failure. Mac Command-C was verified after fixing a focus-routing failure. Clearing and exiting Compare does not restore an old selection. Shared title rendering uses the Scripture font and folds source title newlines.

Both local Dev builds and the expanded native reader harness pass. Mac LXX50/KJV51 copy and action destinations, Mac Shift group/Escape, and iPhone stacked selection/copy feedback/reader transfer/final dock gap/clear-exit passed. See HANDOFF for exact logs and QA restoration. No note contents/timestamps changed;4 Mac/9 iPhone tabs preserved. Prior baselinecce95bf0 CI44493859591 is green, including203 shared tests; this is not evidence for the new source’s pending CI.

Remaining before full Compare parity: view-state retention across tabs/relaunch, independent/pinned/cross-chapter/duplicate/4-column/width/accessibility matrix, actual mutation-and-undo action checks, native word-copy precedence, body-tap selection, selected-line reveal, and whole-block drag previews/grab-anywhere. Generic arbitrary-tab splitting and Kokoro playback remain separate open work.

Decision: Compare selection uses a typed column destination and actual chapter/edition scope. Never infer action IDs by converting the main reader’s verse number. Geometry joins must account for other editions interleaved in stacked layouts. Reuse the reader’s styles/formatter rather than adding a competing action-control design. This first implementation is transient view state; persistent retention must be added explicitly without changing legacy column metadata or sync identities.


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

## 2026-11-19 — Own iPhone formatting selections in undo

Use the existing explicit source replacement for every programmatic format edit, not only edits containing table dividers. UIKit native replace preserved characters on Undo/Redo but collapsed the Redo selection in the touch test, so another action targeted a caret. Register inverse source and before/after ranges consistently, validate them before mutation, and keep ordinary native typing separate. This does not implement nested style editing or claim IME/coalescing parity.

## 2026-11-19 — Semantic style toggles and ambiguous legacy table links

Use renderer semantic ranges rather than adjacent punctuation to decide whether a visible styled selection already has a mark. Validate resulting plain text and preservation of overlapping style coverage before accepting a combined edit. Do not silently normalize table wiki targets: actual legacy serializer output collides for Title and a distinct Title ending in one backslash. Keep raw link identities unchanged until context-aware resolution/ambiguity handling is implemented; evidence is in NOTE-TABLE-LINK-COMPATIBILITY.md.

## 2026-11-19 — Validate partial styling across the whole note

Joining Foundation's style fragments only across hidden source syntax recovers enclosing marks without crossing unstyled visible text. Validate candidates using unhidden characters and global visible-position semantic coverage, including link/wiki/code/image identities, so splitting a mark cannot alter neighbouring styles. Ignore whitespace-only style changes around split delimiters; retain source whitespace verbatim. Native Undo/Redo restores exact source/selection rather than depending on a second toggle to reconstruct identical syntax. Whole-source mixed edits remain a separate unfinished operation.

## 2026-11-19 — Keep pane composition separate from document identities

Begin all-tab splits with a process-local pure value tree and separate layout history. Leaves refer to existing tab IDs; remove pane removes a view, not a tab. Reject duplicate live tab views, stale/foreign payloads and geometry below explicit per-leaf minima; revalidate at commit. Focus changes are not layout undo operations. Existing legacy panelLayout, workspace serializers and sync remain untouched until compatibility is proven. Host-level same-note/different-tab coordination and focused command routing are prerequisites for enabling UI.

## 2026-11-19 — Explicit content identity before split focus

Extract a MacTabContentHost(tabID:) and retain only one visible host while validating existing behavior. Rendering must resolve the supplied document rather than silently using a global active tab. Keep the outgoing-inspector guard and view IDs unchanged. This alone does not make hosted commands safe in background panes: resolve focused toolbar/inspector/navigation/save ownership and same-note coordination before enabling multi-host UI.

## 2026-11-19 — Document constraints and focus scope before UI routing

Keep sidebar selection separate from tab creation: focus an existing visible tab, otherwise replace the focused leaf's document while preserving pane/sibling IDs. Key minimum sizes by tab identity to validate the new document, and recompute after type conversions. Compact focused presentation projects one leaf without discarding the tiled tree. Scoped command targets check current window/workspace/pane/tab/focus, but do not replace operation-specific revisions/cancellation or grant permissions. Wire a per-window coordinator before enabling multi-pane UI.

## 2026-11-19 — Reader annotation workflow

User accepts workflow changes to protect reading. Tag labels are organizational metadata shown in the study tool, not inline commentary. One neutral personal-study marker represents attached notes/tags; built-in cross refs stay contextual rather than marking nearly every verse. Personal-note citations remain distinct until a unified destination chooser preserves their meaning and direct access. No storage migration.

## 2026-11-19 — Personal references and follow-up queue

One consistent personal-study entry replaces separate notes/tag/citation decorations. Attached Notes and related passages remain explicit separate destinations. Ordinary-note body references earn verse indicators; whole-chapter mentions do not mark every verse. Reference grammar/candidate limits/edition behavior unchanged. Preserve concurrent QA user edits; subsequent Mac UI tests need isolated library and preferences.

## 2026-11-19 — Automation QA isolation

Debug-only named QA library/preferences now implemented; regular behavior/identities unchanged. Live named-suite writes and parser safety checked; full255tests/both builds pass. Use only the separate app path/profile in QA-PROFILES.md; preserve concurrent shared-QA user edits. Notes controls/viewport follow-up is validated in the worktree.

## 2026-11-19 — Study controls and viewport lifecycle

Restore native reader position on actual attachment/layout readiness, not a guessed single run-loop dispatch. Latest pending intent replaces earlier queued action, stale passage/target guards remain, zero-size captures rejected. Avoid observable app writes at momentum handoff. Keep Notes primary and metadata secondary; consolidate scope/sort into search menu, preserve choices. Physical smoothness is not proved by CUA wheel events.

### 2026-11-19 — table commands follow retained selection

Use the native editor’s retained selection, not first-responder identity, for table context: opening a toolbar menu legitimately takes focus. Coalesce context publication outside representable updates, publish only changes, and keep existing mutation guards/undo records. Reuse semantic preview conversion before truncation; never rewrite saved note source to hide syntax.

### 2026-11-19 — stable share anchors, readable sharing and typed sheet intent

A transient menu item cannot own a persistent system-share anchor: keep the native source view behind its toolbar Menu and present after menu dismissal. Ordinary Share sends readable note text; source/identity-preserving Markdown belongs to explicitly named export/copy actions. BDB dictionary paragraphs have an English base direction with natural Hebrew runs, represented in native text attributes rather than copied direction-control characters. Present iPhone Go using an identifiable request carrying the immutable new-tab intent: separate presentation/mode state reproduced stale mode capture in real UI.

### 2026-11-19 — native layout bursts and reference presentation

Restoring once after attachment is insufficient when a native inspector subsequently reflows the reader through multiple widths. Apply immediately and retain one guarded geometry-sensitive intent through the initial quiet window, yielding to actual input. Avoid persisting temporary geometry during restore. Native animations outside that initial restoration remain intact. Automatic Strong’s detection uses the legacy shared preference key and changes styling, not source or explicit links. Personal reference candidates use indexed chapter tokens plus the real parser, not a canonical-name UI search or arbitrary search-page cap; do not silently discard older/abbreviated citations for speed.

## 2026-11-19 — Strong’s backlinks are lexicon relationships

A bare Strong’s mention or explicit lexicon destination belongs in that lexicon entry’s My Notes disclosure; it does not imply a passage relationship. Wiki Strong’s-looking titles remain Notes identities. Automatic detection preferences govern presentation, not existence of read-only source relationships. Use an ephemeral revision-aware index parsed off the UI actor; preserve the live-note source and no page cap. A note’s top Back returns to its still-live recorded source tab across tab types; source closure falls back to its Notes folder. iPhone More groups secondary commands while leaving Settings direct. HANDOFF records runtime proof and remaining history/performance/compact gates.

## 2026-11-19 — Stable window study inspector and usable widths

The native window owns one inspector; document hosts supply content. A late setter still targets its captured active reader identity. Retain actual native pane width after layout quiet, not inset SwiftUI content width or intermediate opening frames. Preserve native resizing and cursor ownership. Sidebar minimum240, study minimum320, window content minimum1000; native traits and content frames both enforce restored bounds, including inline study layouts. Keep Notes quiet grouped surfaces and search controls together. Current full-window/future multi-pane focus routing and first constrained Compare reflow remain separate unfinished gates. Reference the final HANDOFF entry before claiming all transitions or physical cursor behavior fixed.

## 2026-11-19 — Native image and cursor ownership boundaries

Use the existing rendered Compare content as the native drag image, at backing resolution and original pickup offset; avoid a second reconstructed SwiftUI preview whose font, width and scroll differ. Keep drag-image capture ephemeral; opt-in artifacts only in named DEBUG QA profiles. Destinations accept same-controller moves and reject stale active-tab/Compare/passage payloads.

Divider geometry must use NSSplitView.arrangedSubviews, including intentional full-main-pane overlap beneath anchored sidebar/inspector glass. Subviews also contain decorations. Own only narrow native-divider tracking regions and preserve them when unchanged; no delegate replacement, swizzling, global cursor monitor or forced app activation. Real inactive-window synthetic input is not evidence of key-window hover correctness.

Divider cursor geometry also honors the existing public native delegate effectiveRect and connected narrow additional gutter methods. Query, never replace, the native delegate. This retains wider/disabled native targets and avoids assigning resize cursors to separate broad header controls. Standalone regression covers each case.

## 2026-11-19 — Drag source follows geometry, not a representable closure

SwiftUI can share a hosting view across Compare recognizers; after reorder, the first recognizer may represent another column. Resolve exactly one live source from actual registered fragments containing the initial pickup, then notify the source payload. Do not use a union bounding rectangle to select a source in interleaved stacked mode. Snapshot only that source’s fragments, leaving other-edition gaps blank. Complete the native recognizer explicitly when dragging consumes mouse-up; retain single-click/double-click handling. Real consecutive UI moves are required; unattached recognizer state setters do not simulate AppKit’s gesture engine.

## 2026-11-19 — Table structure and keyboard action density

Block prefixes cannot preserve a GFM grid inside a cell. Keep inline style/link/reference edits available; reject paragraph/list/callout/nested-table insertion when their covered paragraphs overlap an actual table. Use the existing parsed table ranges, preserve literal-pipe prose/fenced code and UTF16/newline boundaries, and disable incompatible UI entry points. Do not silently rewrite imported table source.

Use6prose/5table iPhone accessory controls with native glass grouping and flexibleWidth. Cell navigation belongs in the Table menu plus existing Tab/ShiftTab, preserving direct Undo/Redo/Formatting/Table/Hide. Seven separate controls overflowed, so removing essential actions into system overflow was rejected. Refresh navigation with uncached deferred native menu content; avoid cached action availability and retain the editor selection across menus. Respect the existing haptics setting.

## 2026-11-19 — Study markers and automatic dictionary blocks

Dictionary blocks use two-line plaintext compatibility, native body font, neutral rounded container and semibold heading; no source conversion. Chapter-level study uses a quiet symbol, category marker primary material plus summary; avoid adding all-source reference markers to every verse. Notes select reader-prepared Psalm rows, rejecting half a combined record. Rule browser ships as a browser/master control; per-rule editing waits for one revision-aware rules pipeline, preserving unknown persisted fields and defaults/order.

## 2026-11-19 — Aligned cited-passage previews

A note icon must imply an attached note, not any study metadata. Chapter mentions/references use the related-passages symbol; tags use tag. Keep mentions separate from passage counts. Hover previews load lazily, show referenced Scripture rather than only labels, settle content before presentation and use native text-input screen geometry. QA-only Option-click is rendering evidence, not physical hover proof.

## 2026-11-19 — Owner-required continuous AI handover documentation

Owner explicitly requires durable notes for Codex, Claude Code and any successor throughout work, with HANDOFF as the one entry point. Added AI-CONTINUITY (startup/checkpoint/coordination/safety), OWNER-PRINCIPLES (current decisions and supersessions), CURRENT-STATE (verified source/runtime/evidence/next steps) and DOCUMENTATION-MAP (task-oriented links). Root AGENTS.md and CLAUDE.md route native work to HANDOFF. Replaced the mixed current block with one concise checkpoint; archived the former block verbatim with SHA256 and retained the entire committed historical log. Continuous updates are an ongoing requirement, not a one-time completed migration feature. Preserve dirty work, identities, original data, review guards, actual test scope and the distinction between prototypes/QA entries and delivered parity. Latest snapshot preparation UTC2026-11-20T05:57:54+00:00.

## 2026-11-19 — Verify native note blocks; preserve editable source

Canonical lookup is required before Scripture card presentation; missing/incomplete rows stay plain rather than accepting a structural guess. Use the same reader Psalm mapping and Word Replacer text, keep raw storage IDs/UTF16 source/Undo, and reject stale async work at both model and native layout boundaries. Ratio cache is context-scoped/bounded and applies to every duplicate occurrence. Suggestions, auto-linking and formatting use separate legacy keys; formatting defaultsfalse/threshold0.9. Rich/imported and read-only/index parity are not inferred from plain editor cards.

On iPhone use native Settings category navigation matching Mac panes instead of a single long Form. Haptics belongs under Appearance; existing bindings are retained. Six routes/Back/Done and shortcut filtering were checked. Mac pane structure unchanged. Source7e8142f9/evidence SCRIPTURE-BLOCKS-2026-11-19.


## 2026-11-20 — Reader-aligned note labels and iPhone editor removal

Source334eafbb: native LXX Psalm attachments use reader labels/ranges while raw IDs/legacy golden formatter remain unchanged. Owner-scoped editor teardown fixes tested iPhone focused-note Trash/dock recovery without restart. Six new regressions;296shared tests/both builds PASS; real Mac+iPhone label/link checks and iPhone accessory-keyboard workflow PASS. All20/25prior notes,37/47active IDs/alltags preserved, owned fixtures recoverablytrashed. Physical/software-keyboard/multiple-editor UI matrix and Mac right-divider return drift remainOPEN. See [evidence](NOTE-LABELS-EDITOR-LIFECYCLE-2026-11-20.md) and CURRENT-STATE for live review/CI/runtime. Owner completed final Ollama shortcut removal; verified absent. Broad migrationACTIVE.


### ADR-0016 — Rendered Presenter pause, scoped message addresses and native window commands

- Date/author:2026-11-20, Codex. Status: ACCEPTED (engineering, reversible), under the owner's Presenter/Messages quality request.
- Presenter pause retains a rendered value snapshot and focus/selection, rather than an ID whose content can change later. Resume loads the current source. Shared reader numbering, annotations and replacements apply before snapshot creation.
- Message IDs remain unchanged in storage. UI addresses combine conversation ID and raw message ID because legacy conversations may reuse IDs. The same address owns scrolling, replies and edits; tests prove no cross-conversation mutation.
- Drafts are local SceneStorage per conversation; no sync/table format is added. Save failures retain work. Messages reading uses the existing Markdown renderer, with optional intrinsic width; all prior callers retain expanding behavior.
- Replace the native saveItem Close group, rather than registering a competing⌘W. Study-only actions are disabled in auxiliary windows. Main and auxiliary close behavior passed actual UI checks.
- Only one Mac NavigationSplitView column registers native search toolbar; the sidebar uses an inline field. Two searchable columns crashed during insertion. Explicit toolbar IDs and repeated open/close verification are required.
- iPhone underlap extends only the native scroll surface by measured safe insets. Floating controls retain their safe outer layout; direct ignoresSafeArea attempts placed hidden-dock actions below the home indicator and were rejected.
- Inspector width uses a one-shot public NSSplitView restoration after actual visible geometry, yielding to resize input. Three older SwiftUI-only attempts failed and remain rejected. Manual/constrained matrix is open.
- No production/sync/schema/raw identity changes. Review/merge guards remain. [Evidence and remaining gates](PRESENTER-MESSAGES-POLISH-2026-11-20.md).


### ADR-0017 — Ephemeral Chat reference links and native multiline composition

- Date/author:2026-11-20, Codex. Status: ACCEPTED (engineering, reversible).
- Restore original Chat auto-reference behavior through an ephemeral Markdown rendering copy. Reuse existing note reference recognition and Strong’s exclusions, protect code/existing links/images/URLs, preserve visible Unicode characters and raw stored source. Chat does not become personal-note citation-index content. Internal navigation uses ordinary reuse and reveals the main document.
- Use composite message addresses in a declarative scroll layout, with a bottom anchor only for the initial offset. Do not force every subsequent size change to the end of the conversation.
- iPhone composition uses a bounded native UITextView with ordinary state/delegate focus and smart quotes/dashes disabled. Return inserts a line break; explicit Send/Command-Return send. A SwiftUI FocusState binding directly on the UIKit wrapper and unbounded TextEditor layout were rejected by actual UI checks. Source formats and identities remain compatible.
- Evidence and remaining gates: [Presenter/Messages polish](PRESENTER-MESSAGES-POLISH-2026-11-20.md). No broader feature-parity completion claim.


## 2026-11-21 — Calm Presenter and native controls

Presenter uses the reader's font/spacing/numbers/palette rather than a separate serif design. A pause freezes document, focus, selection and effective appearance; latest selection or scroll intent determines live focus. Smaller chapter metadata and grouped zoom/reset controls retain audience readability. Source a4fcc429; Compare secondary follow is separate pending work.

Use plain named native preset choices: decorative“Aa”swatches replaced accessible theme names in menus and hid choices on iPhone. Keep swatches in custom-theme editing. Custom margin fields permit legacy arbitrary fractions alongside quarter-inch steps, patch only changed settings and preserve unknown fields. Never rewrite imported source merely to edit one option (da8aecce).

Sanitize message excerpts only at the UI boundary, leaving legacy preview/title grammar and source untouched (81938ff0). Preserve result-summary fallback when semantic body is blank, and avoid repeated filtering across sidebar groups. Image block suffixes render inline unless another image starts the suffix, preventing accidental heading/divider reinterpretation (16067d57). The owner resumed after the restart; prior Nov20 deadline is superseded.


### Nov21 Presenter follow-up — source1e9eeed7+6a50adc6
Settled reopen now uses the retained reader viewport; live observation remains subscribed and grouped zoom controls expose distinct names/actions. Mac build and actual reopened13→19/livefollow/zoom actions pass. Cold startup with restored audience still starts at top before reader settles: explicitly OPEN; source seeding alone did not fix it. Compare active-secondary projection and explicit same-chapter jump matrix remainOPEN. Detailed next implementation packet in PRESENTER-REFINEMENT-2026-11-21.md. Original QA rows and exact37/47activeIDs preserved. Broad goalACTIVE.


### Nov21 startup correction — ada385b1
Supersedes reproduced startup selection-overwrite above: transient highlight snapshots no longer request focus; deliberate verse selection/clear/destination still does. Both builds PASS; actual fresh startup stays at savedverse7/selected1, explicitverse8 focuses8; original state restored. No persisted format/schema changes. Wider multi-window/paused/edition/history matrix remainsOPEN. Focused evidence has exact scope and next steps.

### 2026-11-21 — History restoration, lifecycle diagnostics and scroll surfaces

- Give an incoming Scripture history viewport a scoped, one-shot restoration request. Hydrate its matching cache entry before exposing the restored tab and suppress the selection reveal until restoration finishes. Preserve ordinary reveal when the snapshot lacks usable geometry. iPhone programmatic reader jumps checkpoint their destination so reverse history captures the new viewport. [Implementation and tests](HISTORY-VIEWPORT-RESTORATION-2026-11-21.md)
- Store full MetricKit call stacks locally and acknowledge dismissal with a canonical fingerprint. Record content-free lifecycle timing to measure the synchronous save candidate while retaining durable saves. The physical watchdog attribution remains open. [Investigation](IOS-WATCHDOG-2026-11-21.md)
- Keep iPhone glass on the individual floating controls and hide the top scroll-edge effect where available. Adjust only the iPhone text inset. For Mac floating search, use the same immediate visibility state for content and title-bar scrims, with query focus requested on presentation.

For a newly mounted Mac reader only, keep the completed history intent through the existing geometry-settling burst. The first valid application completes the model request once; later geometry corrections require no newer restore and cancel on native input. This fixes the reproduced +26-point cross-type drift without extending warm same-host restores or delaying presentation (7118fff8, actual repeated round trips checked).


### 2026-11-21 — Compare focused-column audience (8ae5e4a6)

Mac Presenter now uses a validated, atomic transient projection of the selected comparison column, including its actual edition/chapter, highlights and reading focus. Both platforms build; actual LXX Exodus 32:2 audience wording and pause → switch tab → resume pass. Shared layout/anchor decisions are consistent across available columns and widths. No persistence/schema changes. Mapped/availability/reorder/removal/clear/scroll matrices and full multi-column mirroring remain open. A separate tab-switch/pane-reflow drift remains open; do not claim all tab transitions preserve first-frame geometry. See PRESENTER-REFINEMENT-2026-11-21.md and CURRENT-STATE for exact QA state/evidence.


### 2026-11-21 — Inspector lifetime and final history settling

8252c91c validates the live inspector target across same-ID tab replacement and updates only its open state. Mac actual Lexicon/Search replacements retain the UUID and contain no leaked Scripture fields; inspector toggle works. 852a4767 corrects the final AppKit origin-only shift during newly mounted history restoration: repeated actual Search round trips preserve446 points, immediate user scrolling wins, and its new position survives history. Final Mac build passes; temporary diagnostics removed. Later changes are Mac-only; shared package unchanged since349-test pass. See TAB-LIFECYCLE-2026-11-21.md for trace, bounded evidence, current QA geometry and remaining accessibility/first-frame/history/Compare matrix. Earlier geometry readings were affected by AX divider adjustment; controlled no-write tab switching was stable. Do not close the broad reflow requirement from that narrow check.


### 2026-11-21 — Prepared verse rows and active Mac toolbar ownership

- Drive the compact iPhone grid from prepared reader rows rather than row count. Use their display and accessibility labels and submit the stored verse identity directly. Give the iPhone clear and keyboard-dismiss controls 44-point targets and preserve Mac compact dimensions.
- Own the Mac title in the active tab host. Gate reader toolbar registration and picker mutations by the live tab type, identity, mode and passage. Close old popovers as ownership changes. An initial visibility guard blocked Return submission as the popover dismissed. The final callback uses live ownership and the picker’s single-pick guard. [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md)


### 2026-11-21 — Compare selection belongs to the history visit

Copy the matching Compare selection into the existing bounded session history entry. Capture the outgoing visit before installing the remapped destination cache. Restoration replaces or evicts the matching cache and uses a tab- and passage-scoped revision with the same helper for load and same-chapter returns. Explicit verse commands still clear or reseed selection. Reader selection has value equality. The history change leaves schemas, sync and persisted selection untouched. Keep viewport transfer separate so it can follow the actual rendered layout and be verified independently. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md)


## 2026-11-21 — Paused Compare columns checkpoint

Local source6fbba670 keeps iPhone Compare side by side with horizontal overflow, compact matching headers/cells, tighter inline verse numbers, no per-verse ellipsis, and complete compact-row selection bounds. Global Close Column is e31b8d87. Shared layout arrivals preserve verified raw verse/source-grid identity instead of stale incompatible offsets. Final Mac+iOS builds pass. Actual iPhone horizontal/vertical scrolling, Sync off/on near10, close3→2, survivor retention and joined text-tap selection verified in bounded scope; final compact selection includes its first number. Mac final runtime, pinned→following and explicit-jump/rapid/accessibility checks remain open. Owner requested pause; not pushed. Next design request is Compare grouped naturally with passage picker. [Precise checkpoint](COMPARE-VIEWPORT-2026-11-21.md).


## 2026-11-21 — Discoverable iPhone reading controls

Source0819f846 adds direct Strong’s left of passage picker and Compare/Manage in the existing top row, removing the extra44pt Compare band. Both chapter arrows always remain; long names wrap in two lines, LXX appears on the edition-switch button. Actual Simulator Song of Solomon1LXX full-title/Strong’s on-off/lexicon lookup/CompareExit passes; build scopes and remaining375pt/VoiceOver/physical checks are in [focused evidence](IOS-READER-CONTROLS-2026-11-21.md). The ordinary changing foreground gap remains OPEN (measured AEL case stable; no inset hack). Source3bb05740 further widens iPhone-only text with6/10/22pt insets; desktop widths unchanged. Rejected arrow-hiding and separate-LXX-row candidates were not committed. Broad migration active.

## 2026-11-21 — Verse clipboard contract

Use the original copy layout across the native verse-text actions. A single whole verse uses one line, and multiple verses use a reference header and numbered body lines. Keep gaps in the reference and use the original LXX-only edition suffix. A genuine LXX Psalm superscription belongs to the displayed first verse, so whole-verse copy includes it. Omit generated missing-verse notices. Partial Copy with Reference uses the selected words, plain text selection remains plain, and reference-only actions emit only the reference. Cross-reference Copy retains its LXX-only verse-text rule. [Verse-copy evidence](VERSE-COPY-PARITY-2026-11-21.md).

## 2026-11-22 — Compare follows closed-reader navigation

Shared CompareColumn now updates following saved columns on real reader passage changes even while Compare is closed. Pins, independent legacy columns, explicit replacements and history snapshots retain their behavior. Both builds, red-before/green-after isolated state probe, Mac close/navigation/reentry with Back/Forward, and iPhone mixed follower/independent reentry pass. Already-stranded ambiguous records remain preserved; use explicit Follow Main Passage. Physical/relaunch/expanded UI matrix and durable viewport work remain open. [Evidence and compatibility](COMPARE-REENTRY-2026-11-22.md).

## 2026-11-22 — Rich note previews on both platforms

Source7ccbc3ca replaces flat snippets with rich attributed rows and bounded document thumbnails for gallery/iPhone tabs. Valid Markdown stays hidden; headings, links, wiki aliases, underlines, highlights, lists/callouts and table grids render; code remains literal. No note storage/editor rewrite. Final both builds and10focused parser checks pass. Actual Mac gallery/history and iPhone peek/table-tab/tap verified; final iPhone thumbnail retains button role. Original row hashes/37+47IDs/22+26notes pass. Physical/VoiceOver/large-type/imported-dialect/performance matrix remains open. [Detailed evidence](NOTE-PREVIEWS-2026-11-22.md).

## 2026-11-23 — Audit engineering decisions

- Study Trail merge preserves tags and manually written recaps. Move and split carry descendant connections and anchored sticky notes. Keep historical pause intervals as recorded and guard the active recording anchor. An interleaved merge has no guaranteed inverse through Split.
- Slash completion validates the source range and applies its text and formatting in one undoable edit. Board bulk operations share the displayed card set. Wide tables wrap as an interim content-preserving layout while horizontal grid editing remains open. [Audit coverage](CLAUDE-AUDIT-2026-11-23.md)


Nov23 final follow-up: owner rejected excerpts with too little context. Final source `6fc04d7e` keeps bounded surrounding phrases; actual rebuilt Mac H776 confirms readable context and visible matches. Final Mac/iOS context builds and372package tests passed. iPhone snippet and broader interaction checks remain open; see CLAUDE-AUDIT-2026-11-23.md.


## Nov23 — per-visit Compare reading positions

Source `d349bf41` records immutable passage-scoped viewport maps in in-tab history, reruns same-mounted restoration and protects saved bookmarks from early/stale callbacks. Both native builds and extracted snapshot probe pass. Actual Mac independent Compare→lexicon→Back retains logical verses; two separate visits to the same Exodus32 comparison remain distinct through Back/Forward. Exact independent intra-row pixels, durable restart storage, iPhone history runtime and aligned/stacked/rapid/selection matrices remain OPEN. See COMPARE-VIEWPORT-2026-11-21.md and COMPARE-PERSISTENCE-NEXT-2026-11-23.md. No sync/schema/identity changes; original QA rows and37/47active tab IDs preserved. Broad migration ACTIVE.


## Nov23 — durable semantic Compare bookmarks

`5f83fd65`/`ccab93fc` add bounded device-local anchors keyed by stable column identity and passage, preserving exact per-visit history priority. `e17c1762` keeps column metadata in legacy Compare and persists identical-destination reorders. Both native builds,377sharedtests,5802legacytests, typecheck and lint pass. Actual Mac independent/aligned cold and swapped-column cold; iPhone aligned cold and distinct-visit Back/Forward pass. Exact independent intra-row positions, Mac stacked/iPhone independent and wider jump/reflow/accessibility matrices remain OPEN. No schema/signing/corpus/production writes; watched QA original content and37/47activeIDs retained. [Architecture, failures and exact evidence](COMPARE-DURABLE-2026-11-23.md). Broad migration ACTIVE.

## 2026-11-23 — Readable occurrences and local Compare precision
- Occurrence excerpts use one bounded wrapping word window, with spare budget backfilled near the verse end. Preserve original word indices and full-verse copy; avoid a second visual cutoff that hides the match/context in narrow panes. Compact14/full20words are current defaults; visual evidence is scoped in LEXICON-EXCERPTS-2026-11-23.md.
- Exact Compare crop is optional device-local metadata validated against a render fingerprint and row height; changed layout falls back to semantic raw verse. Immutable history visits stay separate from latest durable destinations. Use measured native normalized offsets and row crops after lazy materialization, with bounded correction and immediate genuine-interaction/new-jump supersession. Do not guess padding offsets or introduce fades/fixed delays.
- Required next engineering: persist a bounded active history visit locally so cold quit after olderBack preserves that visit without overwriting newer destination bookmarks. This is not owner-gated; packet includes empty-visit/partialpane/quit-before-settle tests.
- Every AI must stage verified owner-folder builds and provide final simple Terminal commands. Preserve clean/ancestry/signing/review guards; never install a stale device product after failed build. No physical installation during readiness verification.

## 2026-11-23 — Concise picker labels and precise interaction regions
Use work-relative names in passage selection (Clement Book 1…10; Hermas section names), retaining canonical reference names and identities. Native selectable linked text must derive cursor rectangles from actual glyphs, so links advertise navigation without turning ordinary text or blank space into a clickable region. Search result hover should distinguish the row action while keeping separate action menus independent. Independent Compare's current history visit is local state distinct from the bounded latest-destination cache; changing one pane must preserve the other pane's historical position. See the focused Nov23 picker/cursor and active-visit evidence for verification limits.

## Nov23 — Native reference peeks and Compare gesture ownership
Mac Notes Strong’s hover uses existing styled link glyphs, a 350 ms dwell and a read-only native popover. No note mutation, auto-block insertion or navigation occurs on hover. Cancel on content/context/scroll/key-window changes and guard asynchronous results by generation; preserve keyboard focus. This adds the original editor’s preview interaction separately from detection, block suggestions and backlinks.

Compare linked verses use native text layout for cursor and selection consistency. Public SwiftUI layout explicitly forwards the equivalent first text baseline because NSViewRepresentable does not expose it automatically; a plain NSView override was tested and proved insufficient. Single-click drag lifts the whole Compare column before NSTextView enters its selection loop; ordinary mouse clicks and double-click word selection still pass through. The original whole-column grab workflow takes priority for that gesture; keyboard and double-click selection remain available. No global event monitor or cursor warp was added. Actual independent Mac reorder and post-drag link/number clicks were verified; wider layout and physical pointer matrices remain open.


### November 23 — Search visits and result context

Keep bounded device-local Search row bookmarks in the existing filters object and separately store the active visit. Use canonical fingerprints for configuration and rendered context. Use centered alignment for result return and an explicit rowless visit for the actual top edge, preserving older centered visits. iPhone Search uses an inline navigation title to keep the settled field position through result return. [Search viewport evidence](SEARCH-VIEWPORT-2026-11-23.md)


### November 23 — Chapter Find and scoped book groups

Use a top iPhone Find surface with separate temporary match highlighting so the bottom dock and text or verse selection retain their existing roles. Group Search by canonical scoped book ID for Bible editions and by work for other texts. Capture edition focus before exclusive tab update. [iPhone Find evidence](IOS-FIND-VISIBILITY-2026-11-23.md) [Search book filters](SEARCH-BOOK-FILTERS-2026-11-23.md)

### November 26 — Anchor the study popover to the marker glyph

Use TextKit attachment bounds for both the rounded hover surface and popover anchor. The input-client rectangle placed the arrow above the observed marker. Keep preview reads lazy, linked passages first and note excerpts as fallback. Use native motion preferences and the isolated Option-click route for card geometry and content checks. [Study indicator evidence](VERSE-STUDY-INDICATORS-2026-11-26.md)


### November 26 — Platform picker layout and shared Compare geometry

Select the desktop picker layout on Mac at the shared picker boundary and keep chapter-preview eligibility independent of layout. Store shared Compare crops alongside semantic row identity and validate compatible measured geometry before correction. Keep the active visit distinct from the latest destination. [Desktop picker evidence](DESKTOP-PASSAGE-PICKER-2026-11-26.md) [Shared Compare evidence](COMPARE-SHARED-PRECISION-2026-11-26.md)


### November 26 — Reader and tool menu follow-through

Use measured Mac native clearance through inspector reflow. Keep Strong’s markers bound to their word, red coloring on supplied italic words inside speech, and compact book labels distinct from their accessibility names. Preserve Calendar’s existing reuse path and expose History from Study Tools. [Integration review](INTEGRATION-REVIEW-2026-11-26.md)
