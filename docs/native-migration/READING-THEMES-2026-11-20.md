# Reading themes (U12 / original theme presets) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED (presets); iPhone VERIFIED (sim, light + dark); Mac built.**

- `apple/Shared/ReaderTheme.swift`: all 38 presets of the original `lib/themePresets.ts`, **generated verbatim** (id, label, family, light/dark bg · accent · text).
- Setting: the original `themePreset` key (preset id; "" = Default). Settings → Appearance → **Reading Theme** (grouped by the original families, swatches on Mac).
- Native interpretation (design choice): the theme colours the **Scripture page** — background behind the reader, base text colour and verse-number colour (theme accent) — in light and dark mode, like Apple Books themes. Toolbars, sidebars, sheets and other screens keep the system appearance so the apps still look like macOS/iOS. Default = no override.
- `ReaderStyle` carries `themeText` / `themeAccent`, so both TextKit readers re-render when the theme or colour scheme changes.
- Verified on sim: picker stored `"theme-bible"`; John 1 shows the parchment page with brown text and brown verse numbers; dark mode switches to the theme's dark palette; restored to Default afterwards.
- Not ported: **custom themes** (the original `customThemes` list — create/duplicate/edit text & background colours) and the per-theme ambient background animations. Highlights, red letters and Strong's links keep their own colours.
