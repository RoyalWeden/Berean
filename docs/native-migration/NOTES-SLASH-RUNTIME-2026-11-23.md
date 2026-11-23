# Notes slash commands — actual runtime checks, Nov23

Published runtime through b9c0e388, which includes the audited atomic slash edit fix04febca1. This is independent runtime verification of that fix, not a new Notes source change or a claim of complete editor parity. Precision Compare source was being edited separately and was not the running binary.

## Mac

Created owned disposable general note `6a050ae8-8513-4810-9fb4-c0fb6f12343c` (Codex slash audit Nov23) in the isolated controls library. New Note reused the Notes tab; seven workspace tabs remained. Typed Before, blank paragraph, /head; clicked Heading2, typed Headingresult. Actual screen shows a rich heading without Markdown markers. Undo removes typed text, nextUndo restores /head in one command step; twoRedo restore heading and typed words.

Typed /table after a blank paragraph, chose Table. Screen renders a clean two-column/two-row grid. Table toolbar detects the caret is inside a table and shows AddRowBelow/AddColumnAfter/DeleteRow/DeleteColumn/DeleteTable. AddRowBelow adds one row, oneUndo removes it, nextUndo restores /table in one command step. Read-only persisted source is exactly `Before\n\n## Heading result\n\n/table` after undoing table insertion. Source evidence mac-notes-slash-fixture.json is ignored under Nov23 QA evidence.

Moved only this fixture to recoverable Trash through the normal confirmation; Notes tab returned to Notes. Restored original Genesis1selected1/Notes inspector and explicit original scrollbar fraction.07135575942915393.

## iPhone

Only owned D0CC; existing NotesTab1 in Study. Created owned disposable note `c1227e89-7f8c-424b-9481-0b11a4c598c6` (Codex iPhone slash audit Nov23), without increasing nine workspace tabs. Typed /head, hardwareDown then Return accepts Heading2. Actual screen renders rich heading without markers. The glass accessory Undo twice removes words then restores /head; Redo twice restores heading and words.

Typed /table and hardwareReturn accepts. Screen shows two-column/two-row table with clean grid. Context table accessory offers AddRowBelow/AddColumnAfter/DeleteRow/DeleteColumn/NextCell and disabled PreviousCell in first cell. AddRowBelow and Undo work, then oneUndo returns to /table. HardwareEscape dismisses the restored slash menu without altering its text. Read-only exact persisted source matches the Mac fixture (ios-notes-slash-fixture.json).

Moved only this fixture to recoverable Trash through the note menu; Notes returns to its home. Returned original Study/Matthew5selected12, Strong’s off, panel closed, nine tabs. Some native toolbar controls are not exposed in DeviceHub's flattened AX tree, so coordinate actions were used from observed screenshots; this is not a physical VoiceOver pass.

## Data and remaining scope

`notes-slash-final-data-check.json` confirms all watched ORIGINAL notes/settings/messages/tags/trail/PDF row hashes remain present and unchanged on both QA libraries; exact active IDs37Mac/47iPhone. Each library has exactly one additional recoverably trashed owned fixture, with its own expected revision activity. Do not claim all DB bytes or note counts unchanged. No permanent delete, production/sync service/schema/identity/signing/physicalphone writes. Other checkout and Claude device untouched.

Still OPEN: physical phone/IME/Dictation/VoiceOver, deferred image chooser caret/navigation race, large/wide table content/wrap and horizontal editable grid, Board drag/bulk selection, PDF label failure/focus. Existing pure composition tests and these real heading/table operations do not close those other paths.
