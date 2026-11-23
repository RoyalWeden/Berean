# Current native migration checkpoint

2026-11-23, Codex. **Broad migration goal ACTIVE.** Start with [HANDOFF](HANDOFF.md), [owner principles](OWNER-PRINCIPLES.md) and [continuity contract](AI-CONTINUITY.md).

## Source and review

- Working repo `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`. Source committed through **7b694f3c**: `7e69e745` picker labels, `c6d2267d` rich-reference cursors, `07e8a99b` result feedback, and `7b694f3c` active independent Compare history. Temporary diagnostics removed. All source workers frozen; remaining dirty files are continuity/evidence documentation. Parent owns publication and the scheduled installation.
- PR #22 was last observed open against main, #23 against `native/m7-export`, and draft #24 against `native/m6-navigation`. Recheck the published head and its checks live. Prior green CI covers its own revision. Push only to verified GitHub remote `github`. Owner-only merge order remains #22 → #23 after correct retarget and green checks → draft #24. No merge, ready, retarget or force.

## Verified candidate and open cases

- Latest working candidate Mac build (session 66510) and iOS Simulator retry build passed. The full native package run passed **381 tests across 95 suites**, and the active-visit focused retry passed **11 tests**. The full suite predates the final Mac geometry-only retry refinement. The first focused run failed during cloud source materialization. Evidence is under ignored `build/apple/qa-evidence/20261123`; retain failed logs. Source folders and repo Git metadata were kept downloaded without changing global iCloud settings.
- [Compare active visit](COMPARE-ACTIVE-VISIT-2026-11-23.md): Mac independent older-visit cold replay and one-pane negative-crop retry passed. In `mac-active-visit-retry-runtime.log`, the right restored row 8 at crop −12.5 versus saved −12 and the left row 5 at crop 0 versus saved −1. The separate latest left destination remained row 12. Earlier fractional differences alone reflected lazy extent estimates. iPhone active-visit, explicit same-chapter cold replay, empty older visits, and aligned or stacked cold history remain unverified. The earlier [independent precision pass](COMPARE-PRECISION-2026-11-23.md) remains bounded evidence.
- [Picker, cursors and search hover](PICKER-CURSORS-HOVER-2026-11-23.md): Clement Book 1–10 and the Hermas sections passed on Mac and iPhone. Notes and Messages references, ordinary text selection and tested context menus passed. Native AppKit glyph-region probes passed. Physical pointer hover and flicker, Lexicon Command-click, and Compare Strong’s routing remain open. Search cold-open and title restoration also remain open.
- [Reference cursor audit](REFERENCE-CURSOR-AUDIT-2026-11-23.md), [selection runtime](SELECTION-RUNTIME-2026-11-23.md) and [reader-return diagnosis](READER-RETURN-DIAGNOSIS-2026-11-23.md) describe the distinct remaining checks. Ordinary main-reader viewport return drift remains open. Earlier Notes slash and Lexicon checks are in [Notes runtime](NOTES-SLASH-RUNTIME-2026-11-23.md) and [Lexicon excerpts](LEXICON-EXCERPTS-2026-11-23.md).

## QA runtime and data

- Mac QA profile `codex-controls-20261119`: the newer baseline is Search “voice of joy,” Jeremiah 33:11, the Thursday Nov 19 note, and LXX-left/KJV-right Compare. It supersedes the earlier Genesis target. Reverify the running app path and arguments, current tab and viewport before further interaction.
- Owned Simulator D0CC only for routine QA. The observed iPhone picker return was Matthew 5, selected verse 12, nine workspace tabs. Requery the simulator container after installation. Preserve the separate E8B simulator and owner Mac app.
- Original watched content hashes and all 37 Mac and 47 iPhone active tab IDs remain unchanged. Recoverable Trash contains two owned Mac fixtures and one owned iPhone fixture. Preserve the Presenter stash and production data, sync and identities. No Apple voices or quota resets.

## Owner builds and scheduled phone action

- The owner requires verified builds in `/Users/roywe/Berean-native` before usage or context handoff and simple Mac/iPhone Terminal commands. See [install-ready checklist](INSTALL-READY-HANDOFF.md). The clean owner checkout was safely fast-forwarded to app source **7b694f3c**, then documentation-only **c5713215**, preserving local signing. Fresh physical-device build PASS; strict signature PASS; bundle `com.berean.native.ios.dev`, development-only entitlements with no iCloud or App Group. Matching Mac and Simulator builds PASS; Mac strict signature PASS. Existing evidence remains in `owner-ready-artifacts.json`; new build logs are `/private/tmp/berean-iphone-1326-build.log` and `/private/tmp/berean-mac-1326-build.log`; Simulator log `/private/tmp/berean-simulator-1326-build.log`. Artifact hashes/identities: `owner-ready-1326-artifacts.json`.
- The owner authorized install and open on **Michael’s iPhone** at **1:26 p.m. Los Angeles time, Monday, November 23, 2026**, UDID `00008140-0018589E1EF2801C`. Preparation is underway. Physical installation and launch succeeded at 1:26 pm; the receipt below confirms the new process remained running.

## Next executable work

1. Scheduled phone action is complete; keep the receipt below. Publish documentation and recheck exact-head CI, then continue the required engineering queue.
2. Continue Mac search cold-open/title and reference interaction checks, and iPhone independent active-visit, same-chapter and aligned/stacked cold history. Keep physical pointer and wider platform parity cases open until exercised.
3. Check the exact published head and CI. Continue with the owner queue without changing the guarded review stack.

## Nov23 1:26 pm physical iPhone receipt
Owner expressly authorized this device action. Signed app source **7b694f3c**, owner checkout documentation **c5713215**; fresh Mac, physical iPhone and Simulator builds all PASS. Mac/device strict signatures PASS, correct native Dev identities and no iCloud or App Group entitlements. Installation began **13:26:07 PST**, succeeded, and `com.berean.native.ios.dev` launched successfully. At **13:27:07**, process73605 remained running from the newly installed bundle. This proves installation and continued startup, not physical-phone feature or UI verification. No phone library was read or modified manually; normal application startup only. Existing production app identity remained separate.
Evidence: ignored `owner-ready-1326-artifacts.json`, `phone-1326-install.json`, `phone-1326-launch.json`, `phone-1326-process-check.json`; build logs copied alongside. Mac command: `cd /Users/roywe/Berean-native && open build/apple/DerivedData/Build/Products/Debug/BereanMac.app` after quitting the old Dev app. Phone repeat command: `cd /Users/roywe/Berean-native && npm run native:ios:device` with the intended phone connected/unlocked.
