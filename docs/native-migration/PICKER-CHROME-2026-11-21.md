# Picker verse identity and Mac toolbar ownership — 2026-11-21

Broad goal ACTIVE. Previous turn made concrete progress (published8252c91c/852a4767 plus actual UI evidence). This turn starts cleanf6865f54. Exact-head CI44940784658 running. No production data/sync/schema/identity changes, no merges/ready/retarget/force; only isolated Codex profiles/device. Stay-within-limits disabled; no resets.

## Compare coverage added on prior source852a4767

Existing EXO32 KJVA/LXX independent comparison, tab78014c72-c288-4426-82d8-b8b3adf99cf1. Changed secondary via column picker to Psalm3LXX, selected3: Presenter showed Psalm3LXX and its wording, notEXO32. Clear selection: Presenter returned defaultEXO32KJVA. Closed Presenter. Back restored original columns. Main passage popover searchJonah1: AX row click alone did not invoke; Return submitted. Changed to sync scrolling, selected actual secondary JON2:1 aligned with KJV JON1:17; Presenter showed Jonah2LXX and its whale verse. Closed/cleared and Back restored originalEXO32 columns, compareSyncScrollfalse and original sync_state_json. No notes/annotations/newtabs.

## iPhone picker bug and source fix (PassagePicker.swift dirty)

Old compact preview generated 1...rowCount and converted each button as a displayed number. Bundled LXX EXO32 has 34 rows, no9, final35; 1KI14 has21–31 only; PSA115 has one combined4–5 row. Row-count generation invents/misses destinations. New preview uses prepared readerChapter rows, row.readerVerseLabel/accessibility ranges, and rawverseNum directly for onPick; no second conversion. Empty chapter gets explicit unavailable state. One-row auto-finish and non-preview routes retained. Compact clear/dismiss hit targets44pt on iOS only; Mac compact dimensions unchanged. Result list supports interactive keyboard dismissal on iOS.

Mac and iPhone picker builds pass: mac-picker-verse-identity-build.log / ios-picker-verse-identity-build.log. Only CodexD0CC... device installed, DevIDverified, container re-queried, launchedPID40512. Actual iPhone: EXO32 grid omits9 and offers35; tap35 opens stored35, dashed selection/actionbar visually confirmed. 1KI14 grid exactly21–31; tap31. PSA115 grid shows4–5; tap range opens raw4 (picker-ios-combined-verse.json). PSA3 grid1–8; tap1 opens raw2/selected2 with combined superscription/body visually confirmed (picker-ios-psalm3-verse1.json). Same original tabdb988... retained9workspace tabs. Cleared temporary selection and returnedPsalm3LXX/no sheets.

A tap at the edge of the new keyboard-dismiss target, outside the glyph, removed focus/dismiss control. Hardware keyboard was connected, so software-keyboard interactive dismissal remains unverified. Catalog sheet exposes Other writings; Apocalypse of Elijah selection directly shows chapters1–5. Cancelled without navigating reader. This verifies current catalog access/single-book flow, not new implementation of it.

## New reproduced Mac stale chrome and pending fix

After the above Compare/popover/Presenter/history routes then switching to Genesis, content/selected tab was GEN1 but window title remained EXO32 and both EXOCompare and GENnormal toolbar groups persisted across settled observations: duplicate passage controls/Layout/Display/Compare/etc and old Manage Translations. This is a concrete ownership bug, not an animation-only claim.

Pending source in MacTabContentHost/ScriptureView/CompareView adds live active-Bible/mode/passage guards, moves Mac title/subtitle outside keyed reader, dismisses toolbar popovers on departure, and rejects stale Mac picker callbacks, closing before mutation. Reader identity unchanged; iPhone title/apply order preserved. Parsing/diff pass; Mac ownership build passed (mac-reader-toolbar-ownership-build.log). Parent review/build/UI next. If this gating cannot clear native registration, use stable root-owned toolbar registration rather than recreating native reader/window. Preserve other active surfaces and viewport behavior.

Current dirty source is owned by Codex: PassagePicker plus three chrome files. Parent owns verification/docs/Git. Reverify exact current runtime before restart; owner process728 untouched. Main QA GEN1selected1/446/Notes/sidebar239/right1660; stale old toolbar currently present in old runtime. iPhonePsalm3LXX/no selection/sheets/9tabs after picker checks. Next: final both builds, restart QA Mac only, repeat exact stale-toolbar route, verify one principal group/GENwindowtitle/no Manage Translations, same-ID Back and normal picker routing. Then final original-row hashes/37+47activeIDs, focused source commits and updated playbook/parity/decisions/status.


## Final source and Mac verification

Committed c39ca828 (picker) and d9da6c36 (Mac chrome). Final adjusted Mac build passes: mac-picker-ownership-adjusted-build.log; combined iPhone build passes: ios-picker-chrome-final-build.log. Package source unchanged since349 shared tests; those tests do not cover toolbar lifecycle or picker UI. Current Mac runtime session89739/log mac-picker-ownership-adjusted-runtime.log (revalidate before lifecycle).

An initial Mac guard required pickerShown to remain true at callback time; valid Return navigation was blocked while the native popover remained visible. Removed that presentation-state gate. Exact live active Bible ID/type/edition/chapter/Compare mode guard remains, and PassagePicker delivers only once. Initial inactive-window typing also failed to enter text; raise the correct QA window before keyboard tests. Do not confuse missing focus with an app navigation failure.

Actual adjusted build: EXO32Compare → main passage popover → Jonah1 resolved + Return; popover closes and JonahCompare opens. Sync on, select mappedLXXJonah2:1, Show Presenter: Jonah2LXX correct. Close Presenter, clear, Back: originalEXO32 compare returns. SwitchGenesis: **WindowGenesis1, oneGENprincipal passage group, Compare off, no Manage Translations**, exact0.4402764067127344/446 retained. This specifically repairs the reproduced settled duplicate toolbar/title case. Then Cmd+L G5485 replaces originalGENtab → Back restores oneGENbar/title and446, seven workspace tabs. Full other-type/layout/Popover/first-frame matrix remains open.

Actual mouse-row verification remains inconclusive: AX List row click did not invoke in earlier runs; coordinate probes did not establish hitting the result. Do not claim a mouse-click regression or success from those attempts. Return navigation passes, source result is a Button; broader real-pointer/manual picker and tab-switch interruption tests remain needed.

Final read-only picker-chrome-final-data-check.json: all original row hashes present; exact37Mac/47iPhone active tab IDs,22/26notes. EXO comparison's original sync_state_json restored exactly, compareSyncScrollfalse. Mac mainGEN1KJVAselected 1/Notes/446, sidebar239/right1660; Presenter closed at 160%. iPhone same tabdb988...PSA3LXX/no selected verses/offset0/no sheets/nine workspace tabs/CaptureKeyboardOFF. No note/message/annotation/tab creation or deletion; QA reading/history state changed legitimately.

Published precedingf6865f54 verified all three checks PASS in CI44940784658, including native and legacy jobs; this does not prove new sourcec39ca828/d9da6c36. New checkpoint publication and exact-head CI must be reverified.
