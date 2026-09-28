# iPhone Notes editor — native text-editing contract

Source: the 2026-09-26 iOS Notes/Text Editing audit (ids `NOTES-IOS-*`, ledger
[testing-backlog-2026-09-26c.md](testing-backlog-2026-09-26c.md)). Reported symptoms: (1) selecting
note text showed Apple's menu AND Berean's menu on top of each other; (2) typing in a note inside the
Scripture tab's verse sheet, iOS autocorrect / spell-check made typed text disappear.

One editor everywhere: the shared ProseMirror `NoteEditorPM` (desktop panels, the iPhone Notes tab
`NoteEditorPage`, the verse sheet's `SheetNoteEditor`). The phone passes `chrome="phone"`,
`renderSelectionToolbar` and `onEditorReady`; nothing about editing is forked per platform except
where WebKit on iOS genuinely differs (below).

## 1. Root causes found

| # | Cause | Effect | Fix |
|---|---|---|---|
| 1 | `beforeinput insertReplacementText` handler (added for macOS text-expansion tools) inserted `ie.data ?? ''`. WebKit puts the replacement text in `dataTransfer`; `data` is null. | Every iOS autocorrection / spelling "Replace…" / text replacement **deleted the word** — "typed text disappears". Worst in short verse notes, where most words get autocorrected. | Read `data ?? dataTransfer('text/plain')`; no text → leave it to the browser; on iOS never intercept replacements (WebKit applies them, PM's DOM observer reads the result). |
| 2 | The same handler cancelled every collapsed Backspace and re-did it as a PM transaction (a macOS "smart delete" workaround). | On iOS the keyboard's own text model (autocorrect context, predictions) no longer matched the DOM, so the next autocorrect targeted a stale range. | Not on iOS: iOS has no smart delete; its native delete is exactly right. |
| 3 | The verse sheet's long-press `selectionchange` listener closed the "selection sheet" whenever the document selection collapsed. A caret in the note editor IS a collapsed selection. | A note opened from a long-press verse sheet closed (editor destroyed) as soon as the user tapped into it. | A selection / caret inside a sheet or an editable belongs to that surface and "adopts" the sheet (`sheetEditingGuards.isInOwnSurface`). |
| 4 | The reader closed the verse sheet on every chapter change. The keyboard shrinking the reader can move continuous scroll across a chapter boundary. | The sheet (and the note being typed) could close under the keyboard. | Not while an editable inside a sheet has focus (`isEditingInSheet`). |
| 5 | The phone's formatting bubble floated BELOW the selection; iOS puts its callout above or below depending on room. | Two menus stacked / overlapping at the selection. | The Berean bar is docked at the bottom edge (above the keyboard); the space around the selection is Apple's alone. |
| 6 | Native Format ▸ B/I/U, shake-to-undo and three-finger undo/redo were left to the browser. | DOM-level `<b>` tags and DOM undo behind ProseMirror's back — unsaved formatting, broken history. | `formatBold/Italic/Underline/StrikeThrough`, `historyUndo/Redo` are routed to the editor's own commands. |
| 7 | The Notes "Spell check" setting existed on both platforms but nothing applied it. | Toggle did nothing. | `spellcheck` follows the setting (a ProseMirror attributes function, so it survives updates). |
| 8 | An open editor ignored outside changes entirely; the next local save overwrote them silently. | iCloud / Mac edits to an open note could vanish. | External-update policy (§5). |

Checked and found sound (no change): the sheet/view React keys are stable (`note-<id>`); NoteEditorPM
mounts its `EditorView` once (mount effect `[]`, callbacks through refs) — callback identity never
remounts it; `useNoteAutosave` never feeds keystrokes back (`editorContent` changes only on load /
restore / an accepted external change); the stale-echo guard ignores the editor's own recent outputs
and any prop received while `view.composing`.

## 2. Ownership model

ProseMirror is authoritative for the live document. Everything else is downstream.

```
keyboard / IME / dictation / autocorrect ──► WebKit contenteditable ──► PM (beforeinput / DOM observer)
                                                                        │ dispatchTransaction
                                                                        ▼
                         onChange(markdown) ──► useNoteAutosave.persist (pending patch, 500 ms debounce)
                                                                        │
                                                   notesService.update ─┴─► bumpNoteToken ──► other views
```

* React / Zustand never push a document into the editor while the user edits. `content` is a LOAD
  signal: it changes on note open, version restore, or an accepted external change (§5).
* During a composition (marked text, dictation, CJK input) nothing outside the editor touches it.
* Remounts are forbidden while editing: the sheet view key, the editor's mount effect and the
  verse-sheet close paths are all stable / guarded (§1 #3, #4).

## 3. Native vs Berean — action matrix

| Action | Owner | Surface |
|---|---|---|
| Caret placement, selection handles, loupe | iOS | native |
| Cut · Copy · Paste · Select · Select All | iOS | edit callout (the only menu at the selection) |
| Replace… (spelling), Look Up, Translate, Share, Speak | iOS | edit callout |
| Autocorrect, QuickType predictions, text replacements, Dictation, Scribble | iOS | keyboard (unintercepted) |
| Format ▸ Bold / Italic / Underline (callout) | iOS menu → routed to the editor's marks | callout (Apple-owned; cannot be removed from a WKWebView without native code) |
| Undo / redo (shake, 3-finger, ⌘Z) | editor history | gesture / keyboard |
| Bold · Italic · Underline · Strikethrough · Highlight · Link · Inline code | Berean | docked formatting bar (appears with a selection, above the keyboard) |
| Insert: Scripture reference, image, link, heading, lists, quote, divider | Berean | + button (same bottom row; steps aside while the formatting bar shows) |
| Verse reference / wikilink / Strong's link taps | Berean | inline in the text |
| Paste of rich text / Scripture | Berean paste plugin (markdown preserved) | native Paste |

Rules: exactly one floating menu (Apple's); Berean controls live on the bottom edge; no Berean
button duplicates a native clipboard / selection command; the only overlap (B/I/U in Apple's own
Format submenu) is Apple-owned and produces identical results.

## 4. Editor lifecycle

1. **Open** — `useNoteAutosave(noteId)` loads the note → `editorContent`; NoteEditorPM mounts ONE
   `EditorView` (spellcheck from Settings, autocorrect on, capitalization untouched).
2. **Edit** — input goes through WebKit; PM reads it; each transaction emits markdown →
   `persist` (patches accumulate; 500 ms debounce save; idle 2 min → version snapshot).
3. **Selection** — PM selection plugin → the docked Berean bar; the iOS callout is native.
4. **Outside change** — §5.
5. **Leave** (close sheet, switch tab, background, pagehide) — pending patches flush (all fields),
   a version snapshot is taken if content changed, the view is destroyed.

## 5. External-update policy (iCloud, the Mac, another editor)

* Our own saves coming back are recognised (content we wrote) and ignored.
* While the user is typing — focus in an editable, a keystroke in the last 2 s, or a save pending —
  outside content is **not** applied. It is stored as a note version (`kind: "external"`) so the
  local save that follows never destroys it silently, and re-checked once the user leaves the field.
* When idle, outside content replaces the editor document (a load: caret mapped to the same offset;
  undo history restarts).
* Conflicts are last-writer-wins at the note level (the sync engine's rule); the "external" version
  is the recovery path (Versions in the note caret).

## 6. Keyboard & sheet stability

* `--m-keyboard-h` / `html[data-keyboard]` (Capacitor Keyboard events) place the formatting bar and
  the + just above the keyboard, in and out of sheets.
* A sheet drag dismisses the keyboard (sheet rule); nothing else closes or re-keys a sheet while an
  editor in it has focus.

## 7. Test matrix

| Area | Automated | Simulator (probe) | Physical iPhone |
|---|---|---|---|
| Replacement text from `dataTransfer` replaces, never deletes | iosTextInput | event not cancelled on iOS | autocorrect a misspelling; "Replace…" |
| iOS native delete / replacement not intercepted; Mac exact delete kept | iosTextInput | — | Backspace, hold-Backspace word delete |
| Native Format / undo / redo → editor commands | iosTextInput | — | callout Format ▸ Bold; shake to undo |
| Composition never overwritten | iosTextInput, staleEchoGuard | — | Dictation, Japanese/Chinese keyboard |
| No remount on re-render | iosTextInput | — | — |
| Spellcheck setting / autocorrect / no forced caps | iosTextInput, inputCapitalization | attributes verified | toggle Settings → Notes → Spell check |
| Sheet survives caret, selection collapse, chapter change | phoneNoteEditor (guards) | verified | long-press → Notes → type |
| Docked bar, + steps aside, never beside the selection | phoneNoteEditor | verified (bar 476–527 pt, selection 191–211 pt, keyboard 335 pt) | select text: only Apple's callout at the selection |
| Autosave / flush all fields / external policy | noteAutosave | — | edit the same note on the Mac while typing |

## 8. Known limitations

* The Format ▸ B/I/U entry in Apple's callout cannot be hidden from web content (it needs a native
  `WKWebView` subclass — an Xcode project change, out of scope here). It is routed to the same marks.
* jsdom cannot run real IME compositions or WebKit's autocorrect; those paths are covered by
  unit-level event simulation + the simulator probe and must be confirmed on a device.
* An accepted external change restarts undo history (it is a load, not an edit).
