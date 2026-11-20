# Deep links (A06) — routes completed — 2026-11-20 (Claude Code)

The native router (`DeepLink.parse` → `AppModel.openBereanLink`) already handled verse, note, lexicon, search, daily, workspace, session and pdf. Added:
- `video/<id>?t=<secs>` → YouTube tab at that moment (`openYouTubeVideo`).
- `trail/<id>` → Study Trail sheet opened on that trail (`studyTrailOpenRequest`, consumed by the sheet); unknown id → "This study trail is unavailable."
- `chat[/new]` → Berean Chat (iPhone full-screen cover; Mac `chatWindowRequest` → `openWindow("chat")` in the main window).
- `share` stays unsupported natively (Share Extension not built — owner decision on new targets/App Groups).

Verified on the iPhone sim with `simctl openurl berean-native-dev://…`: chat → All Messages; video/7PZjoIgdows?t=15 → tab URL `…&t=15s`; trail/does-not-exist → message; trail/<real id> → trail opened (List/Map, Pause/Finish). Mac not exercised: another QA instance of the same Dev bundle (Codex) is running and could receive the URL.

## Bug found and fixed: Study Trail "New Trail" closed the sheet on iPhone
The sheet host added a bottom "Done" inset and StudyTrailView its own bottom "New Trail" inset; on iPhone both landed on the same point (accessibility hit point 220,896.8 for both), so tapping New Trail tapped Done — trails could not be created on iPhone. Done moved to the navigation bar (`.confirmationAction`); verified: New Trail → name → Start creates the trail.
