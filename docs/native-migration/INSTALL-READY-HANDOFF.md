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
