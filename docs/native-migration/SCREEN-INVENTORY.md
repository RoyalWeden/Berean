# Screen inventory (original vs native)

"Exists" means it is reachable from the UI. A component that exists only in code does not count.

**Columns.** Orig = exists in the original app · Native = exists natively · Reach = reachable · Works = exercised in the running app ·
Nav = navigation makes sense · Visual = visual quality reviewed · Test = automated or scripted coverage.

## macOS

| Screen / surface | Orig | Native | Reach | Works | Nav | Visual | Test | Notes |
|---|---|---|---|---|---|---|---|---|
| Main window (sidebar + reader + inspector) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ADR-0010/0012 |
| Sidebar: workspace menu, location, New Tab, tabs, archive | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Command palette ⌘K | ✅ (Floating Search) | 🟡 | ✅ | ✅ | ✅ | 🟡 | — | no notes / commands (MAC-FUNC-003) |
| Scripture reader | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (light/dark) | catalog + display tests | |
| Passage navigator popover | ✅ (picker) | ✅ | ✅ | ✅ | ✅ | ✅ | catalog test | |
| Verse selection bar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Verse actions menu | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | — | |
| Study panel (Notes / Lexicon / Cross Refs) | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | lexicon / crossrefs goldens | |
| Compare | ✅ | 🟡 | ✅ | ✅ | 🟡 | 🟡 | — | |
| Layout presets | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | — | |
| Search tab | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (dark) | engine tests | |
| Options popover (search) | ✅ (advanced) | ✅ | ✅ | ✅ | ✅ | 🟡 | — | |
| #tag results | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | verse-tags golden | |
| Tag picker sheet | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | — | |
| Notes home | ✅ | 🟡 | ✅ | ✅ | 🟡 | 🟡 | notes golden | MAC-FUNC-007 |
| Note editor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | spans tests | ADR-0014 |
| Version history sheet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | notes golden | |
| Export / import panels | ✅ | ✅ | ✅ | ✅ | ✅ | — | ui smoke | |
| Settings window | ✅ | 🟡 | ✅ | ✅ | ✅ | 🟡 | settings test | SHARED-FUNC-014 |
| Find bar ⌘F | ✅ | ❌ | — | — | — | — | — | MAC-FUNC-004 |
| History tab | ✅ | ❌ | — | — | — | — | — | SHARED-FUNC-012 |
| Calendar / daily | ✅ | ❌ | — | — | — | — | — | MAC-FUNC-013 |
| Tag manager / graph | ✅ | ❌ | | | | | | |
| Study Trail (window + map) | ✅ | ❌ | | | | | | |
| PDF viewer, YouTube, Read Aloud player, Ask Berean, presenter, floating windows, onboarding, tasks | ✅ | ❌ | | | | | | |

## iPhone

| Screen / surface | Orig | Native | Reach | Works | Nav | Visual | Test | Notes |
|---|---|---|---|---|---|---|---|---|
| Reader + bottom bar (Tabs · New · More) | ✅ (tab cards · plus · caret) | ✅ | ✅ | ✅ (Simulator taps) | ✅ | 🟡 | — | ADR-0013 |
| New sheet | ✅ (plus / New Tab sheet) | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Tab sheet + Workspaces page | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | — | |
| More menu | ✅ (caret) | ✅ | ✅ | ✅ | ✅ | 🟡 | — | |
| Passage navigator sheet | ✅ | 🟡 | ✅ | ❓ | ✅ | ❓ | — | compact layout untapped |
| Verse selection + selection bar | ✅ (verse sheet) | 🟡 | ✅ | ❓ | 🟡 | ❓ | — | needs Simulator pass |
| Study inspector sheet | ✅ (verse sheet tabs) | 🟡 | ✅ | ❓ | 🟡 | ❓ | — | |
| Search | ✅ | 🟡 | ✅ | ❓ | ✅ | ❓ | — | same view as Mac |
| Notes home / editor | ✅ | 🟡 | ✅ | ✅ (New Note) | 🟡 | 🟡 | — | |
| Settings sheet | ✅ | 🟡 | ✅ | ❓ | ✅ | ❓ | — | |
| Verse sheet (low detent) with Strong's / refs / notes | ✅ | ❌ | | | | | | iPhone uses the inspector instead |
| History, Calendar, Study Trail, Tags, PDFs, YouTube, Read Aloud, Ask Berean, Share Extension, widget | ✅ | ❌ | | | | | | |
