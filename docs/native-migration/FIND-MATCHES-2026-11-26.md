# Scripture Find match colors on Mac and iPhone

The Find overlay draws visible inactive matches in pale yellow and the current match in orange. Both readers use the same TextKit drawing code. The overlay runs after native background drawing and leaves saved highlight attributes, selections, body offsets, and Mac tag hover attributes intact. Match counting, wraparound, and scrolling to the current match use the existing reader behavior.

Changing or clearing a query redraws both old and new match coverage. Stepping through an unchanged query redraws only the previous and current match. Chapter and style rerenders clear the old drawing state before replacing the text storage. The drawing intersects match ranges with the visible characters before looking up glyphs.

## Verification

- Swift parsing passed for both readers and the shared source with and without `DEBUG`, using the Mac and iPhone Simulator targets.
- The shared layout manager passed isolated Swift 6 complete-concurrency typechecking against both SDKs. Checks used separate temporary caches and left the application builds untouched.
- Runtime verification is open. In KJVA Psalm 24, search for `Yehovah`, then step forward and back and confirm the orange marker moves while other matches remain yellow. Check query replacement, no matches, close, chapter changes, and a match over an existing saved highlight. Closing Find should reveal the same saved highlight and selection.
