# Durable Compare bookmarks — Nov23

Broad migration goal ACTIVE. This is a bounded implementation and evidence record, not completion of all scrolling, history, Compare, or split-pane requirements.

## Source and storage contract

- `5f83fd65`: validated `CompareViewports` model and Swift/TypeScript local allowlists, regression cases and regenerated tab-golden source hash.
- `ccab93fc`: native capture/restoration, stable column materialization, ignored pending queue and debounce/lifecycle flush; preserves per-visit history priority from `d349bf41`.
- `e17c1762`: legacy Compare retains raw saved column metadata and persists reorders even for identical destinations.

`nativeComparePositions` is a device-local Bible-tab field. It stores at most24 semantic anchors with serialization-stable recency. Independent anchors use stable column UUID + edition/book/chapter; shared aligned anchors use the source grid row and full ordered configuration; stacked anchors include the stable preferred column and its raw verse. Invalid bounds, malformed IDs, mismatched sources/configurations and ambiguous duplicate IDs are rejected or repaired safely. Do not put native scroll data into legacy index-merged `compareColumns.scrollPos`.

`nativeColumnID` is configuration metadata inside each raw column record, so it travels with that column. It is synchronized with the configuration; scrolling does not change it. First activation of an older Compare assigns IDs once, retaining unknown fields. Duplicate IDs are replaced for EVERY ambiguous occurrence so neither inherits the old bookmark. The legacy component keeps saved metadata with its runtime column, including duplicate-destination reorder; it does not generate native IDs. No schema, bundle/signing identity, corpus or production store changes.

Capture requires the live active Compare, matching loaded layout/history revision and stable configuration. Early mount/restoration callbacks cannot replace a saved anchor with the top row. User-driven synchronized peer movement also saves its mapped semantic destination. AppModel keeps live captures outside observation, orders pending updates by event recency, folds them into local state through the existing save debounce and lifecycle flush, and includes pending state when capturing history. Cached records remain included in a flush after history has drained the pending queue. Current destination maps are authoritative when restoring historical JSON, so old history cannot resurrect evicted bookmarks.

Priority is explicit jump, exact in-tab visit (including an empty visit), validated layout transfer, durable destination, then ordinary selection/legacy fallbacks. Exact independent intra-row pixel offsets are NOT stored; restoring a verse can move its first line to the top. Global SQL History exact historical viewport after restart is separate unfinished work.

## Verification

Final native builds PASS: `mac-compare-durable-final-build.log`, `ios-compare-durable-final-build.log` under ignored `build/apple/qa-evidence/20261123`.

Full shared package PASS **373 conformance tests /94 suites +4Core tests =377** after regenerating the tab fixture: `full-package-compare-durable-final-tests.log`. Focused model5tests cover invalid/bounds, ambiguous IDs, duplicate destinations/reorders, source/config/layout mismatch, serialization recency/eviction and latest-map history merge.

Full legacy PASS **5802 tests /391 files**: `compare-durable-legacy-final-tests.log`. Targeted final suites11tests (7local-field tests +4metadata/order tests), full app/node typecheck and ESLint pass. The first full legacy run failed: golden tabs source hash was stale after changing the allowlist, a local download test could not bind127.0.0.1, and profile decoding failed under restricted execution. Regenerated ONLY tabs.json (diff is solely its source hash), reran environment-sensitive11tests successfully with authorized access, then reran the full suite successfully. Initial node typecheck lacked the ignored youtube-key module; created only the same empty stub as CI, with no real credential, and reran successfully. Keep failure logs as scope/evidence; do not call them app runtime regressions.

Focused model commands and logs: `compare-durable-model-checks.md`, `compare-durable-model-swift.log`, `compare-durable-model-ts.log`. The golden regeneration script is ignored `regenerate-tabs.ts`; it invokes the real TypeScript persistence oracle. Final checks cover the combined source; no legacy Electron visual test was performed for the metadata-only component change.

## Actual Mac UI

Only the owned named controls QA library was used, with the exact app under DerivedData-codex-20261121 and arguments `--qa-library --qa-profile codex-controls-20261119`.

1. Independent Exodus32 KJVA/LXX: user scroll gave fractions .7289461573861021/.3727058823529412, first visible semantic verses18/11. Read-only DB confirmed local anchors18/11 and stable UUIDs. Normal CmdQ and cold relaunch reopened KJVA18/LXX11 (.7202024850437183/.3687329079307202). Exact intra-row fractions differ by design, not a pixel restoration pass.
2. Sync enabled: shared scroll saved source-grid8. Cold relaunch reopened row8 in both columns (.3030973451327434 versus partial-row .3450292397660819 before quit).
3. Reorder identity: independent KJVA/LXX scrolled to distinct positions, Swap Columns placed LXX left/KJVA right. Cold relaunch retained LXX23 on the left and KJVA12 on the right, rather than swapping their bookmarks by index. Swapped back and scrolled both panes to0.
4. Returned original Genesis1selected1/Notes inspector and explicitly restored original scrollbar fraction .07135575942915393. The main reader's fraction drift after relaunch (.07675438596491228 in one return, .0712719298245614 in another) was corrected only as QA restoration; **no new main-reader restoration fix is claimed**.

Owned running launch handle19013/log `mac-compare-swap-relaunch.log` is a lookup hint, not proof of a live process. Other checkout's app was untouched.

## Actual iPhone UI

Only owned D0CC iPhone18Pro/iOS27 was installed/launched. Final app cold PID26816 is advisory; physical phone and Claude E8B untouched.

Tabs→workspaces search“Psalm23” found the existing Workspace4 Compare without new tabs. KJVA23/LXX22 stays side by side. Raise DeviceHub before real touch drags; earlier unchanged drags were automation focus issues, not a demonstrated app scroll failure. A touch scroll saved shared row3 in device-local storage; terminate/relaunch reopened that reading view. Then Next→Psalm24 and scroll near6; Previous→Psalm23 and scroll to1; More→Back reopened24near6, Back reopened older23near3, Forward twice reopened the newer23at1. This verifies distinct visits with durable latest bookmarks present.

Returned original Study workspace, Matthew5selected12, Strong’s off, panel closed,9tabs. Workspace4 intentionally retains its existing Psalm23 comparison at start with generated stable IDs/local bookmarks. No notes or other content edited, no new tabs.

## Data check and remaining work

`compare-durable-final-data-check.json` confirms every watched original notes/settings/messages/tags/trail/PDF row hash unchanged on both QA libraries, and exact active tab ID sets preserved (37Mac/47iPhone). Test navigation visits, Compare metadata/bookmarks and QA workspace presentation are expected changes, not “all DB bytes unchanged.”

OPEN: exact independent intra-row anchors; Mac stacked cold restore; iPhone independent cold restore; synced independent peers runtime; duplicate same-destination drag/reorder UI; explicit jump/resize/rapid/reflow/accessibility matrices; local-key compatibility with older releases that lack the new allowlist; exact global History viewport after restart. Package/model tests and generic layout wiring do not close those UI matrices. Continue other migration work from TASKS as well.
