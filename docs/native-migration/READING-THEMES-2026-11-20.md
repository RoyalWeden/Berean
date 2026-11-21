# Reading themes (U12 / original theme presets) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED (presets + custom themes); iPhone VERIFIED (sim, light + dark); Mac built.**

- `apple/Shared/ReaderTheme.swift`: all 38 presets of the original `lib/themePresets.ts`, **generated verbatim** (id, label, family, light/dark bg · accent · text).
- Setting: the original `themePreset` key (preset id; "" = Default). Settings → Appearance → **Reading Theme** (grouped by the original families, swatches on Mac).
- Native interpretation (design choice): the theme colours the **Scripture page** — background behind the reader, base text colour and verse-number colour (theme accent) — in light and dark mode, like Apple Books themes. Toolbars, sidebars, sheets and other screens keep the system appearance so the apps still look like macOS/iOS. Default = no override.
- `ReaderStyle` carries `themeText` / `themeAccent`, so both TextKit readers re-render when the theme or colour scheme changes.
- Verified on sim: picker stored `"theme-bible"`; John 1 shows the parchment page with brown text and brown verse numbers; dark mode switches to the theme's dark palette; restored to Default afterwards.
- **Custom themes** (`apple/Shared/CustomReaderThemes.swift`): the original `customThemes` array ({id, name, basedOn, text, background, accent?} as #rrggbb), selected as `themePreset = "custom:<id>"`. Settings → Appearance → Custom Themes: **New Custom Theme** (copies the current reading theme's resolved colours, selects it, opens the editor), per-theme menu Use / Edit / Duplicate / Delete, editor with Name and Text / Background / Verse Numbers colour pickers. Stored objects are patched in place, so fields the native app doesn't use (verseNumber, strongs, …) survive. Deleting the active custom theme falls back to its `basedOn` preset (original rule). A custom theme has one palette for light and dark, as in the original.
  - Verified on sim: create → stored `[{"id":…,"name":"Default (custom)","basedOn":"","text":"#14141c","background":"#f5f5f8","accent":"#5064c8"}]` and `themePreset "custom:<id>"`; rename saves on Return (first version saved per keystroke and lost focus after one letter — fixed with a draft field); Delete → `customThemes []`, `themePreset ""`.
- Not ported: the per-theme ambient background animations. Highlights, red letters and Strong's links keep their own colours.
