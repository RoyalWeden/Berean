# Getting started (U13) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; iPhone VERIFIED, Mac built** (sheet path shares the view).

- `apple/Shared/OnboardingView.swift`: three pages — Welcome (platform-specific hint: ⌘K on Mac; tabs/search/••• on iPhone), Default Text (KJVA, LXX, 1 Enoch, Jubilees → `defaultText`), Appearance (System/Light/Dark → `theme`). Continue / Back / page dots; Start Studying finishes. Mac = sheet on the main window; iPhone = full-screen cover. The iCloud page from the original iPhone flow is omitted (native sync not built).
- Gate = the original per-device `onboardingCompleted` setting, **plus** a safety rule: shown only when the library has no notes, highlights or verse tags. Existing libraries and QA copies are never interrupted. Settings → About → **Replay Getting Started**.
- Verified on a fresh install on sim E8B01B22…: flow shown → chose LXX → Start Studying → settings `defaultText="lxx"`, `onboardingCompleted=true` → relaunch does not show it again. Fixed in testing: off-centre page dots on page 1; clipped list with a grey box.
- FIXED: the untouched starter Genesis 1 tab switches to the chosen text on Start Studying (fresh-install retest: Genesis 1 LXX). OPEN: Mac UI not clicked through; the original's desktop feature tour (10 pages, sample notes) is intentionally not reproduced.

## Feature hints (U13) — 2026-11-20 (later)
- Original §16 hints (first-use tooltip, Dismiss / don't show again, reset in About) ported with **TipKit** (`apple/Shared/BereanTips.swift`): Search Berean (iPhone search button), Picture in Picture (YouTube button; invalidated once used), Ask a follow-up (inline in Ask Berean after the first answer). Settings → About → **Reset Hints** (applies at next launch — TipKit can only reset before it is configured).
- Verified on sim: the Search Berean hint appears above the search button on launch.
- Added later: **Strong's numbers** (Mac reader toolbar toggle; retires once used) and **Format your note** (note Format menu, both platforms; retires once opened). TipKit shows one hint at a time, so these follow the Search hint (seen on sim: Search hint shown first on a note).
- Not added: verse-click, highlight and compare hints (their anchors are inside the TextKit readers; iPhone's Strong's toggle is inside a menu).


## Verse, highlight and compare hints (2026-11-20, later)

The original §16 hints for "first verse number click", "first highlight selection" and "first compare view open", as TipKit tips (`BereanTips.swift`):
- **VerseActionsTip** — popover on the floating verse action bar the first time verses are selected; retired by Clear Selection or using Highlight.
- **HighlightTip** — popover on the Highlight button, ruled on a `verseSelected` event (≥ 2 selections) so it never shows together with the verse tip; text names the real word-range path (Highlight Selection from the text-selection menu, platform-specific wording).
- **CompareTip** — inline TipView at the top of Compare the first time it opens.
- All three reset with Settings → About → Reset Hints like the others.
- Verified on iPhone sim E8B01B22 (screenshots): verse tip on first selection, highlight tip on the second, compare tip on Compare This Verse; Compare exited afterwards. Mac built (same shared code).
- Known: TipKit `.immediate` frequency can show the Search tip at the same time as an inline tip until Go has been used once.
