# Changelog

All notable changes to Berean are recorded here.
Format: `## [version] — YYYY-MM-DD` with bullet points below each entry.
Add new entries under `## [Unreleased]` as you work, then move them to a version block when tagging.

---

## [Unreleased]

- Getting Started folder: 10 linked guide notes created on onboarding
- Settings → Updates: beta channel toggle, GitHub Pages link, cleaner MAS build UI
- Settings → About: "Recreate Getting Started notes" button
- Windows: native OS window chrome (title bar on right), platform-conditional traffic light spacer
- GitHub Actions CI: automated Mac + Windows builds on version tag push
- GitHub Pages: download landing page with dynamic release version detection

---

## [0.2.7] — 2026-06-01

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
