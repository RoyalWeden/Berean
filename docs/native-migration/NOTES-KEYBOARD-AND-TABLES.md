# Native Notes keyboard and table checkpoint

Source713bd02e/1b9a4074;2026-11-19. Migration remains active.

The iPhone accessory keeps six controls in prose and five in a table. Undo/Redo, formatting/table and dismissal use related native glass groups. Formatting contains text styles, highlight colors, code and links; paragraph/list options appear in prose. Table Options groups live Previous/Next Cell and row/column edits. A deferred uncached navigation menu reads the actual retained selection at opening, including a disabled Next action in the last cell. Existing hardware Tab/ShiftTab remains. Flexible width adapts the initially320pt accessory to the observed402pt phone; a seven-control design was rejected after actual overflow. Haptics follow the existing setting, and Undo/Redo reflect native history.

Both editors protect actual GFM tables from paragraph prefixes, lists, callouts and nested table insertion. Inline style/link/reference operations remain. The shared public range guard validates UTF16, excludes real table paragraphs, and preserves literal pipes, fenced examples, prose boundaries, Windows newlines and EOF behavior. UI Format/Insert/quick Checklist follows the same context. Insert Table remains direct in prose and becomes contextual table options in a cell.

Actual simulator tests used only a disposable Topic/Verse table. Row and column insertion, Undo/Redo, selected Prayer Bold/Undo/Redo/toggle, cell navigation and disabled lastNext all passed exact persisted-source checks. Prose Heading2 changed only After table. and rendered without markers; table block styles were disabled. Actual Mac tests confirmed disabled controls/Insert submenu, table CmdOption2 no-op, prose CmdOption2 valid heading and exact Undo. Both test notes were recoverably trashed, their extra tabs closed and original reading states restored. Original16Mac/17iPhone hashes/timestamps,37/47activeIDs and all tags match baseline.

Full265tests=4core+261conformance/65suites pass in /tmp/berean-note-table-final-full-tests.log; final builds /tmp/berean-note-table-publish-{mac,ios}.log pass. Exact runtime IDs, source comparisons, initial rejected experiments and cleanup are in HANDOFF.

Optional DEBUG simulator flag --qa-note-keyboard-trace records only ranges, context, item labels and bounds in note-keyboard-context.json. It is off in the final installed app. Re-query the simulator container after every install. Current path is saved at /private/tmp/berean-note-keyboard-ios-container.txt. Never edit the original notes or write directly to app databases.

Open: real phone, compact320/iPad/landscape/DynamicType/VoiceOver/IME, multi-cell selection/combined marks/color, arbitrary imported malformed-source and full rich-editor parity. Latest owner automatic verse/Strong’s blocks request needs original Electron storage/expansion/settings review; this toolbar work does not complete that feature.
