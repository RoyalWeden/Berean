# Getting started (U13) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; iPhone VERIFIED, Mac built** (sheet path shares the view).

- `apple/Shared/OnboardingView.swift`: three pages — Welcome (platform-specific hint: ⌘K on Mac; tabs/search/••• on iPhone), Default Text (KJVA, LXX, 1 Enoch, Jubilees → `defaultText`), Appearance (System/Light/Dark → `theme`). Continue / Back / page dots; Start Studying finishes. Mac = sheet on the main window; iPhone = full-screen cover. The iCloud page from the original iPhone flow is omitted (native sync not built).
- Gate = the original per-device `onboardingCompleted` setting, **plus** a safety rule: shown only when the library has no notes, highlights or verse tags. Existing libraries and QA copies are never interrupted. Settings → About → **Replay Getting Started**.
- Verified on a fresh install on sim E8B01B22…: flow shown → chose LXX → Start Studying → settings `defaultText="lxx"`, `onboardingCompleted=true` → relaunch does not show it again. Fixed in testing: off-centre page dots on page 1; clipped list with a grey box.
- OPEN: the starter Genesis 1 tab is seeded before the choice, so it stays KJVA (new tabs use the chosen text); Mac UI not clicked through; the original's desktop feature tour (10 pages, sample notes) is intentionally not reproduced.
