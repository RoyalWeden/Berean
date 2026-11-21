# Presenter window (U07 part) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED + VERIFIED on Mac (click-free automation)**. First slice of the original "viewer" window.

- `apple/BereanMac/PresenterView.swift` + `Window("Presenter", id: "presenter")`; Window → **Show Presenter ⌘⇧B**. Shares the AppModel, so it follows the main window's active tab live: Scripture chapter (large serif, word replacer applied, selected verses tinted, scrolls to the selection or the main reader's top visible verse), note (title + plain text), lexicon entry (number, lemma, transliteration, gloss, definition, derivation). Toolbar: Smaller / Larger (⌘- / ⌘=, remembered), Pause/Resume (freezes what the audience sees; title shows "Paused").
- AppModel publishes `presenterAnchor` (from saveScripturePosition) and `presenterSelection` (from the Mac reader's live selection) **only while the presenter is open** — no extra observation churn otherwise.
- Verified: menu opens presenter; ⌘L → John 3:16 → presenter follows to John 3; ⌘L → Psalm 23:1-3 → verses 1–3 tinted, "Yehovah" shown; Pause → main to John 1 → presenter stays on Psalm 23 with "Presenter — Paused".
- OPEN vs original: laser pointer and selection-character overlay, compare-mode columns, cross-reference side panel, "On presenter" visible-band outline in the main window, viewer-only highlights, floating PresenterControls; floating note windows (rest of U07).
