# Mac reader viewport restoration — 2026-11-19

## Reproduced failure and evidence

In the isolated Mac QA profile, Genesis1 at a settled midchapter scroll position jumped after Notes→Reader return. Initial scrollbar readings moved0.193998→0.381657 and0.314877→1. These were real settled viewports, not merely early accessibility snapshots.

Opt-in temporary diagnostics identified the lifecycle error. An outgoing reader saved offset2050 with clip416×572. Its replacement ran the one queued restore callback with no window and clip0×0/document height1166.8, clamping offset2050 against temporary layout. Once attached, it captured offset437. Saving a correct number was insufficient because restoration happened before the native viewport existed.

The retained diagnostic evidence is `/private/tmp/berean-codex-qa/viewport-trace.jsonl`. Temporary trace code/flag handling was removed from final source; do not depend on that diagnostic flag in future launches.

## Final change

ChapterPullScrollView owns one pending viewport action. Window attachment, frame sizing and layout consume it only with positive clip/document width and positive clip height. The action clears before execution to avoid reentrancy. Both saved-position restoration and explicit verse jumps use this lifecycle gate, retaining passage/target/revision/selection guards. Dismantling cancels pending actions. Position capture rejects zero-sized geometry. No persisted viewport schema/identity change.

Normal touch-release and momentum-end events also stop synchronously saving through AppModel. The existing350ms idle checkpoint remains, plus native dismantle capture. A committed chapter pull still captures its outgoing position immediately. This removes avoidable model/view updates during the momentum handoff; **physical trackpad frame pacing remains unverified**. Do not mark the user’s choppiness report fully resolved from CUA wheel events.

## Verified after fix

- Same narrow Mac view and offscreen Genesis1:1 selection; settled scrollbar0.2734573119188504 before and after Notes→Reader, Search→Reader, and after an explicit temporary new John3:17 tab was closed and the original reader selected.
- Trace restore647 ran attached with416×572 geometry; before/after pixel offset647 retained.
- New-tab John3:17 opens with the selected verse visible. That tab was closed individually. Close chose the next Search tab by existing behavior; selecting the original Reader restored its position. Do not mistake that Search scrollbar for the reader’s position.
- Final build with all trace code removed and zero-size capture guard repeats Notes→Reader exact0.2734573119188504. Relaunch restores the same reader position too.
- All13copied note hashes/timestamps,38original active tab IDs and tag rows match the isolated baseline. Human-used QA library never restored or edited by these checks.

Build logs `/tmp/berean-study-filter-final-{mac,ios}.log` PASS. Full255tests=4core+251conformance/64suites PASS,133.637s conformance, `/tmp/berean-study-filter-final-full-suite.log`. Package tests verify models/compatibility; the actual view lifecycle proof is the Mac UI/trace evidence above. Hardware scrolling, resizing during restore, rapid multi-window/edition/pull races and all tab-type combinations remain open.

## New separate reproduction — 2026-11-19

After Mac temporary Search ever→CmdL G26→close current temporary tab (auto-selects existing Exodus32 Compare)→Genesis1 reader, settled scrollbar changed from0.2734573119188504 to0.3753169907016061. Same narrow900pt window/profile; subsequent Note→Reader and app relaunch retained new value. No reader/Compare edits in this increment. Investigate transition geometry/anchor capture; do not call original zero-size gate a universal fix. Current isolated fixture intentionally retains observed state; original note/tag/active-tab invariants remain intact.

## Follow-up fixed and verified — 2026-11-19

Trace proved restore888 at temporary320pt was correct, but later320→756→416pt inspector layout moved the capture to1323. Disabling the tab-change transaction did not solve the native sequence and was reverted. Commit8f680362 retains the latest immediately applied saved/explicit intent across changed viewport/document geometry, releases after0.5s layout quiet, cancels on wheel/key/mouse/scrollbar input and avoids persisting transient restore captures. It does not wait0.5s before displaying the position.

Trace offset710 remained710 across320/756/416; repeated UI Compare returns exact0.3000845308537616. Immediate scroll produced0.5418427726120034 and remained; final no-trace build/relaunch/Compare return/ChapterActions open+cancel retain this exact value. Layout-only evidence /private/tmp/berean-codex-qa/viewport-followup.jsonl. No diagnostic source/flags retained. Physical momentum pacing, user resizing, slow delayed layout beyond quiet window and command races remain open; do not claim all viewport cases complete.
