# Berean iPhone — Migration Documentation

This folder is the source of truth for bringing Berean to the iPhone as a first-class,
offline-first, iCloud-synced application while keeping the macOS/Windows Electron app fully
functional. Read these in order the first time; afterwards `implementation-progress.md` is the
place to look for "where are we".

| Document | What it holds |
|---|---|
| [`../development-map.md`](../development-map.md) | One-screen quick reference: Berean vs Berean Dev (identities, iCloud, local data) and the few commands that matter. |
| [`requirements.md`](requirements.md) | The requirement ledger: every requirement from the brief with a stable ID (R001…), current desktop implementation, target, files, tests, status. Never shrinks. |
| [`architecture.md`](architecture.md) | Shared-vs-platform layering, the `window.*` boundary, shared services + `DatabaseAdapter`, the iOS runtime (Capacitor + local Swift plugins), the mobile shell, sync engine placement, security. |
| [`feature-matrix.md`](feature-matrix.md) | Every user-facing desktop feature → iPhone requirement, shared/iOS implementation, offline & iCloud behaviour, status, limitation. |
| [`icloud.md`](icloud.md) | The iCloud synchronisation design: ubiquity-container per-device journals, merge rules, entity classification, tab/session field classification, bootstrap, compaction, failure handling, test plan. |
| [`database.md`](database.md) | Bundled vs user databases, adapter interface, migration history and the new migrations (v43+), iOS storage layout, safety procedures. |
| [`decisions.md`](decisions.md) | Decision log (D-001…): decision, date, reason, alternatives, consequences, affected requirements. |
| [`testing.md`](testing.md) | Test categories, desktop baseline, per-phase test inventory, sync scenario matrix, multi-device results, performance targets, accessibility checklist. |
| [`ios-build.md`](ios-build.md) | Environment, what the developer must configure (never committed), everyday commands, device runs, TestFlight, deep links, App Store readiness. |
| [`implementation-progress.md`](implementation-progress.md) | Phase-by-phase status, gates, files changed, tests run, known issues, decisions needed, blockers. Updated continuously. |
| [`audit/`](audit/) | Phase 0 repository audit reports (read-only findings the plan is built on). |

## Ground rules carried from the brief

- No scope reduction, no silent removal or deferral, no simplified "mobile edition", no PWA.
- The desktop feature model is the source of truth; the iPhone is a different *presentation* of it.
- Nothing is marked COMPLETE without tests; iCloud is not complete without real Mac ↔ iPhone runs.
- Genuine product decisions and technical blockers are surfaced in
  `implementation-progress.md` §Decisions needed, not decided silently.
- Work happens on the `feature/ios-app` branch in the `/Users/roywe/Berean-ios` worktree; no
  push, no App Store / TestFlight submission without an explicit request.
