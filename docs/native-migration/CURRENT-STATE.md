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
| Documentation work | This continuity/preview documentation checkpoint follows the published source commit. A documentation-only Git HEAD can be newer while source remains1f4e7361. No shipping-code WIP is left in this snapshot; the preserved Scripture draft is uncompiled documentation. Always inspect actual dirty files/head and exact-head CI |

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
