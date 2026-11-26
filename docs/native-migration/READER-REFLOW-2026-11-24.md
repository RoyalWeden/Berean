# Mac reader reflow restoration — November 24

Temporary, opt-in metadata tracing was added to the Mac reader only for `--qa-library --qa-profile codex-controls-20261119 --qa-reader-trace`. It records no passage text or note content and must be removed before the final shipping build. The tested binary was b496e3bf plus the trace, before the in-progress Compare changes.

## Measured original behavior

The established Jeremiah33:11 reader had its Notes pane open, Strong’s off and selected verse11 above the viewport. Manual wheel scrolling reached clip origin635, document min−140 and height1698, clip1099×877, legal origin−140…727, fraction .8938869665513264 and first verse12 at crop−12.8 (origin minus its first line). Three Notes→reader and three Compare→reader cycles retained the same origin and crop. Visible width sometimes attached at1119 before settling1099; the original point remained635. The saved offset was775 (origin minus document min).

A cold launch opened the same reader at clip759×877, document height1767, legal origin−140…796. It restored origin635 and fraction .8279914529914529, but verse12 crop was−35.8: the line moved23points because the text rewrapped. This is measured geometry/reflow, not evidence that a different fraction by itself is a scroll defect. Source has been patched to use the existing device-local viewportWidth and verseOffsetFromTop fields on Mac, with semantic restoration when width differs by more than1point. Legacy anchors without width keep their old fallback; explicit navigation and chapter-end intent retain priority. Functional build/runtime pending.

Ignored evidence: mac-reader-return-warm-trace.json (229 events), mac-reader-return-cold-trace.json, mac-reader-return-trace-final-build.log. Raw bounded logs are /private/tmp/berean-reader-return-trace.log and /private/tmp/berean-reader-return-cold-trace.log. The interrupted pause occurred with Cmd-L palette open; it was dismissed without navigation on resume. QA app is currently quit. Reopen only explicit QA arguments; owner MacPID2506 remains untouched.

## Required verification

Capture a new width-aware anchor at a measured partial row, cold return with changed width, and confirm the same verse crop within one physical pixel after settling. Also verify unchanged-width exact points, immediate user wheel input wins, explicit Go reaches its verse, selection near the end clears the action bar, and the original Genesis1 reported case. Reconcile measured layout differences; do not broaden a correction timer from fractions alone. Restore the established Jeremiah33:11/Search voice-of-joy/Thursday note/Compare baseline. Remove trace helpers before final builds and prepare both owner apps.
