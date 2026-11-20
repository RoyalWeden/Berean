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

## 2026-11-19 — Native inspector lifetime and width

Root now owns one inspector independently of the document ID, with a tab-ID transaction suppressing inherited animations. Native pane-width measurement (public NSView/NSSplitView) records only after250ms quiet. Content GeometryReader feedback and transient opening-width capture were rejected after actual shrinking/rewrap reproductions. Passing Notes-return values0.4002859185132237/split878 and0.4609053497942387/split938 preceded final minimum-frame polish. First constrained Compare still changes native width/reflows; all-type toolbar/history/resize/rapid-state/physical frame pacing are open. Do not infer physical smoothness from AX settled values. New sidebar240/panel320/window1000 limits and native/content constraints keep controls contained; manual drag matrix remains inconclusive.


## 2026-11-20 — Width drift reproduced; attempted fixes rejected

On published334eafbb/4e6c49fa, final label/dock QA again exposed right-divider1148→1168 (340→320pt pane). Temporary opt-in QA-only native trace was added, built and exercised, then **removed**. First log destination/private/tmp was unavailable inside the app; corrected to UserLibrary.directory in the isolated QA profile. Evidence copied read-only to /private/tmp/berean-inspector-width-trace.jsonl. No text/notes were logged.

Exact strong reproduction: set Genesis1 inspector splitter1108 in1488pt window (380pt pane); wait through ordinary UI observation; CmdT→Psalm3:1LXX (inspectorOFF)→CmdW (auto-selects Search)→select originalGenesis1. Published and each attempted fix returned splitter1168 (320pt), while scrollbar0.5587188612099644 stayed exact. Notes→Reader alone retained1108 in a separate traced pass. Thus this is not proved to be every Notes return or a general scroll-save failure.

Trace: visible pane380 was remembered; closing into a new Bible tab produced native width140 then320 while inspector content still existed;250ms later root remembered320. Native split panes read[1488,320] (do not infer conventional nonoverlapping split layout from these widths). Returning toGenesis used320. Hidden measurements can overwrite remembered width, but suppressing that alone did not restore the actual reopened native pane.

Rejected after actual identical UI regression, not published:
1. Visible-active-tab guard on width callback: buildPASS, still320.
2. Same guard plus conditional ideal width to force change on reopen: buildPASS, still320.
3. Same guard plus omit StudyInspector content while bindingfalse, normalideal retained: buildPASS, still320.

All experimental code/trace and flags removed; restored exact committed MacRootView and rebuilt/reinstalled published QA app. No failed attempt is a delivered fix. Do not repeat these three as untested new ideas. Next investigate native inspector saved-width restoration/constraints and attachment-time actual pane frames, without adding delays/fighting user resize or destroying document scroll state. Consider a controlled public NSSplitView restoration only after proving which native pane/geometry is authoritative; no such mutation has been implemented/tested here.

Original pane1148/scroll0.5782918149466192/Genesis1selected1/Notes1:1/sidebar239 restored through UI. Intermediate resizes legitimately changed scroll reading; app relaunch twice preserved original exact value but another prior diagnostic relaunch yielded0.5587188612099644, so universal relaunch/resize stability remainsOPEN. Final restoration/build/data/CI details in CURRENT-STATE. Physical trackpad pacing and all-type/multiwindow/rapid races remainOPEN. No production/shared profile changes.
