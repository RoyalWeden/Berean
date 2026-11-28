# iPhone Scripture Find visibility — November 23, 2026

Commit `0fe0b88a` moves iPhone Scripture Find above the reading surface. The integrated Mac and iPhone builds (58186) passed before removal of an unused Find argument. Fresh owner-folder builds from the committed source are in progress.

## Reproduced behavior

The old UIKit chapter Find interface displayed at the bottom alongside the app dock. Searching “kingdom” showed five matches and Next advanced to 2 of 5. The competing bottom controls reproduced the visibility problem. Software keyboard appearance was not visually established during that run. Opening the old UIKit Find had cleared the selected verse.

## Implementation

The shared Find bar is hosted above the iPhone Scripture reader’s offset content, away from the bottom dock. Its controls provide 44-point targets. The iOS chapter adapter searches text while skipping reader markers, reports the match count and wraps in both directions. Current match highlighting uses temporary drawing rather than changing the text selection. The reader makes clearance for an opening-line match.

## Verified runtime

- On owned D0CC, the bar remained visible below the passage controls with the software keyboard both shown and hidden. Device Hub’s software keyboard toggle exercised both states and was restored to hidden.
- In Matthew 5, “kingdom” had five matches. Next moved 3 → 4, Previous returned to 3, and earlier navigation reached 1 before Previous wrapped to 5. The opening match appeared below the Find bar and above the keyboard. No Matches stayed visible with navigation disabled. G932 with Strong’s enabled returned zero, confirming marker exclusion in this case.
- With Strong’s off, moving to Matthew 6 refreshed to 1 of 3 and returning to Matthew 5 refreshed to 1 of 5. Close cleared the bar, highlight and top clearance. Selecting verse 1 before opening Find and searching “kingdom” retained Matthew 5:1 selected.
- Restored Matthew 5 via Go to verse 12, with verse 12 selected, Strong’s off, nine tabs and Find closed. On Mac, Command-F in Jeremiah 33 found five matches for “voice,” Next reached 2 of 5 and Close worked with the existing placement. Search “voice of joy,” All scope and seven Mac tabs were restored.

## Remaining verification

Physical iPhone behavior, Dynamic Type, narrow landscape, IME composition, accessibility actions, long chapters, diacritics and mapped texts remain open. Compare does not provide native Find. The final read-only comparison retained all 37 Mac active IDs and original watched hashes, with two earlier recoverably trashed notes. iPhone retained 47 active IDs and every watched table matched the current baseline. No notes were created. See `floating-find-final-data-check.json`. Final owner-folder Mac, signed device and Simulator builds pass at b496e3bf; see the build receipt below. The package is unchanged since the prior 386-test, 96-suite pass.

## Final drawing cleanup
`b496e3bf` copies the current highlight ranges under `MainActor.assumeIsolated` inside UIKit’s main-thread draw callback before painting. This removes the two newly introduced isolation warnings; final owner builds and warning verification passed. Existing older drawGlyphs warnings are separate. It changes no match positions or stored text.

## Final build receipt — November 24
Fresh owner-folder Mac, signed physical-iPhone and Simulator builds from **b496e3bf** all PASS. Strict Mac/device signatures PASS; all three Dev platform identities and absence of iCloud/App Group entitlements verified. The two new Find drawing isolation warnings are absent; older TextKit drawGlyphs warnings remain. Receipt `owner-find-ready-artifacts.json` and `owner-find-{mac,iphone,simulator}-ready.log` are under ignored Nov23 QA evidence; earlier0fe logs are retained separately. No additional physical installation, launch, provisioning or signing change. Later documentation-only commits do not alter these binaries.
