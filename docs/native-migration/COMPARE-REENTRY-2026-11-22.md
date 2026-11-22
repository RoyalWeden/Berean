# Saved Compare followers — 2026-11-22

## Problem and compatibility decision

CompareColumn.followPassageChange required both old and new Compare mode. Ordinary reader navigation while Compare was closed therefore stranded saved following columns at their previous chapter; reopening Compare showed them below a different main passage title.

Source **ef9beb91** removes only that mode guard. Existing AppModel.update normalization applies only to an actual book/chapter/edition change, when the previous and new compareColumns arrays are equal and history recording is enabled. Explicit array edits/removal and history snapshots retain their own semantics. Existing following columns use ChapterMap against the pre-navigation anchor; pins remain byte-identical; legacy mismatches are marked pinned, retaining their independent destination. Raw edition casing, order, extra metadata and compareSyncScroll remain. Only moved-column obsolete scrollPos is removed. Both platforms share this code.

Already-stranded records have no previous anchor or positive follow flag, so cannot be safely guessed back into alignment. Mode-only reentry preserves them. The existing Follow Main Passage action is the explicit recovery. Do not clear saved arrays or infer intent merely because two columns match each other.

## Verification

Final local Mac and iOS Simulator development builds PASS: `build/apple/qa-evidence/20261121/{mac,ios}-compare-dormant-follow-build.log`. No schema, sync, signing, bundle ID, corpus or production data changes.

A focused isolated probe compiles actual extracted CompareColumn/BibleState/AppModel unchanged-array normalization with real BereanCore and ChapterMap. Original d86f69b5 fails `Off→off moves follower to new book`; patched source passes. Re-run from repo root: `bash build/apple/qa-evidence/20261121/compare-reentry-probe.sh`. Probe, source and before/after logs are ignored local evidence, not a new permanent test harness. Cases: off→off→off/on, mixed explicit pins and legacy independence despite coincident destination, raw metadata/order/casing, stale vs stationary bookmarks, Psalm edition mapping, explicit replacement/removal, mode-only no-op, nil/empty/defaults, unavailable editions. AEL1 corpus checks confirm no KJVA/LXX rows; preserve unavailable column choices rather than silently replacing them.

Actual Mac UI: existing EXO32KJVA/LXX Compare → Compare off → Cmd-L Exodus33 → Compare on shows both EXO33. Back three times restores reader33, reader32, Compare32 respectively. Forward three reproduces Compare33; Back three restores Compare32. This checks location/configuration history, not a new exact viewport claim. No new tabs or notes. Returned original main GEN1selected1/Notes/offset0, observed in UI.

Actual iPhone UI: original stale three-column fixture preserved on initial entry (KJVA119/LXX118/LXX118thirdpinned below PSA3LXX). Explicit Follow Main Passage for first column makes KJVA3. Exit Compare, next chapter to PSA4LXX, reopen: first follows KJVA4, both independent LXX118 stay. Five Back actions restore reader4, reader3, Compare with KJVA3, original Compare KJVA119, then original readerPSA3. Nine tabs, no selection/Compare/sheet, Strong’s off. Physical phone, relaunch after dormant multi-step changes, broader pinned/unavailable GUI matrix and accessibility remain open.

## Continuity

Preserve existing owner-only review/merge sequence and publish only to github. Broad migration ACTIVE. Continue durable Compare/per-visit viewport, synced navigation and broader parity. Never treat the bounded follow fix as an automatic repair of old ambiguous records or completion of history/scrolling.

Final `compare-dormant-follow-final-data-check.json` passes all original rows, exact37Mac/47iPhone active IDs and22/26notes. No new notes/tabs; other checkout/owner process728 untouched.
