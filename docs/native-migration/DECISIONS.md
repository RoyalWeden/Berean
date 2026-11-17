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
