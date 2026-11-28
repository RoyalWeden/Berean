# Notes hover previews and Compare native references — November 23, 2026

Committed source is **09e34b1d** for Mac Compare links, first-baseline alignment and column lift, and **12d2e360** for Notes Strong’s hover. Temporary hover logging was removed. The existing opt-in drag trace remains available.

## Notes Strong’s preview

RichNoteEditor tracks styled link glyphs, waits 350 ms and resolves Strong’s through the existing Lexicon actor. A native system-font popover shows a compact summary without editing the note or navigating. Bare references follow detection settings. Reference, note, style or content changes, mouse-down, typing, scrolling, key-window or activation changes and view teardown cancel pending work. A generation check rejects stale results, and popover closure rearms the same reference.

The first Mac build failed Swift 6 notification isolation. The fix scoped callbacks without sending Notification across actors. The retry, later Mac integration builds and the iPhone Simulator build passed. The actual helper and parser passed offscreen glyph checks for H/G, wrapped lines, mixed Greek/Hebrew/Latin, prose, external/task links and blank regions. The real isolated AppKit lifecycle passed under normal LaunchServices activation. It verified delay, retained keyboard focus, scroll cancellation, another window becoming key, outside closure/rearm and stale-result suppression.

Initial sandboxed activation failed before assertions. Direct CLI activation was intermittent, and the final direct attempt failed before the popover assertions. Preserve `lifecycle-final.log` and the passing `lifecycle-launchservices.log`. Reproduce the passing path with `BEREAN_HOVER_LIFECYCLE=1 BEREAN_HOVER_LAUNCHSERVICES=1 zsh build/apple/qa-evidence/20261123/note-reference-hover-probe/check.zsh`. The harness calls the production `moved(to:)` directly. CUA lacks pointer dwell, and scroll/drag positioning did not establish a visible live Notes preview. Physical pointer dwell and flicker remain open.

## Compare references, alignment and lift

Mac linked verse rows use the native link/text cursor bridge. In the independent LXX Exodus 32 fixture, a coordinate click on G2 opened Aaron in the Lexicon inspector. A coordinate click on verse 5 showed its selection/action bar. Double-click over Aaron selected the G2-linked word. Ordinary prose selection and the parent verse context menu passed. No content action was executed.

An early screenshot showed lost first-baseline information through the representable. An offscreen SwiftUI Layout probe ruled out a plain NSView baseline override. The public layout wrapper forwards an equivalent hidden SwiftUI Text baseline without placing or exposing a duplicate view. The probe matched the 15-point SwiftUI reference and the Strong’s-on screenshot confirmed number/body alignment.

Earlier dragging from linked text selected prose instead of lifting. The final native drag started on that body, produced a whole-column snapshot with 600-point pickup translation and reordered the independent columns. The automation drag call left the native session active, and the next pointer click completed it. The trace ended with move operation 16. KJVA-left/LXX-right was verified, then Move Earlier restored LXX-left/KJVA-right. Narrow and non-independent layouts, mixed-script interaction and physical pointer behavior remain open.

## Data and build status

Only the owned Notes cursor fixture `fbfefd6b-3ad6-46c2-87df-c382142f4b9c` was restored and returned to recoverable Trash. Its content was untouched. The final read-only comparison found all original watched rows and 37 Mac active tab IDs intact. Two owned Mac fixtures and one owned iPhone fixture remain recoverable. The cursor fixture accounts for the additional note against the newer baseline because the other fixture was already included. See `notes-hover-compare-final-data-check.json`.

Restored Thursday Nov 19 Notes, Search “voice of joy,” seven Study tabs, original Compare column order, Strong’s off and the inspector closed. No iPhone or production library was changed in this continuation. The owner checkout is staged at **12d2e360** with Mac build 33998 running at this checkpoint. Device and Simulator builds follow. The physical phone remains on the separately authorized **7b694f3c** installation from 1:26 p.m. See [CURRENT-STATE](CURRENT-STATE.md) for the installation and build receipts.

Continue iPhone active-history cold replay, search cold result anchor/title and ordinary reader return. See [Compare active visit](COMPARE-ACTIVE-VISIT-2026-11-23.md) and [reader return diagnosis](READER-RETURN-DIAGNOSIS-2026-11-23.md).

## Final owner build receipt
Fresh owner-folder Mac, signed physical-iPhone and Simulator builds from **12d2e360** all PASS. Strict Mac/device signatures PASS; Dev identities and absence of iCloud/App Group entitlements verified. Artifacts remain under `build/apple/DerivedData/Build/Products`, ready for the owner’s usual commands. Evidence: `owner-reference-ready-artifacts.json` and `owner-reference-{mac,iphone,simulator}-ready.log` under ignored Nov23 QA evidence. The physical phone remains on the separately authorized 1:26 installation of7b694f3c; no second install or launch was performed. Later documentation-only commits do not change these binaries.
