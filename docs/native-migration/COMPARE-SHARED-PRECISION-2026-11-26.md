# Shared Compare precision — November 26, 2026

Mac QA profile codex-controls-20261119 only; no owner app/library action. The final shared viewport implementation is committed in `2bb1670d`. Earlier runtime builds included bounded DEBUG metadata tracing, removed before commit. The observations below record the original discrepancy and the final correction.

## Verified distinction

EXO32 KJVA-source, LXX-left/KJVA-right, SyncON,1259×825. Older A savedrow3/native293. Next33 thenPrevious32 and wheel produced newer Brow10/native787. Back twice restored A/native293 exactly with compatible in-memory coordinate. Read-only mac-shared-back-A.json proves active row3 while destination remains newerrow10. Cold reopened correctrow3 at292. After deliberate movement withinrow3 to313, another cold replay again restored292 (21pt loss). Source snapshots have no rowcrop for shared visits. Evidence /private/tmp/berean-compare-shared-{runtime,cold,crop-replay}-20261126.log.

## Design and early candidate

Implement exact shared crop in existing local bookmark records with compatible independent encoding, bounded rendering fingerprint and real measured row geometry; semantic fallback for changed geometry. Avoid raw private Word Replacer rules in persistence or logs. Stable stacked column UUID plus rawrow must survive. Empty/top and explicit jumps retain precedence; new user input supersedes retry. Require fresh matching row/native offset before correction, bounded lazy-layout convergence. Agent aligned_history_design owns CompareView, AppModel if needed, CompareViewport and tests. No UI/build work delegated.

Owned D0CC Simulator candidate installed and launched37034. Re-queried data container3B70CCC4-F5EB-420B-952D-0937329B2639. Workspace4 Psalm23 aligned SyncON manually scrolled; saved alignedrow3. Screenshot showed partialrow2 above row3 after scrolling; no precision stored. iOS A/B/history/cold still in progress. Original baseline snapshot ios-shared-current-baseline.json has47 active IDs and watched hashes. Restore Study Matthew5 selected12/Strong’sOFF/panelclosed9tabs and Workspace4 Psalm23openingSyncON when done. Separate E8B simulator untouched.

No new notes or data edits. Temporary trace must be removed before final builds/commits. Owner artifacts remain verifieda5956515, docs034e975f.

## iPhone scoped observation
Existing candidate37951/37851 aftercold opened Psalm23 with olderactive row3. More→Back twice visibly returned the earlier partial reading presentation. However the attempted B scroll did not establish a distinct position: read-only latestdestination remainedrow3. Repeated CUA touchdrag attempts (including reactivation with normal DeviceHub open, Raise, headerclick, both coordinate scales) and wheelroute produced unchanged content. Do not claim an A-vs-newer-B persistence proof or precise crop from this run. Native AX buttons continue to work. Fix input focus/targeting or use a verified touchroute before closing that matrix. No source patch was made based only on ineffective drag.

## Verified true stacked cold precision
Final picker/crop candidate Mac and Simulator builds PASS. Four-column owned Macfixture: sourceEXO32, LXX32pinned, KJVA32following, temporaryKJVA31/30pinned; Compare869×878, rightLexiconpaneopen. New sharedPrecision captured LXXraw13 crop11/rowheight73.5, native826. Cold reopened samegeometry, IDplacement815; matching measured row corrected once to826 and settled crop11 exactly. Log /private/tmp/berean-final-crop-stacked-cold-20261126.log, preceding /private/tmp/berean-final-crop-picker-mac-20261126.log, snapshotmac-stacked-precise-before.json. This verifies ordinary stacked cold precision. The later older-visit replay is below. Added temporary column UUIDs2002164C-AD3F-41B3-AA4C-221F774E8A09(EXO31) and21BF5C65-DE81-4D87-8939-44EAA8F16AF1(EXO30); both were later removed through the UI.

## Older-visit precision and final state

At 869 × 878 on Mac, the true stacked four-column comparison held A at LXX row 13, crop 11 and native offset 826. The newer visit B held row 18 at crop 48. Back followed by cold start restored A to 826/crop 11 while retaining the separate newer B record. In the aligned two-column comparison at the same size, A held row 10/crop 22 and B held row 12/crop 97. Back followed by cold launch settled at offset 1114 and crop 21.5, within one display pixel of A. See `/private/tmp/berean-aligned-older-cold-20261126.log`.

The full suite passed 390 tests across 96 suites, including 15 focused Compare tests. See `full-shared-crop-20261126.log` in the temporary evidence directory. Integrated Mac and Simulator builds passed with tracing present. After trace removal, DEBUG and non-DEBUG parsing passed. Fresh owner-folder Mac, signed iPhone and Simulator builds of2bb1670d PASS, including strict signatures/Dev IDs/no cloud or group entitlements. Receipt ignored Nov26 owner-compare-picker-ready-artifacts.json. No phone installation.

Removed the temporary Exodus 31 and 30 columns in the UI. Restored original two columns, unpinned LXX, Sync off and panel closed. Mac QA quit after restoring Search “voice of joy,” All and seven tabs. iPhone Study Matthew 5 returned with verse 12 selected, Strong’s off, panel closed and nine tabs. Read-only `shared-picker-final-data-check.json` retained the 37 original Mac active IDs and all original watched hashes with two earlier Trash fixtures, and matched all watched iPhone tables and 47 active IDs. No notes were created.

iPhone precise crop and distinct older-versus-newer replay remain unverified. Also verify reflow, immediate wheel interruption, empty/header starts and duplicate-column swaps.
