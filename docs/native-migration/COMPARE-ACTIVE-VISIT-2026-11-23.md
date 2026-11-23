# Compare active history visit persistence

Independent Compare preserves the visit selected by Back or Forward across a cold restart. The selected visit can be older than the latest bookmark for the same destination. This extends [independent Compare precision](COMPARE-PRECISION-2026-11-23.md).

## Source and storage

- The existing device-local `nativeComparePositions` object holds one reserved `$activeVisit` record in addition to its 24 destination entries. The active record matches the source, ordered stable column IDs and effective destinations, pin state, and Sync setting. It admits an intentionally empty visit. Neither sync payloads nor the database schema changed.
- An immutable history snapshot records the observed independent layout. Selecting it stages the active record before pane placement, so the next lifecycle save can preserve the chosen visit even if the panes have yet to settle. The latest destination map retains its own values and evictions. A genuine pane movement updates that pane's active anchor while retaining the peer. Incompatible configuration changes invalidate the active record.
- Explicit chapter-and-verse requests synchronously stage semantic targets for the following independent columns, using the same versification mapping as the live jump. Pinned and unaffected panes retain their applicable anchors. Ordinary selection does not stage a jump.

## Mac runtime and automated checks

The Mac QA configuration used LXX left and KJV right. Exodus 32 visit A held LXX row 5 at crop −1 and KJV row 7 at crop 34. After a visit to Exodus 33, the newer Exodus 32 visit B held row 12 at crop 34 and row 15 at crop 18. Back twice staged the active A record while preserving both latest B destination records. On cold replay, both fingerprints and row heights matched. The right pane restored crop 34 exactly and the left restored crop 0 within one display pixel. The scrollbar fractions differed because SwiftUI's lazy content extent changed. The row geometry supersedes the initial fraction-based diagnosis.

The one-pane case then moved only the right pane to KJV row 8 at crop −12. The untouched left pane retained active LXX row 5 at crop −1 and the separate latest LXX destination remained row 12 at crop 34. The initial one-pane cold replay exposed a placement failure. The ID placement superseded the coordinate request, and the unchanged measurement left that request pending. The pane now permits a bounded retry after another matching layout sample while the request remains current.

The final Mac cold replay restored right row 8 at crop −12.5 with native offset 506 after the second correction. The left pane restored row 5 at crop 0. Both were within one display pixel of their saved crops, and the screenshot matched. Temporary diagnostic logging was removed after verification. Swift parsing and diff checks passed after cleanup.

- The instrumented Mac build and the full 381-test package suite passed before the geometry-only retry refinement. Eleven focused Compare tests passed on retry. The first focused attempt was interrupted by source materialization while compiling `NoteAttachmentLabelTests.swift`. The retry used the native engine after the source and test folders were kept downloaded.
- The retry refinement passed the isolated macOS SDK typecheck. Evidence is under `build/apple/qa-evidence/20261123`, including `compare-active-visit-focused-tests.log`, `compare-active-visit-focused-tests-materialization-failure.log`, the `mac-active-visit-*.json` snapshots, `mac-active-visit-trace-runtime.log`, `mac-active-visit-one-pane-cold.log`, `mac-active-visit-retry-runtime.log`, and `compare-negative-crop-sdk-probe.log`.

## Remaining work

Verify the independent older-visit and one-pane cases on iPhone, and exercise an empty older visit, explicit same-chapter Go followed by immediate quit, and ordinary selection without a viewport reset. Keep the established Dev fixtures and restore their original reader state after testing.

Aligned and stacked cold-after-Back remain required engineering. Their active visit snapshots need the actual layout mode and matching source/configuration, plus the aligned source-grid row or stacked preferred stable column and raw row. Any shared pixel position needs compatible measured geometry and a semantic fallback after reflow. The existing in-memory absolute offsets alone are insufficient for cold restore.
