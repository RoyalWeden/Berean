# Historical working checkpoint — not current instructions

Archived before the final Scripture-block checkpoint. Read HANDOFF and CURRENT-STATE first. The unfinished/temporary runtime labels below were superseded by the completed cleanup and source evidence in SCRIPTURE-BLOCKS-2026-11-19.

# Current native migration checkpoint

Snapshot: **2026-11-20T06:04:39+00:00**. Last writer: Codex. This is a checkpoint, not a live worker lock. Recheck actual Git, PRs, jobs and app/library state before acting. Read [HANDOFF](HANDOFF.md) first and follow [AI-CONTINUITY](AI-CONTINUITY.md). Preserve newer changes instead of forcing this snapshot onto them.

## Repository and review

| Item | Last verified state |
| --- | --- |
| Codex checkout | `/Users/roywe/Documents/ChatGPT/Berean/repo` |
| Branch | `native/reader-notes` |
| Latest implemented source checkpoint | **`1f4e7361020c23113d486b240534ea5a6a92bdf1`**, published to GitHub |
| Latest source behavior | Aligned native study hover previews, actual cited verse text, honest chapter symbols, separate mentions/passages and direct category routes |
| Draft PR | [#24](https://github.com/RoyalWeden/Berean/pull/24), base `native/m6-navigation`, still draft |
| Current source CI at observation | [44683148736](https://github.com/RoyalWeden/Berean/actions/runs/44683148736) / `1f4e7361020c23113d486b240534ea5a6a92bdf1` — completed SUCCESS; native and legacy jobs passed. The CI Mac-build step was skipped; the final local Mac build below passed |
| Last fully green source checkpoint | [44683148736](https://github.com/RoyalWeden/Berean/actions/runs/44683148736), head `1f4e7361`, native and legacy jobs SUCCESS. Prior baseline: 44678258734 / `de4c37f4` |
| Local final builds | `/tmp/berean-study-preview-publish-mac.log` and `/tmp/berean-study-preview-publish-ios.log`, both PASS |
| Shared tests | Last full274 =4core+270conformance/66suites, `/tmp/berean-study-block-full-tests.log`. Shared package unchanged in1f4e7361; do not call this a new preview interaction test |
| Push destination in this checkout | `github` → RoyalWeden/Berean. `origin` is the owner’s local repository; do not push to it |
| Review guard | Owner-only #22→#23 after correct retarget/checks→#24. No merge/retarget/ready action authorized by broad continuation |
| Documentation work | This continuity/preview documentation checkpoint follows the published source commit. A documentation-only Git HEAD can be newer while source remains1f4e7361. At the published source/docs checkpoint there was no shipping-code WIP. Subsequent active local WIP is listed below; inspect it before editing. Always inspect actual dirty files/head and exact-head CI |

#22 and#23 were verified OPEN, bases main and native/m7-export respectively. These are dated observations: recheck if the owner has advanced them. Do not reset or blindly pull over other AI/owner work.

## Safe runtime and data

- **Only Mac QA copy:** `/private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119`. Development bundle `com.berean.native.mac.dev`; diagnostics OFF in the final installed build. Verify exact path/arguments/PID before a lifecycle action; other copies share the bundle ID.
- Mac library: native Dev container Application Support/BereanNativeQA-codex-controls-20261119. Original16note hashes/timestamps, exact37active tab IDs and all3tag tables unchanged. Baseline `/private/tmp/berean-codex-controls-qa/baseline.json` is temporary evidence, not a reset target.
- **LIVE starting/final Mac layout:** Genesis1KJVA, selected verse1, Notes inspector scoped to Genesis1:1, sidebar divider239, scrollbar **0.5782918149466192**, Strong’s/CompareOFF. This supersedes earlier top0/CrossRefs assumptions. AX scrollbar setValue restored the exact fractional value. Preserve newer live state if the owner changes it.
- Latest own attached test note `0c0ed7f5-06c2-487d-a05e-da94032710d8` (Preview Alignment QA, GEN.1.1) is recoverably trashed and its extra tab closed. It contained only John3:16 and Psalm3:1LXX. Previous owned test notes are also in Trash; global row counts can therefore exceed the original-note count.
- **iPhone QA only:** simulator `D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D`, native Dev bundle `com.berean.native.ios.dev`. Last container `394BBFCA-AC07-49CA-AC6F-C32E74A8E2AB`, PID22685; authoritative latest path was saved to `/private/tmp/berean-note-keyboard-ios-container.txt`. Re-query after every install; never trust the UUID/PID after a gap.
- iPhone original17note hashes/timestamps, exact47active IDs and all tag tables unchanged. Final screenshot Psalm3LXX, no selection, Strong’s/CompareOFF, no sheet, Capture KeyboardOFF. No physical-phone or other simulator interaction.
- Baseline evidence: `/tmp/berean-table-format-ios-note-baseline.json`, `/tmp/berean-table-format-ios-tab-baseline.json`, `/tmp/berean-study-tags-ios-baseline.json`. If these temporary files disappear, establish a new read-only baseline of current data; do not restore old content to match this document.

## What was actually verified

[STUDY-PREVIEW-ALIGNMENT](STUDY-PREVIEW-ALIGNMENT.md) has exact reproduction and limits. A disposable verse note produced a native card containing full John3:16 and Psalm3:1LXX title+opening body. Arrow alignment was checked at top and after scrolling; scroll dismissed it. Numeric screen/window/content anchor round trips matched exactly. Final regular clicks verified mention-only My Notes routing and chapter scope/tag access. Owned fixture cleanup and original-data comparisons passed.

CUA has no hover operation. DEBUG development QA Option-click (`--qa-library --qa-study-preview`) exercised the same preview/anchor with a real key window; this proves rendering/geometry, not continuous physical hover/450ms delay, cursor feel, VoiceOver, every display/resize or every long/combined passage. Final runtime does not retain the diagnostic flag. Earlier2-line compression was found and fixed; the final card showed complete short verses.

## Next executable work

1. Read the live dirty tree and exact published-head checks. Do not rerun a live job just because an observation timed out. This documentation checkpoint is intended for publication immediately after source1f4e7361. Verify its actual publication/dirty state, then proceed to app work; do not repeat completed documentation work.
2. Resume **automatic Scripture block presentation** using [NOTES-AUTOMATIC-BLOCKS](NOTES-AUTOMATIC-BLOCKS.md). The [candidate/ratio draft](prototypes/NoteScriptureBlocks.swift.txt) is **UNTESTED, not compiled and not a delivered feature**. Add pure tests and Hermas/edition handling, then canonical Bible verification with bounded caches/stale guards, legacy noteScriptureBlock=false/threshold0.9 settings, and both native editors. Preserve source/UTF16/Undo/table safety and reference tracking. Do not ship recognition alone as verification.
3. Complete Word Replacer persisted/custom/per-rule handling across one revision-aware reader/search/preview/copy/export pipeline. The current Settings browser/master switch is not full rule-editor parity.
4. Continue actual filter/cursor/hover work. StudyInspector pane-actions ellipsis around199 still attaches optionHover inside its Menu label; search scope/tag controls already use the outer control. Physical hover cannot be declared proved by the QA preview entry.
5. Continue broader all-tab history/scroll/restoration, native scrolling/pull feel, generic split hosts/routing/persistence, rich Notes/read-only/history/sharing parity and Kokoro. No Apple voices. Use [TASKS](TASKS.md), [FOLLOWUP](FOLLOWUP-2026-11-19.md), [audit](AUDIT-2026-11-14.md) and [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md); do not lose older unfinished owner requests.

The broad migration goal remains **ACTIVE**. A new feature batch, green PR, documentation update or exhausted usage is not completion. Keep current notes updated as work proceeds.

## Active interruption — Ollama cleanup request

The owner asked to remove unused Ollama models/application from this Mac to recover disk space. Read-only inventory and careful removal are the active task; preserve Berean source/data and do not treat its optional AI integration as authorization to remove other AI tools/models. Native work just resumed: uncommitted `Packages/BereanKit/Sources/BereanNotes/NoteScriptureBlocks.swift` is Codex-owned candidate/ratio implementation copied from the preserved draft, now with Hermas and reference-space handling. It is not compiled/tested/wired yet. Do not discard it or claim delivered formatting. Resume canonical verification/settings/both editor integration after cleanup.

Cleanup complete except the administrator-owned dangling shortcut; see [OLLAMA-REMOVAL-2026-11-19](OLLAMA-REMOVAL-2026-11-19.md) for exact paths/evidence. No running Ollama or usable CLI remains. Resume native app work; this environment task does not complete the migration.

## Active native implementation — automatic Scripture blocks

Codex-only WIP now spans two new BereanNotes source files (NoteScriptureBlocks/NoteScriptureSelection), two corresponding test files, NotesViews/NoteTableLayout/AppModel/SettingsView and both native RichNoteEditors. Scanner, complete selection and threshold tests **16 PASS** in `/private/tmp/berean-scripture-selection-tests-final.log`. Source now supports source-preserving single/multiline/chapter/disjoint/cross-chapter recognition, Hermas parser grammar, complete LXX reader-row verification, legacy false/0.9 settings, both-editor cards and bounded/debounced stale-guarded verification. **Not delivered/committed/UI verified yet.**

Mac build is live: session55607, `/private/tmp/berean-scripture-block-mac.log` (source was edited while this provisional build was preparing; final builds are still required). Pending full shared suite and iOS build, then isolated Mac+iPhone fixture/UI/source/Undo/settings checks. Swift test startup initially waited on cloud-offloaded tracked legacy audio source during Git status; restoring necessary individual tracked paths allowed the same live run to proceed. Never restart just because a poll is quiet. Temporary draft remains historical, not current implementation.

### Latest verified native-block checkpoint

Full shared suite **290PASS** (4core+286conformance/68suites) `/private/tmp/berean-scripture-block-full-tests.log`. Final source Mac+iOS builds both PASS: `/private/tmp/berean-scripture-block-publish-mac.log`, `/private/tmp/berean-scripture-block-publish-ios.log`, temporary derived data `/private/tmp/berean-scripture-block-final-dd`. Verified development identities. Earlier repository-cache provisional Mac build was cancelled only after both final builds succeeded; it was blocked on an offloaded12GiB compilation index and is not a pass.

Actual Mac CUA: single/multiline/LXX and duplicate quotes rendered four cards; unrelated commentary plain, table remained formatted; one Undo removed the entire paste, Redo restored it; editing one duplicate into unrelated commentary removed only its card; Undo restored it. Formatting and auto-link switches were independent. Exact saved source matched pasted fixture. Owned note `cf45c4a8-6e0a-4ee7-954a-e3df7a0a89d3` is now trashed and extra tab closed; all19existing note-row hashes/timestamps (including previous recoverable fixtures),37active IDs/all3tag tables unchanged. Original refs false/format false restored; main reader returned to Genesis1selected1, Notes1:1, sidebar239/rightdivider1148/scroll0.5782918149466192. Settings window remains open behind it; close via verified lifecycle/native window control, not CmdW while Settings is focused. Evidence `/private/tmp/berean-scripture-block-mac-{baseline,fixture}.json`, `/private/tmp/berean-scripture-block-fixture.txt`.

**iPhone testing ACTIVE, not proved yet.** Updated only established simulatorD0CC2F4C… after read-only baseline24existing notes/47active IDs/alltags. Container re-queried after install: `086BDCF5-BB01-4E47-B029-82440EA6D246`, PID34792; bundlecom.berean.native.ios.dev. CUA DeviceHub binding blockPhone, appcom.apple.dt.Devices, iPhone18Pro selected; CaptureKeyboardOFF. Current native app Settings sheet open, scrolling toward Notes; no iPhone setting changed/test fixture created yet. CUA screenshot/input is2x; actual screen x522–818 screenshot (~1044–1636 input), y85–725. Some drags beginning on controls do not pan; fast CUA swipes have strong inertia. Read a settled screenshot before any toggle. Baseline `/private/tmp/berean-scripture-block-ios-baseline.json`. No other simulator/phone/sharedMac touched. Finish iPhone fixture/settings/edit/cleanup/source checks, update docs and publish this source; do not lose Codex WIP.

### iPhone navigation refinement — live QA checkpoint

Long mixed iPhone Settings Form replaced with six native category links matching Mac panes; Haptics moved under Appearance, all existing bindings retained. Navigation build `/private/tmp/berean-scripture-block-navigation-ios.log` PASS. Latest install container `D979C134-F582-414A-AED5-EF5D1B25D673`, PID35460; authoritative path saved `/private/tmp/berean-note-keyboard-ios-container.txt`. Root six categories and Notes drill-down visually verified. **Format Scripture Blocks is temporarily ON on iPhone at90%; restore OFF before final cleanup.** All other iPhone preferences untouched, CaptureKeyboardOFF. Current Notes Settings screen (no fixture created yet); Back top-leftscreenshot550,158/input1100,316. Format switch screenshot779,458/input1558,916 while enabled rowposition remains458. Continue all-route navigation, owned Notes fixture/paste/source/Undo checks, restore settings and originalPsalm3LXX. DeviceHub drag caused large inertial jumps; do not equate those with physical-phone behavior. Settings categories are actual UX work, not diagnostic-only QA controls.

### iPhone actual blocks verified; cleanup still active

All six new Settings routes/Back verified, Shortcuts typed `copy` returned two expected commands and was cleared. Format blocks temporarilyON90%; restoreOFF. Body tap selectedPsalm3LXXverse1 with grouped dashed/faint fill; AddNote produced owned `f1fe721c-0d9b-478b-9979-741946f9a26b`, attachment rawPSA.3.2/textlxx. All four matching cards rendered (John single+multiline, LXXPsalm andduplicate); unrelated commentary unboxed and table stayed a table. Saved pasted source EXACT703chars, including after nativeUndo/Redo. Owned note now recoverablyTRASHED; all24prior note-row hashes/alltags unchanged. Extra owned tab `09f1f557-de10-4240-a23d-e06aea628c77` remains open asNotes and must be closed; baseline47IDs must return. `/private/tmp/berean-scripture-block-ios-fixture.json`.

**Clipboard QA lesson:** CUA.paste while DeviceHubCaptureKeyboardON pasted the simulator's prior clipboard, not its temporary host text. Undo corrected the owned fixture; no pasted content was executed. TypeText triggers normal iOS autocorrection (believeth→believers), so it is not exact paste proof. Successful exact method: create a NEW plain-text TextEdit document, CUA.paste fixture locally, CmdA/CmdC; CaptureOFF in DeviceHub, Edit→SendClipboard to selected iPhone18ProSimulator, CaptureON then nativeCmdA/CmdV in owned note. Exact DB check passed. CUA bindings blockClipboard (new Untitled document, owned; existing berean-reference-block-qa.txt untouched), blockPhone DeviceHub. **Close the new TextEdit document without saving** after cleanup and restore known original nonsensitive clipboard command if still appropriate; do not inspect unrelated private clipboard data. No global shared-clipboard preference was changed.

**Additional OPEN reproductions:** attachment label showsPsalms3:2LXX while reader/title correctlyshow3:1 (storedPSA.3.2mustnotchange). After trashing the editing note, Notes list lost bottomdock: Root keyboardUp likely remains true when nativeUITextView disappears without didEndEditing; no dismantleUIView yet. CaptureKeyboardON currently. Native app lifecycle restart on only simulatorD0… is being used to recover test navigation, not claimed as a product fix. RestoreFormatOFF, close exactownedextraTab, returnPsalm3LXX/no selection/CaptureOFF. A fast batched Back→Done in Settings coincided with toggling reader toKJVA; restoredLXX explicitly, retest Done with separately observed root before concluding click-through productbug.


## Superseded by label/editor-lifecycle batch 2026-11-20T07:31:09.976275+00:00

# Current native migration checkpoint

Snapshot **2026-11-20T07:12:57+00:00**, Codex. Read HANDOFF first. This is not a worker lock; verify live Git/GitHub/process/app/library before acting and preserve newer edits.

## Live work in progress — 2026-11-20

Codex owns dirty changes for LXX attachment display and owner-scoped iPhone editor-focus teardown: NotesViews, IOSRootView, RichNoteEditorIOS and new BereanNotes label/focus helpers plus their regression tests. Implementation is not yet runtime-verified. Focused test process is live; /private/tmp/berean-label-focus-tests.log. Existing published head9a210789 was verified; CI44693533700 remains in_progress at latest poll. Do not restart it or overwrite these edits. Previous goal turn verified Ollama cleanup; this turn resumes implementation.

## Source, review and verification

- Checkout /Users/roywe/Documents/ChatGPT/Berean/repo, branch native/reader-notes.
- Latest implemented source **7e8142f94febbb35a609d2398dba9b8f0795fb76**: verified automatic Scripture-block presentation on both native editors and categorized iPhone Settings. A later documentation-only head can follow it.
- Draft PR24, base native/m6-navigation, last verified OPEN/draft. Last remote observation was cf0c6438 before this source/doc publication. **Verify actual remote head and its own checks**; if source7e8142f9 is already published, resume app work rather than repeating publication.
- Prior exact cf0c6438 CI44686490619 SUCCESS; source1f4e7361 CI44683148736 SUCCESS. Continuity-only9fb67f8b run44685554261 was CANCELLED, not green. None proves new-source CI.
- New source local validation **290tests PASS** (4core+286conformance/68suites), both final development builds PASS; actual Mac+iPhone Simulator interactions and source/data checks passed. See [SCRIPTURE-BLOCKS-2026-11-19](SCRIPTURE-BLOCKS-2026-11-19.md) for logs, limits and cleanup. New publication-head CI must be rechecked.
- Pushgithub in this clone; origin is the owner's local repository. Owner-only merge22→23 after correct retarget/checks→draft24. No merge/retarget/ready/force action.
- All shipping-code WIP was committed as7e8142f9. Documentation may still be dirty until its own checkpoint commit; inspect actual status. Historical prototype is superseded, never copy it over live code.

## Safe runtime and data

- Mac only /private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119, development IDcom.berean.native.mac.dev. Final build installed; diagnosticsOFF; test Settings window closed by verified isolated lifecycle.
- Mac Genesis1KJVA, selected1, Notes inspectorGenesis1:1, sidebar239/rightdivider1148, scrollbar **0.5782918149466192** explicitly restored after final relaunch. Preserve newer live state, not this snapshot. Several app copies share a bundle ID; verify exact path/arguments/PID before stopping/replacing.
- iPhone only simulatorD0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D / com.berean.native.ios.dev. Last container **D979C134-F582-414A-AED5-EF5D1B25D673**, PID36782. Re-query after every install; path file /private/tmp/berean-note-keyboard-ios-container.txt. Final Psalm3LXX, no selection, Strong’s/CompareOFF, sheets closed, Capture KeyboardOFF/ZoomToFit.
- Both format settings restoredOFF/default90%; Mac reference detection restoredfalse, iPhone defaulttrue preserved. Source703chars exact after Undo/Redo and Trash.
- Owned Mac notecf45c4a8-6e0a-4ee7-954a-e3df7a0a89d3 and iPhone notef1fe721c-0d9b-478b-9979-741946f9a26b recoverablyTRASHED; extra tabs closed. All19Mac/24iPhone prior note-row hashes/timestamps (including prior owned Trash),37/47exact active IDs and all3tag tables unchanged. Original16/17notes are included.
- TextEdit helper closed, prior reference fixture window/selection restored; auto-saved synthetic helper moved out of iCloud to /private/tmp/Bible Verses and Commentary.txt, exact fixture intact. Known original non-sensitive clipboard restored to host/selected simulator; no global sharing preference changed. [Clipboard QA](SIMULATOR-CLIPBOARD-QA.md) prevents repeating this trap.
- Owner-requested Ollama models/app cleanup is separate: models deleted/app/settings in recoverableTrash; only negligible admin-owned dangling shortcut remains. See [OLLAMA-REMOVAL](OLLAMA-REMOVAL-2026-11-19.md). No need to retry privilege/password bypass.

## Next executable work

1. Verify current source/doc publication and exact-head CI; re-poll confirmed live jobs rather than restarting on timeout. No native GUI work is currently pending; all CUA phases received completion summaries.
2. **Fix LXX note attachment presentation**: rawPSA.3.2 displaysPsalms3:2LXX despite reader/title3:1. Use reader mapping for display, keep raw IDs/golden Reference unchanged. Add range/combined/whole/multi-attachment tests and actual note-link UI checks.
3. **Fix iPhone dock after editor removal**: trashing an editing note left keyboardUp true/no dock. Begin/end notifications have no dismantle cleanup; audit ownership/order across trash/navigation/tab switching and hardware/software keyboards. QA relaunch is not a fix.
4. Reproduce Mac Notes-return/relaunch viewport/right-divider drift with real trace; separately observed Settings Back/Done worked, so don't call the fast-batch flip a proved productbug.
5. Continue Word Replacer persisted/custom/per-rule revision handling, remaining hover/cursor controls, all-tab history/scroll, live generic splits, rich/read-only Notes/sharing/backlink grammar and Kokoro. No Apple voices. Follow [TASKS](TASKS.md), [FOLLOWUP](FOLLOWUP-2026-11-19.md), [parity](FULL-FEATURE-PARITY.md), [principles](OWNER-PRINCIPLES.md) and [map](DOCUMENTATION-MAP.md).

Maintain notes continuously. Broad goal remains **ACTIVE**; tests, a source/doc commit or this batch do not complete the migration. Previous working notes were [archived](CHECKPOINT-HISTORY-2026-11-20.md), not erased.
