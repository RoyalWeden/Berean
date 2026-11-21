# Same-chapter history viewport restoration — 2026-11-21

## Authority and baseline

Owner reactivated the goal engine; broad migration ACTIVE. Previous goal turn made concrete progress: committed/published Presenter, Messages, image and settings refinements and produced actual UI evidence that changed the next task. No blocker/no-progress threshold is met. Stay-within-limits remains disabled; no resets.

Clean baseline ec6138cd, branch native/reader-notes in isolated Codex checkout. Live draft24/base native/m6-navigation/head ec6138cd; **all3checksPASS**, CI44894290052. Previous pending checks are now historical; they do not verify later code.

Reproduction and code analysis preserved in PRESENTER-REFINEMENT-2026-11-21: Genesis1KJVA selected1,509pt/verse7; CmdL1:20 uses same tab and Presenter follows20; Back restores1 at0 instead of509. Initial snapshot remains intact but in-memory cache can shadow it; same-chapter selection becomes an explicit reveal; native full viewport restore only runs after passageId changes.

## Work in progress

Delegate checkpoint_review owns bounded AppModel.swift/ScriptureView.swift/native ChapterTextView Mac+iOS and necessary helper/regression work. Parent owns review/docs/builds/actualUI/data checks/publication. No production/sync/schema/rawidentity changes; preserve both platforms and legacy buildability. Owner-only22→23→draft24 guards remain.

Plan: hydrate only matching cache entry from history snapshot before exposing restored tab, issue transient scoped one-shot viewport revision distinct from explicit jump, suppress selection reveal during restoration, reuse native queued layout restoration with stale-callback guards even when chapter repeats. Do not recreate host or rewrite persisted data. Without a valid saved viewport preserve ordinary destination reveal.

## Required verification

- Meaningful restoration request/revision guards and existing reader regressions; both Dev builds. Shared conformance scope based on actual changed shared code.
- Mac Back→Forward→Back restores exact509pt and20viewport; no extra tabs. Repeat rapidly, no viewport, crosschapter/crosstype, explicit Go versus localselect/clear, user scroll after restore.
- iPhone actual corresponding workflow with native controls and current Codex device only. Both image/notes/editor interactions should retain native host state.
- Presenter follows restored anchor while live; paused view remains frozen. Same-tab and source identity guards reject stale queued work.
- Final original row hashes/exact37/47activeIDs, restore MacGenesis1selected1/0.2150401351922265/Notes/sidebar239.5/right660 and iPhonePsalm3LXX9workspace tabs/no selection/no sheets. Re-query runtime/container after install; do not reuse stale tool IDs.

## Current evidence

Implementation/build/UI pending. Do not call source prototypes verified. Keep failed checks and exact next observation here.

## First implementation review

Four source files changed: AppModel,ScriptureView,MacChapterTextView,IOSChapterTextView. History snapshots overlay valid newer cached geometry without writing the tab; restore hydrates/evicts matching cache and supplies immutable scoped request/revision. While pending, same-edition checkpoints cannot replace intended geometry; completion saves actual applied geometry for Presenter. Selection/explicit-jump callbacks reject active history restore and stale requests. New history revision clears stored verse-target even when selection scope repeats. No host recreation; iPhone clears old resize anchor. Mac history consumes on first valid application (ordinary chapter layout-burst retention is unchanged); verify settled layout rather than assuming it is equivalent.

Delegate parsing/diff passes; parent reviewed all diffs. Integrated buildsession33558 usesmac-history-viewport-build.log→ios-history-viewport-build.log. Reader background/chapterpull/tap regressionssession35757 running. No actual UI pass yet. Shared package source unchanged since prior346passrun; newappbehavior needs real interactions.

## First actual Mac verification

Both integrated builds PASS. Existingreader rendering/tooltips/chapterpull/tap/selection/reflow/Compare regressionsPASS (session35757). No new shared-package source. Mac QA process11583 replacedonly; currentruntime93910/mac-history-viewport-runtime.log.

Reopened Mac geometry differs from older docs: sidebar239/rightdivider800; initialfraction0.3075862068965518. Do not force stale660layout. Newwidth reflow settledcurrentposition446pt/verse8, fraction0.3073742246726396 (initialdocscroll extent changed by1pt). CmdLGenesis1:20→Back→Forward→Back returns exactcurrentfraction ratherthan0. Then explicitlyset509pt (read-only DBconfirmedbefore snapshot history-mac-509-before.json, verse9 at currentwidth) and repeatedForward/Back3times:509fraction0.3507925568573398 versus20fraction0.7704827586206894 consistently. NativeScrollDown after restore gives0.8470020675396278;Forward→Back preserves this newer user position, so completedrequestdoesnotlockscroll.

Presenter: startingatrestored446/verse8 audience0.2128659197687026;Forward20→audience0.5975183712805686. Pause,mainBack→446/selected1,audience stays exact0.5975183712805686;Resume adopts0.2128659197687026. ClosedPresenter160%,mainselected1/Notes/sidebar239/right800/current446fraction0.3073742246726396. Mac settledsamechapter matrixPASS; crosschapter/crosstype/no-viewport and iPhone stillpending. Explicit509afterDB snapshot still desirable in finalmatrix ratherthanclaimingold509/verse7geometry.

## iPhone finding and corrective follow-up

Only CodexD0CC2F4C installed/launched; re-queriedcontainer recorded inios-container.txt; ownedsourceTabdb988d51-7bde-49c8-8749-7f2fa0ba734b remains9workspace/47globaltabs. In-readerpicker changedPsalm3LXX→Psalm118:1LXX in same tab, native drag scrolled1884pt/verse29/selected1/width402. Beforepayloadhistory-ios-before-jump.json. Picker118:90 visuallyjumps90 correctly, but savedviewportremains1884/selected1 evenaftersettled; firstBack thenForward showsselected90 atoldverse29viewport. Screenshotdirectlyconfirmed. Initialsamepassage restore solves Back butcannotfixstale reversecapture alone.

Sourcecause: iOS checkpointPosition only afterdrag/deceleration, while programmatic target setContentOffset never checkpoints. Delegate added immediatecheckpoint aftersuccessful explicitjump and afterselectionreveal whenitmoves; user-scroll hotpathunchanged, Findnotbroadened. FinalUIpending. Also reviewed lifecyclecounterexample: same-ID cross-type replacement can otherwise leavependingGenesis1requestvalidatedagainstdefaultBibleState ofnote. Hardened pendingrequestcleanup onclose/replace/workspace, dynamicBiblevalidation, and loaded-unavailableonlyclear whilekeepingintendedviewport. Loadinguntouched.

Finalintegratedbuild68403/mac-history-lifecycle-build.log→ios-history-checkpoint-build.log. PriorMacruntime93910 stilloldhardeningsource; do notclaimcross-typefinalUIpassyet. No newnotes/messages/tabs; currentiPhonePsalm118selected90atoldviewportbeforeinstall. RestorePsalm3LXX/no selection at end.

## Corrected final iPhone history verification

Afterfinaldiagnostics/headerbuild, cleanpicker118:1resetselection (a coordinatehintdismissduringearliertest hadadded38to90; resetownedlocalselection, noannotationwrite). SingleactualswipewithDeviceHubraised captured1607pt/verse25/selected1/width402. Picker118:90nowcheckpoints5749.666666666667pt/verse89offset-46/selected90 immediately. Backrestores1607exact;Forwardrestores5749.666666666667exact andscreenshotshows90. Before/destination/back/forwardJSONrecords inignoredqa folderhistory-ios-final-*. No genericwhole-word/numberidentitychanges. HeaderUIbetweencontrolsisclear; onlycapsulesblurwordsbehindthem. Additionalwidthrequest14ptnormalinsetimplementedafterthispass, finalreflow/scrollUIpending.

CurrentiPhone stillPsalm118selected90 awaitingfinalrestorePsalm3LXX/noselection andlifecyclechecks;9workspace/47globalIDs retained. Fullsharedsuite345conformancetests/90suites+4coretests=349PASS. MacinstantpalettereviewdoneinMacRoot/StudyInspector (macOS-only); build1607running. Newownerpadding8/14/26vs12/20/32willgetfinalbothbuildchecks.


## Final-source checks and newly reproduced cross-type drift

Source commits e3845c9b / da77a14c / 0d6c0ad3 / 40fb2923 are local, not yet published. Both final Dev builds passed (`mac-final-native-refinements-build.log`, `ios-final-native-refinements-build.log`). Shared package: 349 total tests pass (345 conformance plus four core). Existing native reader regressions passed before the final phone-only inset constants changed.

Final iPhone inset build was installed on the Codex simulator. Psalm 3 LXX body-tap selected verse 2 and a second tap deselected it; the outline stayed within the wider reader. Restored Psalm 3 LXX with no selection or sheets, nine workspace tabs. The long-chapter exact-position history test above preceded this cosmetic inset change; all width presets, larger type and physical-phone touch remain open.

Mac palette checks on 40fb2923: immediate typing after Cmd+K entered G5485; Actions opened with Cmd+K, first Escape closed Actions and second closed search. Cmd+L followed immediately by typing Jude 5 replaced the preselected current passage. Real outside click dismissed search without navigation. Collapsed-sidebar query entry worked; settled screenshot showed the same dimming across toolbar/content. No frame-by-frame latency measurement was taken. Sidebar reflow drift is not claimed fixed.

**New actual failure:** Genesis 1 KJVA, selected verse 1, Notes inspector, sidebar 239/right divider 800, explicit saved offset 446 points (scrollbar 0.3075862068965518). Cmd+L → G5485 → Change Current Tab reused the same UUID and seven-tab workspace. Back restored passage/selection/inspector but offset became 472 points (scrollbar 0.3255172413793103), a repeatable +26-point drift. This is not a passing cross-type result. Delegate investigating first-attachment geometry versus early consumption of the restore revision in Mac ChapterTextView. Preserve the passing warm same-chapter behavior and cancellation on user input.

**Control passes:** from the same 446-point baseline, Cmd+L → Genesis 2:5 → Back returned Genesis 1:1 at exact scrollbar 0.3075862068965518. Missing-viewport and broader rapid/cross-type matrix remain open.

Read-only final-controls-data-check.json: all original record hashes retained; exact global active tab IDs (37 Mac / 47 iPhone), 22/26 notes. Dev bundle identifiers verified. QA Mac PID 36345 has --qa-library --qa-profile codex-controls-20261119; separate owner PID 728 untouched. These PIDs are advisory and must be revalidated before lifecycle actions.


## Cross-type correction verified — 7118fff8

Mac first-mounted readers now retain the restored intent through the existing geometry-settling window after the model consumes the history revision. The completion callback fires once; same-host restores retain their one-shot semantics. Native input cancels retained geometry correction immediately, and a new passage/request invalidates it. No extra delay was added to presentation, no host recreation and no persistence/schema change.

`mac-history-cross-type-build.log` passed. First restricted build could not access Xcode compiler caches; the approved build with existing caches succeeded. Only the exact QA process was restarted, with original QA arguments. Runtime log `mac-cross-type-runtime.log`, session 79391. Actual final build: Genesis 1:1 at 446 points → Cmd+L G5485 → Back returned exact scrollbar 0.3075862068965518. Forward → Back repeated the exact result. Subsequent native scroll moved to 0.5089655172413793; the retained correction did not lock the viewport. Reset to 446 points, selected verse 1, Notes inspector, seven Study tabs, sidebar 239/right divider 800. Cross-type and earlier cross-chapter checks are bounded settled-viewport evidence; first-frame visual latency, missing viewport, and broader combinations remain open.
