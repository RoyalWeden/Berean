# Scripture Find match colors on Mac and iPhone

The Find overlay draws visible inactive matches in pale yellow and the current match in orange. Both readers use the same TextKit drawing code. The overlay runs after native background drawing and leaves saved highlight attributes, selections, body offsets, and Mac tag hover attributes intact. Match counting, wraparound, and scrolling to the current match use the existing reader behavior.

Changing or clearing a query redraws both old and new match coverage. Stepping through an unchanged query redraws only the previous and current match. Chapter and style rerenders clear the old drawing state before replacing the text storage. The drawing intersects match ranges with the visible characters before looking up glyphs.

## Verification

- Swift parsing passed for both readers and the shared source with and without `DEBUG`, using the Mac and iPhone Simulator targets.
- The shared layout manager passed isolated Swift 6 complete-concurrency typechecking against both SDKs. Checks used separate temporary caches and left the application builds untouched.
- Runtime verification is open. In KJVA Psalm 24, search for `Yehovah`, then step forward and back and confirm the orange marker moves while other matches remain yellow. Check query replacement, no matches, close, chapter changes, and a match over an existing saved highlight. Closing Find should reveal the same saved highlight and selection.

## Final app verification

The initial full builds found a Swift6 region-isolation error that the narrow typecheck had missed.536ed1b9 moves state into a main-actor store and captures its immutable reference; both full app builds then passed. Logs /private/tmp/berean-native-find-all-fixed-{mac,ios}-20261126.log. Source has no unsafe Sendable override.

Actual Mac QA: ROM8 Spirit found22matches. Inactive matches were pale yellow, including additive paint over existing blue highlights at verses1–2; current orange moved1→2→1. No-match Christ respected the displayed Messiah substitution. Close removed Find paint and restored the unchanged blue appearance. Actual iPhone QA: Matthew5 blessed9matches, orange current9→8→9, pale inactive, nonexistent query cleared paint. Changing to Matthew6 reported no matches with no stale yellow/orange; closing then Back restored Matthew5:12 selection/nine tabs. No highlight records were edited by the test. Wider dark/light palettes, huge-text performance and device VoiceOver remain open.
