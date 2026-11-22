# App Intents / Shortcuts (A05) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; metadata + route VERIFIED on iPhone sim** (Siri / Shortcuts UI itself not exercised).

- `apple/Shared/BereanAppIntents.swift`: Open Scripture (reference), Search Berean (query), Open Today's Daily Note, Open Workspace (name) + `AppShortcutsProvider` with the original phrases. Each opens a deep link in the native Dev scheme `berean-native-dev://` (never the existing apps' `berean://` / `berean-dev://`), handled by the existing `openNativeDevURL` → `DeepLink.parse` → `openBereanLink` router — the same design as the original `BereanIntents.swift`. Read Aloud intent omitted (no native speech yet). Both platforms (AppIntents on macOS too).
- Verified: built `Metadata.appintents/extract.actionsdata` lists the four intents; `simctl openurl berean-native-dev://open?ref=John%203:16` → Open → John 3 with verse 16 selected.
## Spotlight (A04, iPhone only as the original)

- `apple/BereanIOS/SpotlightIndex.swift`: notes (title, 600-char plain text, tags, verse ref keywords), saved workspaces, and the books of the default text (not verses) — each item's identifier is a native deep link; domains replaced on refresh so deleted notes vanish. Full refresh at launch, debounced on notes / workspaces / default-text changes. Result tap → `onContinueUserActivity(CSSearchableItemActionType)` → link router.
- Verified on sim: system Spotlight "horn" → result under Berean Native Dev → tap opened the horn note. Sessions (indexed by the original) are not indexed yet.
- 2026-11-22: tab sessions are indexed too (original spotlight.ts indexSessions: session name, "Tabs: …" text, `session/<id>` link). Verified with the Debug-only `--spotlight-selftest` launch argument (`CSSearchQuery` over the app's own index): on sim E8B01B22 (4 notes, 1 session, 0 workspaces) the launch donated 4 + 1 items and the query found 5 — the simulator's system Spotlight UI showed only web results, so the in-app query is the reliable check.
- OPEN: running each intent from the Shortcuts app / Siri.
