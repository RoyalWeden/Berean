# Changelog

All notable changes to Berean are recorded here.
Format: `## [version] — YYYY-MM-DD` with bullet points below each entry.

<!--
════════════════════════════════════════════════════════════════
  RELEASE WORKFLOW — for Michael's reference (not shown to users)
════════════════════════════════════════════════════════════════

FULL STABLE RELEASE STEPS
─────────────────────────
1. Edit this file — move [Unreleased] bullet points into a new version block:
      ## [0.2.9] — 2026-06-15
      - what changed

2. Run the tag command — it will prompt for the version number,
   then commit CHANGELOG.md + package.json together and push the tag:
      npm run tag:stable

   At the prompt, type the version you want (e.g. 0.2.9) or press Enter
   to accept the suggestion. No need to edit package.json manually.

GitHub Actions then builds Mac DMG + Windows NSIS (~10 min) and publishes
to GitHub Releases. The download page updates automatically.

BETA STEPS (no manual steps needed at all)
───────────────────────────────────────────
  npm run tag:beta    ← auto-bumps version, commits, tags, pushes
  (repeat — each call increments the beta number: beta.1 → beta.2 → …)
  npm run tag:stable  ← edit changelog first, then run — handles everything

────────────────────────────────────────────────────────────────
SCENARIO 1 — Feature release: beta testing then ship
────────────────────────────────────────────────────────────────
  pkg: 0.2.8  (after last stable)
  tag:beta   →  0.2.9-beta.1   PRE-RELEASE  (new patch series)
              users on beta channel get this, test it
  tag:beta   →  0.2.9-beta.2   PRE-RELEASE  (bug fixes, same series)
  tag:beta   →  0.2.9-beta.3   PRE-RELEASE  (more fixes)
  tag:stable →  0.2.9          STABLE       (strips suffix, commits clean version)

  What users see:
    Beta users: got beta.1 auto-updated to beta.2, then beta.3
    Stable users: saw nothing until 0.2.9 stable dropped, then got it

────────────────────────────────────────────────────────────────
SCENARIO 2 — Hotfix: straight to stable, no betas needed
────────────────────────────────────────────────────────────────
  pkg: 0.2.9  (clean, after last stable)
  Manually edit package.json version to "0.2.10"  ← required step
  git add package.json && git commit -m "chore: bump to 0.2.10"
  tag:stable →  0.2.10         STABLE  (version already clean, just tags)

  What users see:
    All users (beta and stable) get 0.2.10 on next launch check

────────────────────────────────────────────────────────────────
SCENARIO 3 — Release exactly one beta then immediately ship
────────────────────────────────────────────────────────────────
  pkg: 0.2.10
  tag:beta   →  0.2.11-beta.1  PRE-RELEASE
              looks good after quick testing
  tag:stable →  0.2.11         STABLE  (pkg becomes 0.2.11, tag pushed)

  What users see:
    Beta users got 0.2.11-beta.1 briefly, then 0.2.11 stable
    Stable users only ever see 0.2.11 stable

────────────────────────────────────────────────────────────────
SCENARIO 4 — Minor version jump (e.g. 0.2.x → 0.3.0)
────────────────────────────────────────────────────────────────
  pkg: 0.2.11
  Manually edit package.json version to "0.3.0-beta.1"
  git add package.json && git commit -m "chore: start 0.3.0 series"
  tag:beta   →  0.3.0-beta.2   PRE-RELEASE  (increments beta N, doesn't bump patch)
  tag:beta   →  0.3.0-beta.3   PRE-RELEASE
  tag:stable →  0.3.0          STABLE

  Note: first beta (0.3.0-beta.1) is the manual commit — it doesn't get a
  GitHub Release because it was never tagged. That's fine; just start tagging
  from tag:beta once you're ready for people to download it.

────────────────────────────────────────────────────────────────
SCENARIO 5 — Abandon a beta series and restart
────────────────────────────────────────────────────────────────
  pkg: 0.2.12-beta.2  (two betas out, major rework needed)
  tag:beta  would give 0.2.12-beta.3 — but you want to reset

  Option A: keep the version, just keep iterating
    tag:beta  →  0.2.12-beta.3  ...  →  tag:stable  →  0.2.12

  Option B: jump to a fresh patch (restart at beta.1)
    Manually edit package.json to "0.2.12"  (strip the suffix)
    git add package.json && git commit -m "chore: reset to 0.2.12 base"
    tag:beta  →  0.2.13-beta.1  (new series, patch bumped)
    tag:stable  →  0.2.13

  Note: old 0.2.12-beta.1 and beta.2 stay on GitHub Releases as pre-releases.
  They're visible but not shown to stable users. You can delete them from
  GitHub Releases manually if you don't want them shown at all.

════════════════════════════════════════════════════════════════
-->


---

## [0.3.11] - 2026-06-08

Bug fixes:
- Highlight fixes
- BDB fixes

---

## [0.3.10] - 2026-06-08

- Cross ref verse hover improvements

---

## [0.3.9] - 2026-06-07

- General bug fixes

---

## [0.3.8] - 2026-06-06

- Note history
- See LXX connections in KJV

Bug Fixes:
- LXX verse block fixes
- Notes fixes
- 'GOD' is also replaced to 'Yehovah'
- Jubilees text rendering fixes
- History modal bug fixes
- Floating search bar fixes

---

## [0.3.7] - 2026-06-06

- Better tooltips

Bug Fixes:
- Findbar fixes
- Notes fixes
- 'GOD' is also replaced to 'Yehovah'
- Jubilees text rendering fixes
- History modal bug fixes
- Floating search bar fixes

---

## [0.3.6] - 2026-06-05

- Scripture & strong's auto formatted blocks
- Print and download settings
- Default download setting
- New tabs open below active tab
- Right-click options in scripture search to open in new/floating tab
- Lexicon copy button
- Archive tabs

Bug Fixes:
- Various pdf/print issue fixes
- Hebrew lexicon not linking to other hebrew strongs numbers
- Empty notes no longer delete when switching tabs
- Word replacer now edits cross reference verse text

---

## [0.3.5] - 2026-06-04

- Added Elseus → Elisha in word replacer
- Strong's toggle now doesn't jump scripture
- Decreased verse spacing on Strong's toggle
- Added 10 new print/download themes
- Verse blocks are now rounded

Bug Fixes:
- Removed random paranthesses from scripture
- Fixed occurrences not all showing in lexicon
- Added back `'s` for the word replacer of 'Yehovah'
- Fixed margin adjustment for print/downloads
- Stripped internal links when printing/downloading note

---

## [0.3.4] - 2026-06-03

- Ability to use special characters in note names
- Print and download settings
- Default download setting

Bug Fixes:
- Fixed download and print view

---

## [0.3.3] - 2026-06-03

- Changelog now visible on website

Bug Fixes:
- Fixed download and print view

---

## [0.3.2] - 2026-06-03

- Word replacer now includes LORD → Yehovah
- Right-click empty space in notes folder view

Bug Fixes:
- Fixed Cmd+L in advanced scripture search tab
- Verse selection menu off-screen

---

## [0.3.1] - 2026-06-03

Bug Fixes:
- Fixed Mac build

---

## [0.3.0] - 2026-06-02

Bug Fixes:
- Mac app opens

---

## [0.2.13] - 2026-06-02

- Word replacer works in lexicon

---

## [0.2.12] - 2026-06-02

Bug Fixes:
- Fixed Windows show bible/lexicon data

---

## [0.2.11] - 2026-06-02

- Windows now has custom title bar and window controls

Bug Fixes:
- Fixed Windows show bible/lexicon data
- Fixed Windows floating tabs top bar

---

## [0.2.10] - 2026-06-02

Bug Fixes:
- Fixed git builds

---

## [0.2.9] - 2026-06-02

Bug Fixes:
- Fixed git builds

---

## [0.2.8] - 2026-06-01

- Getting Started folder: 10 linked guide notes created on onboarding
- Settings → Updates: beta channel toggle, GitHub Pages link, cleaner MAS build UI
- Settings → About: "Recreate Getting Started notes" button
- Windows: native OS window chrome (title bar on right), platform-conditional traffic light spacer
- GitHub Actions CI: automated Mac + Windows builds on version tag push
- GitHub Pages: download landing page with dynamic release version detection
- Added escape character `\` to disable markdown when needed

Bug Fixes:
- Fixed markdown not working in tables
- Fixed scroll position retaining when going to different notes
- Fixed system them auto-switcher
- Fixed advanced scripture tab opening existing tab instead of a new tab
- Fixed edit view of note showing raw markdown

---

## [0.2.7] - 2026-06-01

- Full Berean app — Bible reader, notes, lexicon, YouTube, search, MAS build config
- Notes: WYSIWYG markdown editor with live rendering (CodeMirror 6)
- Verse notes with color indicators, collapsible headings, bullet style picker
- Strong's inline numbers, hover tooltips, full lexicon tab
- Highlighting system with 5 colors, + Note from highlight
- Full-text search with FTS5, word replacer, note search
- YouTube embedded webview with allowlist, auto-PiP, timestamp linking
- Vault sync to local Markdown folder (iCloud/Obsidian/Octarine compatible)
- Compact settings UI with toggle, keyboard shortcut display
- PDF import and viewer subsystem
- BibleGateway and e-Sword note importers
- Onboarding wizard (7 steps)
- Keyboard shortcuts for all major features
- Auto-updater via GitHub Releases (skipped for MAS builds)
