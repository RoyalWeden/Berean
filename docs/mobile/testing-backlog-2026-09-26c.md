# Testing backlog — 2026-09-26, iOS Notes text-editing audit (ids NOTES-IOS-*)

Source: the developer's "MAJOR iOS Notes/Text Editing integration audit and redesign" brief. Design,
root causes, ownership, action matrix, lifecycle and policy: [notes-editor-ios.md](notes-editor-ios.md).
"Sim" = iOS simulator via the probe harness; **Dev** = physical iPhone.

| ID | Requirement | Implementation | Files | Platform | Tests | Manual | Status |
|---|---|---|---|---|---|---|---|
| NOTES-IOS-001 | Autocorrect / spell-check never makes typed text disappear | replacement text from `data` or `dataTransfer`; none → browser; iOS replacements and collapsed deletes left to WebKit; composition never intercepted | components/notes/pm/NoteEditorPM.tsx | both (shared editor) | iosTextInput | Sim: WebKit event not cancelled | COMPLETE (Dev: real autocorrect) |
| NOTES-IOS-002 | The verse-sheet note editor is as stable as the standalone one | caret / selection inside a sheet or editable never closes the selection sheet; chapter change never closes the sheet while typing in it | reader/verseSheets.tsx, reader/ReaderPage.tsx, reader/sheetEditingGuards.ts | iPhone | phoneNoteEditor (guards) | Sim: sheet kept after collapse + chapter change | COMPLETE |
| NOTES-IOS-003 | One selection experience, no overlapping menus | Berean formatting bar docked at the bottom edge (above the keyboard); + steps aside; iOS callout is the only menu at the selection | notes/PhoneSelectionToolbar.tsx, notes/noteEditor.css | iPhone | phoneNoteEditor | Sim screenshot | COMPLETE (Dev: callout) |
| NOTES-IOS-004 | External / iCloud updates never overwrite active typing | echoes ignored; while typing: preserved as an "external" version, not applied; idle: applied; flush keeps every pending field | notes/useNoteAutosave.ts | iPhone | noteAutosave (4 new) | — | COMPLETE (Dev: Mac edit while typing) |
| NOTES-IOS-005 | Spellcheck / autocorrect enabled; capitalization not forced | `spellcheck` follows Settings → Notes → Spell check (was never applied), `autocorrect="on"`, no autocapitalize | NoteEditorPM.tsx | both | iosTextInput, inputCapitalization | Sim: attributes | COMPLETE |
| NOTES-IOS-006 | Rich text, undo / redo, native commands coherent | formatBold / Italic / Underline / StrikeThrough, historyUndo / Redo → editor commands | NoteEditorPM.tsx | both | iosTextInput | — | COMPLETE (Dev: shake to undo) |
| NOTES-IOS-007 | No remounts while editing | verified: stable sheet keys, mount-once view, ref'd callbacks; test added | — | both | iosTextInput | — | COMPLETE |
| NOTES-IOS-008 | Documentation: contract, ownership, matrix, lifecycle, policy, test matrix | notes-editor-ios.md; feature-matrix, implementation-progress, architecture updated | docs/mobile/* | — | — | — | COMPLETE |
