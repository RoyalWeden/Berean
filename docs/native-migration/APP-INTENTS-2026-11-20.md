# App Intents / Shortcuts (A05) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; metadata + route VERIFIED on iPhone sim** (Siri / Shortcuts UI itself not exercised).

- `apple/Shared/BereanAppIntents.swift`: Open Scripture (reference), Search Berean (query), Open Today's Daily Note, Open Workspace (name) + `AppShortcutsProvider` with the original phrases. Each opens a deep link in the native Dev scheme `berean-native-dev://` (never the existing apps' `berean://` / `berean-dev://`), handled by the existing `openNativeDevURL` → `DeepLink.parse` → `openBereanLink` router — the same design as the original `BereanIntents.swift`. Read Aloud intent omitted (no native speech yet). Both platforms (AppIntents on macOS too).
- Verified: built `Metadata.appintents/extract.actionsdata` lists the four intents; `simctl openurl berean-native-dev://open?ref=John%203:16` → Open → John 3 with verse 16 selected.
- OPEN: running each intent from the Shortcuts app / Siri; Spotlight (A04) indexing.
