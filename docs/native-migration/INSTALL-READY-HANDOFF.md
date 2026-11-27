# Native install-ready handoff

Before every usage handoff, prepare the final development build in `/Users/roywe/Berean-native` so the owner can use it from Terminal. Start this preparation early enough to finish verification before handing over.

## Stage the final source

1. Record the candidate commit and confirm it contains the intended changes. Check the owner checkout’s branch, head, tracked and untracked work, and any active build or AI work there. Preserve local signing files and owner edits.
2. If the owner checkout is clean and its current head is an ancestor of the verified candidate, bring it forward with a fast-forward-only update. Verify the fetched commit and recheck the worktree immediately before updating it. If it is dirty or diverged, reconcile with the other worker or record the blocker. Keep the owner-only GitHub review and merge guard.
3. Confirm the owner worktree now has the intended source. Run verification from this worktree so the owner’s commands use its verified build path. When another build changes the staged source, repeat the affected checks.

## Verify each platform

- **Mac:** Run `npm run native:build:mac`. Confirm success and the generated app’s `com.berean.native.mac.dev` identity at `build/apple/DerivedData/Build/Products/Debug/BereanMac.app`. Use an isolated QA profile if launch verification is needed.
- **iPhone:** Run `npm run native:build:ios` for simulator build verification. For physical iPhone readiness, verify a fresh device build from the same source with the existing local development signing, bundle ID `com.berean.native.ios.dev`, a valid device signature, and no iCloud or App Group entitlements. A successful simulator build establishes simulator readiness only. Leave installation and launch on the owner’s physical iPhone to the owner unless they expressly authorize those actions.
- Check that each relevant build actually succeeded and produced the expected app for this source. In particular, an existing `Debug-iphoneos/BereanIOS.app` can outlive a failed build. Verify the device build’s real exit status and use a fresh output location for verification if necessary. Report any missing signing, provisioning, device, or build evidence for the affected platform. Preserve signing, production data, sync and bundle identities.
- Record the verified owner checkout SHA, build outcomes, app paths, Dev IDs, and verification scope in the [current state](CURRENT-STATE.md) and [handoff](HANDOFF.md). Report any blocker plainly and give the working command for each verified platform.

## Owner Terminal commands

**Mac** — quit the running Berean Native Dev first so the new executable opens.

```sh
cd /Users/roywe/Berean-native && open "$PWD/build/apple/DerivedData/Build/Products/Debug/BereanMac.app"
```

**iPhone** — connect, unlock and trust the intended iPhone before running the command.

```sh
cd /Users/roywe/Berean-native && npm run native:ios:device
```

If multiple iPhones are connected, append `-- <device-id>` using the verified device ID. The helper builds, installs and launches Berean Native Dev. Prepare the owner checkout and verify device readiness before presenting this as ready to run.

## Verified Nov23 handoff receipt
Owner checkout safely advanced from clean50732392 to appsourceecec1418 and documentationd8c3959b; later documentation-only receipt does not alter app source. Fresh Mac, physical-iPhone and Simulator builds PASS; strict Mac/device signatures and DevIDs/noiCloudOrAppGroup PASS. Full native suite378tests/95suites PASS. Artifacts are in the paths above. No physical installation/launch or provisioning update. Both current checkpoints record logs and remaining work; exact-head CI was still pending at publication. Reverify live folder/workers before future updates.

## Nov23 1:26 pm physical iPhone receipt
Owner expressly authorized this device action. Signed app source **7b694f3c**, owner checkout documentation **c5713215**; fresh Mac, physical iPhone and Simulator builds all PASS. Mac/device strict signatures PASS, correct native Dev identities and no iCloud or App Group entitlements. Installation began **13:26:07 PST**, succeeded, and `com.berean.native.ios.dev` launched successfully. At **13:27:07**, process73605 remained running from the newly installed bundle. This proves installation and continued startup, not physical-phone feature or UI verification. No phone library was read or modified manually; normal application startup only. Existing production app identity remained separate.
Evidence: ignored `owner-ready-1326-artifacts.json`, `phone-1326-install.json`, `phone-1326-launch.json`, `phone-1326-process-check.json`; build logs copied alongside. Mac command: `cd /Users/roywe/Berean-native && open build/apple/DerivedData/Build/Products/Debug/BereanMac.app` after quitting the old Dev app. Phone repeat command: `cd /Users/roywe/Berean-native && npm run native:ios:device` with the intended phone connected/unlocked.

## Nov23 reference-interaction build receipt
Fresh owner-folder Mac, signed physical-iPhone and Simulator builds from **12d2e360** all PASS. Strict Mac/device signatures PASS; Dev identities and absence of iCloud/App Group entitlements verified. Artifacts remain under `build/apple/DerivedData/Build/Products`, ready for the owner’s usual commands. Evidence: `owner-reference-ready-artifacts.json` and `owner-reference-{mac,iphone,simulator}-ready.log` under ignored Nov23 QA evidence. The physical phone remains on the separately authorized 1:26 installation of7b694f3c; no second install or launch was performed. Later documentation-only commits do not change these binaries.

## Nov23 Search and picker build receipt
Fresh owner-folder Mac, signed physical-iPhone and Simulator builds from **c5074a08** all PASS. Strict Mac/device signatures PASS; Dev identities and absence of iCloud/App Group entitlements verified. Artifacts remain under `build/apple/DerivedData/Build/Products`, ready for the owner’s usual commands. Evidence: `owner-search-ready-artifacts.json` and `owner-search-{mac,iphone,simulator}-ready.log` in ignored Nov23 QA evidence. Independent source review and 16 Search/Compare focused tests PASS (`owner-search-source-review-tests.log`). The running owner Mac app was left untouched. No additional physical install, launch or provisioning update. Later documentation-only commits do not change these binaries.

## Nov24 floating Find and Search book-filter receipt
Fresh owner-folder Mac, signed physical-iPhone and Simulator builds from **b496e3bf** all PASS. Strict Mac/device signatures PASS; all three Dev platform identities and absence of iCloud/App Group entitlements verified. The two new Find drawing isolation warnings are absent; older TextKit drawGlyphs warnings remain. Receipt `owner-find-ready-artifacts.json` and `owner-find-{mac,iphone,simulator}-ready.log` are under ignored Nov23 QA evidence; earlier0fe logs are retained separately. No additional physical installation, launch, provisioning or signing change. Later documentation-only commits do not alter these binaries.

## November26 rich indicator and reader receipt
Fresh owner-folder Mac, signed iPhone and Simulator builds from a5956515 PASS. Strict Mac/device signatures and native Dev identities/no cloud/group entitlements PASS. Sandboxed iPhone signature trust check required a repeat using system signing services; that check succeeded exit0. No install/launch/provisioning change. Ignored Nov26 receipt owner-indicators-ready-artifacts.json; build logs /private/tmp/berean-owner-indicators-{mac,device,ios}-20261126.log. Compare WIP is not part of these owner builds.

## November26 desktop picker and Compare receipt
Owner checkout safely fast-forwarded clean034e975f→appsource2bb1670d. Fresh Mac, signed physical-iPhone and Simulator builds PASS. Strict signatures for all3, correct native Dev identities and no iCloud/App Group entitlements PASS. Ignored Nov26 owner-compare-picker-ready-artifacts.json; logs /private/tmp/berean-owner-compare-picker-{mac,device,ios}-20261126.log. No install, physical launch, provisioning or identity change. Running owner Mac2506 left untouched; isolatedQAclosed. Later documentation-only commits do not change these binaries.

## November26 pre8pm final build and compatibility checkpoint

App sourcec3676b9b. Hosted Xcode26.6 NotesHome type-check timeout at3fd644d8 fixed with opaque browserContents/browserScaffold boundaries, retaining behavior/state/modals. All three owner-folder Xcode27 builds PASS; c367 Simulator Notes17/Trash10/confirmation Cancel/Back checked without deletion. Preserve these boundaries in CC07.

Final Mac/device refresh exited0 each at7:46pm. Strict signature verification then caught regenerated AppIntents extract.actionsdata/nlu.lzfse with a stale incremental device signature despite BUILD SUCCEEDED. Removed only the generated bundle’s _CodeSignature/CodeResources output and rebuilt through normal Xcode CodeSign (exit0); all three strict signatures/DevIDs/no cloud-or-group entitlements now PASS, Signing.xcconfig unchanged. Do not assume BUILD SUCCEEDED alone proves valid signed resources. Logs /private/tmp/berean-owner-pre8-refresh-{mac,device}-20261126.log and berean-owner-pre8-device-resign-20261126.log; ignored owner-pre8-ready-artifacts.json.

Read-only final QA audit after c367 smoke retained all watched original row hashes and exact37Mac/47iPhone active tab IDs; no new note content. D0CC current containerC42052F5-E274-4DA1-A006-1F2BFCDD9EB4, backgroundedMatthew5:12/nine tabs/StrongOFF/panelclosed/Findclosed. Original owner Mac2506 untouched. Exact-head hosted run45935344052 remains in progress at7:47; previous45933415044 failed iOS compilation, not a green receipt. Physical iPhone unavailable at7:47, so no installation yet; final outcome follows in current checkpoints.

- **Final pre8pm receipt, November26 7:49pm PST:** app sourcec3676b9b, documentation-only handoff commit follows. Physical install attempted against paired8956ACCF-F043-58CB-9763-8C3F9E608ACC; devicectl exited1 with CoreDeviceError4016 (required trusted connectivity/services unavailable). No phone install or launch succeeded; signed device artifact remains ready. /private/tmp/berean-pre8-phone-install-20261126.{json,log}. Hosted run45935344052/c3676b9b legacy checks SUCCESS, native IN_PROGRESS. Do not infer native green from this. All local build/signature checks PASS after generated signature repair; no live local build sessions or active editing subagents remain. Codex is stopping for Claude’s8pm work; verify live state on resume.

## November27 verified owner artifacts
Clean owner checkout520c7a43 at build time. All3 e589fbe0 builds PASS; final520c7a43 Mac-only rebuild PASS. Diff e589→520 contains only2Mac files, so signed-device/Simulator inputs and binary hashes are unchanged. Strict signatures, Dev IDs and no iCloud/AppGroup entitlements PASS; Signing.xcconfig hash unchanged. Receipt root ignored build/apple/qa-evidence/20261127/owner-ready-artifacts.json; /private/tmp/berean-owner-20261127-glass-builds.json and corner-build.json reference build logs. Full package402/97 PASS; scoped new Mac/iPhone runtime tests passed. Root clone redundant Simulator build was cancelled exit75 after diagnosed CAS pread wait; not a pass, not used for owner artifacts. No physical install this round. Quit old owner Dev Mac before normal open command. Phone helper remains available with intended phone connected/unlocked. Later documentation-only commits do not change binaries.

### November27 later owner build receipt

Mac, signed iPhone device and iPhone Simulator builds for **62aacc83** each exited0. See /private/tmp/berean-owner-20261127-note-final-builds.json for the full source SHA and logs. The isolated Mac quick-draft Pin and Trash checks passed at this source. The last installed iPhone Simulator remains **e589fbe0**, and the physical phone was not installed. The subsequent Search snippet cache is pending its final source/build/signature receipt.

### November27 final source receipt

All three owner builds for **a6ea72ac** exited0. The rebuilt Dev artifacts and signing configuration are recorded in /private/tmp/berean-owner-20261127-cache-final-builds.json and the regenerated ignored owner-ready-artifacts.json. Strict Mac/device signatures and Dev IDs passed with no iCloud or AppGroup entitlements and unchanged Signing.xcconfig. Installed Simulator remains **e589fbe0**. No physical installation occurred. The exact-source Release package check is still running in session45957.


### November27 final Presenter idle fix
Appsource6a54ccef: owner committed Mac rebuild67121PASS, /private/tmp/berean-presenter-final-owner-mac-20261127.log. Strict Mac/device signature verification, Devidentities/no-cloud-group entitlementsPASS; unchangedphone/Simulatora6binaryhashesretained. OnlyMacApp.swift changed. Regenerated ignoredNov27owner-ready-artifacts.json records bothsources. All406package tests/98suites remainvalid (no package changes). Physicalphone notinstalled. Presenter-idle A/B and zoommenu/keyboarddecrease-reset/reopen/PauseResume passed.


November27 final Presenter verification:6a54ccef stops focused zoom payload layout churn; idle isolated CPU~100%→~4%, title-free bottom-right controls, menu zoom/keyboard decrease-reset afterreopen and Pause/Resume pass. Mac final ownerbuildPASS; unchangedmobilea6device/SimulatorbuildsPASS; strictsignaturesall3PASS. Hosted642c2992 native+legacySUCCESS; laterMac6a/finaldocsrequire new exact-head checks. Search smoothness staysOPEN. Canonical current source/evidence/nexttasks are in HANDOFF and CURRENT-STATE.
