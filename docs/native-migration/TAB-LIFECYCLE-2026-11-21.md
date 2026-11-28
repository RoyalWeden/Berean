# Tab lifecycle and inspector continuity — 2026-11-21

Previous goal turn was progress: implemented/published history, diagnostics, clear iPhone surfaces and Compare audience source with scoped actual checks. Broad goal remains active; no blocker condition is met. This follow-up starts at clean 7263836f, app source 8ae5e4a6. Latest exact-head CI 44939514152 is queued; old 44938572988 still running at observation. Prior-head green does not prove this source.

## Geometry evidence and correction to interpretation

Previous test used AX setValue on a native splitter while trying to restore an older layout. That changed QA window geometry; do not replay it. New controlled UI cycle with no divider writes: Genesis sidebar 239, study divider 1480, fraction 0.4402764067127344 → existing Exodus 32 full-width Compare divider 1999 → Genesis divider 1480 with exact same fraction. Screenshot confirms current 2000-point-wide window, 520-point inspector. No cumulative growth during that cycle. This narrows the earlier report; it does not prove all transitions or first-frame behavior. Wider tab/reflow matrix stays open. Owner app and production library untouched.

Source InspectorWidthReader performs one bounded native divider write per presentation; it does not directly resize the window. AppKit clamping may still overwrite preferred width after a quiet period, and attachment geometry needs further coordinate-drag coverage. Do not change the width algorithm based only on an AX splitter value.

## Concrete same-ID callback risk and pending implementation

Old inspector binding captured the rendered Bible tab, checked only active ID, and merged a reconstructed BibleState during delayed native dismissal. Cmd+L Change Current Tab deliberately reuses that ID for Lexicon/Search/Note, so a stale callback could add Bible state to the replacement. The pending MacRootView-only fix captures an eligible target ID, reads live active type/layout on get/set, rejects same-value callbacks, revalidates the inout tab, and writes only rightPanelOpen. Width callbacks validate the same live inspector target. Width restoration algorithm unchanged.

Delegate source parse/diff-check passed. Parent-reviewed diff. Mac build session 71015, log mac-inspector-live-target-build.log running. Next: finish build; restart exact QA process only; Cmd+L Scripture with open Notes inspector → G5485 and search type, inspect replacement state and tab IDs; Back restores reading/inspector. Verify inspector toggle remains functional and Compare tab switching stable. No synthetic forced callback test yet; source guard itself is proven by review, not by a deterministic callback injection.


## Inspector guard actual verification

Mac build passed. Exact QA process 37883 stopped; new launch session 4679 / mac-inspector-live-target-runtime.log. Actual Cmd+L G5485 kept original tab UUID and seven workspace tabs; read-only raw sync state only strongsNum, local state empty. Back restored Genesis 1:1 with Notes inspector. Cmd+L everlasting covenant selected Search in the same ID despite an existing duplicate Search tab; raw sync state only query, local empty. Back restored Notes. Inspector off/on toggle works. Evidence inspector-lexicon-replacement.json and inspector-search-replacement.json. Deterministic delayed-callback injection remains untested; the guard is supported by source review plus normal replacement regression.

## Newly observed wider-window history discrepancy (OPEN)

After fresh launch, window remains 2000 points with 340-point inspector (divider1660). Initial fraction0.4402764 may already correspond to440 rather than prior446 because geometry/extent changed at startup; no read-only immediate pre-navigation baseline was taken, so do not claim a proven six-point Back error. After Lexicon Back, raw position440 / fraction0.4343534057255676. Subsequent Search Back produced409 / fraction0.403751233958539, although selection1/Notes restored. That is a new investigation case; earlier history fixes do not close all layouts/types. Delegated bounded QA-only native viewport tracing in ChapterTextView will distinguish requested restore offset, first apply and later geometry changes. Keep temporary diagnostics out of final publication or explicitly justify retained tracing. Parent owns AppModel/ScriptureView decisions and builds/UI.


## Definitive geometry trace

Temporary instrumented Mac build passed (`mac-history-geometry-probe-build.log`), runtime session52154/log mac-history-geometry-probe-runtime.log. Read-only immediate pre-navigation snapshot history-geometry-probe-before.json confirms446. Cmd+L everlasting covenant → Search → Back: immutable restore request446; first apply reports446; subsequent widths1760→1566→1468→1426→1420 all reapply446. After the last application, AppKit reflects a pure origin change306→300 with unchanged geometry (clip1420×776, docorigin−140, textinset330×70), leaving440. Existing geometry equality rejects correction because size/frame/insets match. It is not an outgoing-snapshot failure in this controlled reproduction. Trace patch preserved ignored as history-geometry-trace.patch; do not publish temporary prints. Next fix must handle that offset-only adjustment during existing pending restore ownership, keep input cancellation and stale-request guards, and avoid a new arbitrary delay or permanent scroll lock. Agent preparing bounded native correction; parent owns review/build/UI.


## Final correction and actual evidence — 852a4767

The one-shot correction is opt-in only for first-mounted explicit history. Each successful geometry application remembers the applied clip Y. A later same-geometry origin change queues one correction on the next main turn, scoped to the native action UUID and existing request validity. It consumes that expected origin, does not restart the settle timer and cannot loop for the same geometry. Normal input, newer action, teardown and settling cancel it. Ordinary warm same-host restoration and explicit jumps do not opt in. Synthetic AX origin writes inside the still-owned initial layout burst cannot be distinguished from AppKit movement and may be corrected once; physical wheel/key/mouse/drag input cancels through the native path. Broader accessibility timing remains unverified.

Temporary diagnostics removed before source commit. `mac-history-offset-settle-build.log` passes. Final runtime session40400 / mac-history-offset-settle-runtime.log; revalidate exact QA process before lifecycle. Dev identity verified.

Actual final Mac: pre-navigation read-only history-offset-settle-before.json confirms446. Cmd+L everlasting covenant → Search in same ID → Back returns exact fraction0.4402764067127344 /446 points. Forward→Back repeats exact. Next Forward→Back followed immediately by native scroll moves to0.7462981243830207, and a further Forward→Back retains that user position. Restored final446/Genesis1KJVA/selected1/Notes inspector, sidebar239/rightdivider1660 in current2000-point window. This verifies the reproduced late adjustment and normal input ownership, not all first-frame/accessibility/resize/missing-viewport combinations.

Inspector live-target guard is commit8252c91c; last offset correction852a4767. Neither source changes iPhone margins, shared persistence, sync or identities. Latest read-only tab-lifecycle-final-data-check.json: original row hashes all present, exact37/47activeIDs and22/26notes. No new notes/messages/annotations/tabs. Only QA reading history/viewport and native window geometry changed.

Published checkpoint7263836f CI44939514152: legacy/typecheck/lint/test/build passed; native job still on platform-SQLite Simulator tests at final observation. These checks cover7263836f, not later8252c91c/852a4767. Verify latest published head after push.

Next ready work: Compare projection actual mapped/pinned secondary chapter plus reorder/clear/remove/scroll/narrow matrix; broader missing-viewport/history/startup and native inspector width drag/accessibility coverage. Physical-phone watchdog needs full .ips and reproduction; no causal closure claimed.
