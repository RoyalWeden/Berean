# Native Compare drag checkpoint — 2026-11-19

Source6c351503. Applies to the Mac Compare host; iPhone Compare selection remains as documented in the previous checkpoint.

The drag controller captures the actual visible union of registered column regions at window backing scale. It composites a native window background for opaque readable text, starts NSDraggingSession directly from mouseDragged, offsets the image by the original translation and retains the pickup location. It dims the source after capture. Drop operations are local moves within the same live controller, with current active-tab/Compare/history identity checks. Escape restores the source. Closed hand is limited to this native session; no cursor warp, global monitor or separate grip.

Observed: independent Exodus32 KJVA/LXX reorder and return; operation16(move). Escape operation0 leaves order unchanged. Header click opens passage chooser and Cancel returns. Verse3 selects with normal actions and Clear restores. Captured functional image is opaque and uses actual rendered typography/width; the checked display had scale1. Trace horizontal pickup100pt is preserved. Native moving drag image itself is OS-owned and not continuously captured.

Known initial failures corrected: SwiftUI action arrived on mouse-up, so custom recognizer now begins synchronously in mouseDragged; first bitmap was transparent/low-resolution, so snapshot uses native render host/backing resolution and background composition; initial drop advertised copy, now local move. Single clicks remain undelayed and double clicks fail the lift recognizer. These design choices still need the following complete regression matrix.

Remaining:

- Pinned columns, aligned and stacked layouts,3/4columns, duplicate passages and narrow windows.
- Strong’s/link clicks, native word/range selection, selected/highlighted rows in the snapshot and scrolling during/after cancellation.
- Multiple pickup points, Retina2x/light appearance, full image/pointer physical feel.
- Cross-tab/passages/workspace changes during pending drop, repeated cancel/drop, history/restart/scroll identity preservation.
- Performance on long or heavily annotated chapters and source disappearance during a session.

Opt-in diagnostic artifacts require DEBUG plus --qa-library --qa-drag-trace. Generated compare-column-drag.png/jsonl stay in UserLibrary.directory for the named QA profile. No production database or preference/schema changes. CUA drag can remain active until destination click; always observe a completed move or Escape cancellation. Current safe fixture and exact logs are in HANDOFF. Do not call this the generic all-tab split system; that remains TAB-SPLIT-DESIGN.md work.

## Follow-through — bbca520f

The once-only aligned-drag bug is fixed by resolving the source at the original pickup against actual live fragments, rather than whichever representable recognizer fires first. Native session completion explicitly finishes that recognizer. In interleaved stacked mode, fragment masking excludes other editions from the source image; stacked header/block registrations preserve edition labels and avoid double source dimming.

Actual: four consecutive aligned moves; three pinned moves; invalid drop retained order and two subsequent moves worked; G2532 rendered link opened Lexicon; temporary third duplicate KJVA column forced stacked aligned mode, moved LXX both ways, then was closed individually. Final builds both pass. Source image artifact inspected: only LXX title/labels/passages remain, with blank gaps where KJVA was. Blue verse controls are not clearly captured, so pixel fidelity remains OPEN. No2x/light/selected/4column/full text-selection/physical feel/race completion claim. All original16notes/37tabIDs/tags unchanged. Full trace coordinates, completion-click pitfall and cleanup in HANDOFF.
