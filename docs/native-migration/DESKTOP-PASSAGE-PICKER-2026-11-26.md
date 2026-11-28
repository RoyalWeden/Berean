# Desktop passage picker — November 26, 2026

The owner encountered the phone-style passage picker in Mac Compare and asked to retain the desktop workflow with easier access to books. The standard Mac Scripture popover already used the desktop three-column picker. Compare and the Notes new-verse-note and insert-reference routes had requested compact mode on both platforms in 460 × 520-point sheets.

PassagePicker now selects its desktop layout on Mac regardless of the caller’s compact flag. iPhone continues to use the requested compact layout. The Mac selector adds a Books heading and count and increases the selection area from 420 to 480 points. Chapter preview is independent of the compact layout flag, so the desktop Notes verse grid remains available where the caller supplies a preview callback. The Mac Notes sheets use an 800 × 540-point minimum. The Compare sheet also uses that minimum. The desktop picker implementation is committed in `90e2b88b`.

## Verified runtime

- Mac regular Scripture showed the three-column browser and Books heading with count 80. Compare Add showed the same desktop layout. Searching for Exodus 30 added a temporary fourth column, later removed in the UI.
- Mac Notes Insert Reference reached the Genesis book/chapter browser and canceled without editing. Notes Home → Verse Notes → New Note → Genesis 1 reached the verse grid and canceled without creating a note. History returned to the Thursday note. Compare Edit remains a separate runtime check.
- On owned D0CC candidate 40600, the compact iPhone route selected KJVA → Psalms → Psalm 23 → verse 1, then deselected verse 1 at the opening. Study Matthew 5, selected verse 12, Strong’s off, panel closed and nine tabs were restored.
- Both integrated candidates built before Compare trace cleanup. Fresh owner-folder Mac, signed iPhone and Simulator builds of2bb1670d PASS, with signatures/Dev identities verified. Final read-only data evidence is in `shared-picker-final-data-check.json`.
