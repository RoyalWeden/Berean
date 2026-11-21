# Current native migration checkpoint

Snapshot: **2026-11-21**, Codex; owner explicitly resumed after the latest restart pause. Broad goal **ACTIVE**. No new handover deadline. Start with [HANDOFF](HANDOFF.md), [owner principles](OWNER-PRINCIPLES.md), and [continuity contract](AI-CONTINUITY.md).

## Source and publication

- Checkout `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`. Source through **6a50adc6**: a4fcc429 Presenter,16067d57 images,da8aecce print/theme,81938ff0 Messages,1e9eeed7+6a50adc6 Presenter settled reopening/observation/zoom accessibility. All local, not yet pushed. Verified live draft PR24 remains open, base `native/m6-navigation`, remote head85d0f9a4.
- Implementation committed; only Codex current/parity/decision/changelog docs and two new focused/checkpoint documents remain dirty pending publication. Preserve all.
- Presenter actual Mac font/number/follow/pause/appearance checks and image rendering are recorded in [focused evidence](PRESENTER-REFINEMENT-2026-11-21.md). Shared tests **346 pass**; both apps build. Final controls Mac+iOS publish builds and final Mac Presenter build pass. Actual Mac/iPhone fraction entry, theme names, Mac reply/search and iPhone plain conversation layout pass. **OPEN:** restored Presenter at cold startup can still show chapter start before reader settles; later reopening is correct. Do not claim cold-start fixed.
- Push only verified GitHub remote `github`; never owner-local `origin`. Owner-only merge stack22→23 after retarget/green→draft24. No merge/ready/retarget/force. No production/sync/schema/identity changes.

## Durable checks and safe runtime

- Ignored evidence/logs/baselines: `build/apple/qa-evidence/20261121`. Cache: `build/apple/DerivedData-codex-20261121`; Swift scratch: `build/apple/swiftpm-codex-20261121`. Restart removed old `/private/tmp` logs, caches, patch and baselines; use durable evidence, never claim missing temporary results passed.
- Mac QA app: `build/apple/DerivedData-codex-20261121/Build/Products/Debug/BereanMac.app`, executable arguments `--qa-library --qa-profile codex-controls-20261119`. Current launch session87528, log`mac-presenter-source-seed-runtime.log`. Verify PID/arguments before lifecycle; separate owner appPID728 at `/Users/roywe/Berean-native/...` untouched.
- iPhone only **D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D**, Dev identity`com.berean.native.ios.dev`. Requery container after every install; its QA database suffix is `Library/Application Support/BereanNative/berean.db` (not Mac’s profile directory). Leave ClaudeE8B01B22 and physical devices untouched. Device Hub compact device window exposes native iPhone accessibility controls; double-click the Codex device row to open it.
- QA baseline22Mac notes/26iPhone notes, exact37/47global active tab IDs. Compare original row hashes individually as sets, not row indices (INSERT OR REPLACE changes row order). No original note/tab modifications. Owned new Mac image Chat`ab44752e-5113-4c1b-869a-8b7a60d9c706` has one synthetic message; do not hard-delete. Existing fixtures remain. New owned settings on both profiles: print Normal/custom four1inch values; Mac Default theme key. Effective defaults restored, not byte-identical new key sets.
- Main Mac Genesis1KJVA/selected1/Notes inspector; narrower post-reboot layout sidebar239.5/rightdivider660/readerfraction0.2150401351922265. Presenter/Chat closed. Settings/Presenter/Chat closed;160% Presenter preference retained. iPhone lastPsalm3LXX/no selection/no sheets/CaptureKeyboardOFF. Reobserve all UI.
- Older named stash`codex-preserved-presenter-before-claude-20261121` survives. Its superseded Presenter zoom candidate must not be blindly popped; old temp patch is gone.

## Immediate next

1. Publish committed source/docs normally to existing draft24; record exact pushed head and CI. Final logs:mac-controls-publish-build.log/ios-controls-publish-build.log and mac-presenter-source-seed-build.log. Full346shared tests pass (shared source unchanged since test). Verify any later fixes separately.
2. Investigate cold-start Presenter restoration: initial audience0.0067 despite saved readeroffset509/verse7/selected1; after close+settled reopen audience0.177/verse7. Merely seeding source changes did not solve startup. Trace initial reader restore, ignored cache, selection mirror reseed and load timing; no guessed delays. Preserve passed live/reopen/pause behavior.
3. Compare secondary-column Presenter is OPEN: implement atomic transient projection scoped to active tab/config, actual mapped edition/chapter, selection+anchor; follow detailed focused audit and full source context. Full multi-column mirroring is separate parity.
4. Continue iPhone image/reply/keyboard-accessibility, print output/unknown-field runtime, imported theme dark accent parity, same-chapter explicit-jump regression and broader owner queue. No Apple voices, quota resets, production/sync changes or merges.

Final read-only data check`resumed-data-check.json`: all original row hashes present, exact37/47activeIDs unchanged, Normal/customfour1in values restored. Evidence folder is ignored; do not commit databases/fixtures. HANDOFF is the single entry point; latest detailed findings remain in PRESENTER-REFINEMENT-2026-11-21.md.
