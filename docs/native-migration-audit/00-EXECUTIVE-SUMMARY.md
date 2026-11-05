# 00 — Executive Summary

**Audited code:** see `16-AUDIT-HANDOFF.md` for the exact commit. **Status of the migration:** not started and not authorised.

## Verdict

**Moving Berean to fully native Swift is feasible on both macOS and iOS, with no fundamental technical blocker found.** (INFERRED from the evidence below. Nothing native was built.)

It's a very large job. Three pieces are real engineering risk rather than translation work, and their outcome should be proved by experiment before the plan is trusted: the notes editor, Read Aloud on a real iPhone, and sync compatibility.

| Question | Answer | Label |
|---|---|---|
| Fully native macOS | Feasible. SwiftUI shell with AppKit for the pane layout and Scripture text | INFERRED |
| Fully native iOS | Feasible. Much of the platform layer already exists in Swift | INFERRED |
| Existing data can be kept | Yes. One SQLite file that native Apple SQLite opens as it is, including FTS5 | VERIFIED |
| Existing sync can be reused | Yes, if the native code is byte-compatible. It is iCloud Documents journals, not CloudKit | VERIFIED |
| Same voices natively | Very likely, but proven only on the simulator, on CPU | INFERRED |
| Native notes editor at full parity | Feasible as custom work. No off-the-shelf component does it | INFERRED |

## Most difficult components

1. **Notes editor.** ProseMirror with a private Markdown dialect. SwiftUI `TextEditor` can't do it. Best candidate is TextKit 2 with custom blocks. A byte-stable Swift Markdown engine has to come first, and `swift-markdown` doesn't fit (09).
2. **Sync.** A custom journal engine where a different hash means reverted edits on every device (05).
3. **Read Aloud.** Model inference already runs in Swift. The text-to-phoneme step uses eSpeak NG, which is GPLv3+, and iPhone performance is unproven (09).
4. **Scripture rendering with highlights.** Highlights are stored as offsets in plain verse text, so a native view needs an exact display-to-plain map (06).
5. **Mac workspace.** Panels, tabs, spaces, multiple windows and the presenter window. AppKit materially beats SwiftUI here (06).
6. **Ask Berean.** 4,156 lines in the Electron main process, with a separate model-free version on iPhone and no bundled model runtime yet (03).

## Most important risks

| Risk | Why it matters |
|---|---|
| Sync hash drift | A subtle difference in Swift reverts real edits everywhere |
| Dropping sync bookkeeping during import | Purged notes come back on all devices |
| Schema number raised during coexistence | Older devices stop pulling from that device |
| `localStorage` left behind | Word replacer rules, custom themes and chat drafts live only there |
| Mac DMG users | A sandboxed app can't see their data without consent or an export |
| Limited iPhone rollback | The App Store doesn't offer downgrades |
| A long period maintaining two apps | One developer, and every new feature is built twice |

Full list: `12-RISK-REGISTER.md`.

## Expected benefits

**Probable** (structural): much less memory and disk than Electron's four processes (357-364 MB physical footprint, 230 MB framework, both measured), native text selection, menus and accessibility, no JavaScript bridge on iPhone, and removal of a large class of web security concerns.

**Dependent on implementation quality:** startup, scrolling and search speed. Measured today: first paint 702 ms, and searches of 22-70 ms in SQLite, so database time is already small.

**Not established:** no native performance was measured, and this audit doesn't claim any improvement figures.

## Critical architectural decisions

1. Keep SQLite and the existing schema. GRDB is the strongest access layer. SwiftData and Core Data don't fit (04).
2. Keep the sync format, byte for byte, during coexistence (05).
3. One Xcode project, two app targets, one shared Swift package with enforced layers (08).
4. Keep bundle IDs, team, iCloud container and App Group (17).
5. Macs: SwiftUI shell with AppKit where it wins (06). iPhone: keep the three-control bar and per-tab history (07).

## Recommended philosophy

**Prove, then copy, then switch.** Build the shared Swift layer bottom-up, check it against golden data generated from the current TypeScript, run native apps beside the old ones on Dev identities, keep new writers away from real data until interoperability is proven, and leave old apps and their data untouched until native has run successfully. See `13-INCREMENTAL-MIGRATION-OPTIONS.md`.

## Fundamental blockers

None technical. Three things could change the shape of the plan and need decisions:

- **Windows.** There's no native path, so Electron can't be fully retired while Windows is supported.
- **eSpeak licence.** A question for today's apps as well as the migration.
- **Physical device evidence.** Nothing about iPhone speech, memory or heat is proven.

## What this audit found and fixed on the way

Sync paths that lost edits, formatting lost in note tables, and unsafe link and path handling. See `01-REPOSITORY-STABILIZATION.md`. The current apps were not bug-free, and passing tests didn't show it: some of these defects only appeared when the audit traced behaviour directly.
