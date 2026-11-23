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

**Mac**

```sh
cd /Users/roywe/Berean-native && open -n "$PWD/build/apple/DerivedData/Build/Products/Debug/BereanMac.app"
```

**iPhone** — connect, unlock and trust the intended iPhone before running the command.

```sh
cd /Users/roywe/Berean-native && npm run native:ios:device
```

If multiple iPhones are connected, append `-- <device-id>` using the verified device ID. The helper builds, installs and launches Berean Native Dev. Prepare the owner checkout and verify device readiness before presenting this as ready to run.
