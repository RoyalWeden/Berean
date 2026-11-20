# Current native migration checkpoint

Snapshot **2026-11-20T07:31:09.976275+00:00**, Codex. Read HANDOFF first; verify live state and preserve newer edits. Broad goal **ACTIVE**.

## Latest investigation — unresolved, experiments removed

Source/doc334eafbb/4e6c49fa published; exact PR24 head4e6c49fa verified OPEN/draft/base native/m6-navigation. CI44695609238 now in_progress; prior44693533700 is CANCELLED, not green. Mac inspector custom380→newBible inspectorOFF→close→Genesis returns320. Trace proved hidden width capture, but three actual UI-checked fixes failed (capture guard; conditionalideal; omit closed content). All experimental code/diagnostics removed; published Mac source restored. See [precise evidence and rejected approaches](READER-VIEWPORT-RESTORATION.md#2026-11-20--width-drift-reproduced-attempted-fixes-rejected). Never claim this fixed or blindly repeat those attempts. Final published-app restoration build /private/tmp/berean-inspector-published-restore-build.log; BUILD SUCCEEDED; exact published app reinstalled/relaunched without trace flags, final AX confirms original1148/scroll0.5782918149466192/Genesis1selected1/Notes/sidebar239. All CUA phases summarized; no GUI task pending. Final read-only preservation checks repeated PASS for20/25prior notes,37/47activeIDs/alltags after every width experiment.

## Source and review

- Checkout /Users/roywe/Documents/ChatGPT/Berean/repo, branch native/reader-notes; latest implemented source **334eafbb** (LXX attachment labels and iPhone editor teardown), following7e8142f9 Scripture blocks/Settings and published doc9a210789.
- Source334eafbb is locally committed; publication/doc head may follow. Verify actual remote/head checks before claiming published or green. Last remotePR24 head9a210789 OPEN/DRAFT/base native/m6-navigation. Pushgithub only; origin is owner's local repo.
- Owner-only22→23 after correct retarget/checks→draft24. No merge/retarget/ready/force.
- Prior9a210789 CI44693533700 is now CANCELLED, not green; earlier legacy/Mac shared/AppKit steps had succeeded before cancellation. New publication-head44695609238 in_progress at latest poll. No manual restart/cancellation requested. Priorcf0c6438/1f4e7361 CI success;9fb67f8b cancelled. None proves new source CI.

## Completed validation and data

- **296shared tests PASS** (4core+292conformance/70suites), both native development builds PASS, actual Mac+iPhone note attachment/link checks and iPhone edited-note Trash/dock recovery without restart PASS. [Exact evidence and limitations](NOTE-LABELS-EDITOR-LIFECYCLE-2026-11-20.md).
- All20Mac/25iPhone prior note rows/timestamps, all3tag tables and exact37/47active tabIDs unchanged. Owned fixtures2ed8f256-5c50-4aa6-8bd4-e5297c28ca3e /007f9551-d946-4896-923e-a9767aa4dfcd recoverablytrashed; extra test tabsclosed. Original16/17notes included. RawPSA.3.2 IDs unchanged despite displayed3:1.
- Mac only /private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119 (com.berean.native.mac.dev). Final Genesis1KJVA/selected1/Notes1:1/sidebar239/rightdivider1148/scroll0.5782918149466192 restored. Exact path/arguments/PID required before lifecycle; other app copies share bundleID.
- iPhone only D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D /com.berean.native.ios.dev, last PID40249. Current container in /private/tmp/berean-note-keyboard-ios-container.txt; re-query after installs. Final Psalm3LXX/no selection/Strong'sCompareOFF/no sheets/dock visible/CaptureKeyboardOFF/ZoomToFit.
- Preferences untouched this batch; previous formatfalse/default90%, Macdetectrefsfalse/iPhonedefaulttrue. No clipboard operations or TextEdit changes this batch. Prior helper/clipboard lessons [here](SIMULATOR-CLIPBOARD-QA.md).
- Full tests /private/tmp/berean-label-focus-full-tests.log, targeted /private/tmp/berean-label-focus-tests.log, builds /private/tmp/berean-label-focus-{mac,ios}-build.log. Established cache /private/tmp/berean-scripture-block-final-dd and swift cache /private/tmp/berean-study-block-tests. No build/test process pending; all CUA phases summarized.
- Owner removed final Ollama shortcut; verified absent file/symlink. Cleanup complete; do not retry admin actions. [Record](OLLAMA-REMOVAL-2026-11-19.md).

## Next executable work

1. Publish source/doc normally if not already done; verify exact-head PR/draft/base and CI. Re-poll confirmed live jobs; no reset/restart on timeout.
2. Reproduce/trace Mac study-panel right-divider drift on return from a tab whose inspector is closed. This test returned1168 instead of1148; UI restored. Relaunch this time preserved exact scroll. Do not conflate partial observations with a universal viewport fix.
3. Extend iPhone keyboard UI matrix: software keyboard, two focused editors/rapid tab switches, multiple scenes/physicalphone. Dock Trash hardware/accessory path is verified; ordering unit tests cover obsolete teardown.
4. Continue WordReplacer persisted/custom/per-rule revisions, rich/read-only Notes/reference grammar/tracking, general pane splits/history/cursor, Kokoro. No Apple voices. Use [TASKS](TASKS.md), [FOLLOWUP](FOLLOWUP-2026-11-19.md), [parity](FULL-FEATURE-PARITY.md), [principles](OWNER-PRINCIPLES.md), [map](DOCUMENTATION-MAP.md).

Maintain continuous notes during work and before handover. Previous checkpoint preserved in CHECKPOINT-HISTORY-2026-11-20.md. Tests and this batch do not complete the migration.
