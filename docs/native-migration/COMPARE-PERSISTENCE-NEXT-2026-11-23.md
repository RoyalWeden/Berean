# Compare persistence — executable next packet (Nov23)

Broad goal ACTIVE. Start with HANDOFF/CURRENT-STATE and verify live source. Per-visit memory restoration is source `d349bf41`; this packet describes unfinished work, not implemented persistence.

## Requirements and current design evidence

- Preserve reading position after a cold restart for independent, aligned and stacked Compare. Retain distinct per-visit Back/Forward state and explicit-jump priority. Independent exact intra-row position remains open after the current verse-based fix.
- Native caches are `compareScrollOffsets` and `compareColumnScrollVerses` in AppModel; `TabHistoryLocation` now captures a passage-scoped CompareViewportSnapshot. CompareView has revision-scoped restoration and visibility gates. Review these before adding storage; do not undo current tests/guards.
- Current `CompareColumn.id` is an array index, not durable identity. Legacy nested `compareColumns.scrollPos` local merge pairs entries by index (`Packages/BereanKit/Sources/BereanWorkspace/Tabs.swift`, `src/platform/sync/tabFields.ts`). Writing native bookmarks there could attach an old position to another destination after a reorder. Leave legacy fallback readable.
- Candidate next design: top-level device-local `nativeComparePositions`, added to BOTH Swift and TypeScript local allowlists. Use stable column metadata plus validated destination, never an index alone. Preserve unknown column metadata through native mutations. Missing/duplicate/conflicting IDs after legacy edits must safely discard incompatible bookmarks, not recover an ID by index.
- Electron `src/components/bible/CompareView.tsx` reconstructs records when reporting changes and drops unknown fields. Audit this path before deciding whether stable metadata is shared or native-only. Do not casually modify synchronized identity contracts. Existing columns/tabs/notes must remain legacy readable.
- Persist semantic anchors: independent stable-column + text/book/chapter + raw verse (and validated fraction/geometry for exact position); aligned source-grid row scoped to matching configured column destinations; stacked stable preferred column and same-chapter raw verse. Pixel offsets require a validated reflow/layout fingerprint. Never copy raw verse numbers into a different mapped chapter.

## Integration and validation

Capture at independent binding/visibility, aligned/shared geometry, stacked phase callbacks, and lifecycle flush. Keep live caches cheap; batch/debounce durable writes with recordHistory:false and prevent preview/Presenter updates from writing. Scripture scene-phase flush currently excludes Compare. Inspect AppModel.saveNow before choosing one centralized drain.

History restoration must not rewind the complete latest durable map by replacing historical tab JSON. Preserve latest destination caches and apply the exact immutable visit independently. Priority: explicit jump, exact history visit (including deliberately empty), pending validated layout transfer, durable destination, selection/legacy fallback. Every deferred callback validates tab, destination, layout/revision and loaded rows.

Tests must cover local-only split/merge/sync payload identity, malformed bounds, missing/duplicate IDs, duplicate destinations, reorder/close, same ID changed chapter, per-visit empty/older/newer state, and keeping latest other destinations on Back. Use ReaderViewportTests, WorkspaceConformanceTests and TS tabFields tests as precedents. Runtime both apps: cold relaunch, deep independent/aligned, Mac stacked, two visits same destination, explicit jump, reorder and reflow. Current per-visit probe is in ignored Nov23 evidence; promote reusable core logic to package tests when storage design is implemented.

Global History's SQL Compare entries currently describe destinations and log before scrolling. Exact historical viewport after relaunch needs separate entry-ID update/payload semantics; do not silently change destination equality or claim it solved by in-tab memory snapshots.

## Other ready verification

iPhone final per-visit build must still be installed and exercised on owned D0CC. Existing owned iPhone active reader remains Matthew5selected12/9tabs; final context app PID23044, Strong’s off, study panel closed. There is an existing Psalm23 Compare tab in another workspace (`f70b7e6e-67b6-4c4c-90a8-45d0cfe103c5`); use UI to inspect it or create an explicitly owned disposable QA tab, then restore original ID set. No direct DB writes or other-device fallback.
