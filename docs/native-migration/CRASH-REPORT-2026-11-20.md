# Crash report on next launch (O02) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; iPhone VERIFIED (sim) with a sample report; Mac built.**

- Original: `CrashReport.tsx` shows "App recovered from a crash" (message, source, Copy details, Dismiss) after an ErrorBoundary catch stored in `localStorage['berean-crash']`.
- Native: `apple/Shared/CrashReporter.swift` subscribes to **MetricKit** (`MXMetricManager`), which delivers crash diagnostics on a later launch (also `pastDiagnosticPayloads`). The newest crash becomes a `CrashSummary` (`BereanNotes/CrashSummary.swift`, tested: Mach exception/signal names, termination reason, build + OS label, call-stack JSON capped at 20 kB, details text in the original's exact layout). Stored only in this library's local defaults (`nativeCrashReport`); nothing is sent anywhere.
- UI: `CrashReportBanner` — "Berean recovered from a crash" card (iPhone top, Mac bottom-trailing) with **Copy Details** and **Dismiss** (Dismiss deletes the stored report).
- Verified on sim with a labelled sample summary seeded into the app's container preferences: banner shown; Copy Details → clipboard text matches the original layout; Dismiss → banner gone and the key removed; relaunch → no banner.
- Test note: `simctl spawn … defaults write` writes the simulator's device-wide domain, which the app reads but cannot delete — seed the container plist instead (the first attempt looked like a "Dismiss doesn't persist" bug; it was the seeding).
- Limits: MetricKit delivery timing is the system's (can be the next launch or later); a real crash was not induced.
