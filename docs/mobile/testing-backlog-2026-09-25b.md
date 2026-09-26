# Testing backlog — 2026-09-25 v2 (notes · audio · floating navigation · sheets)

Source: the developer's `September 25, 2026 – Testing v2` folder (notes + 3 screenshots: the note
editor with its permanent format bar, the old bottom audio bar, a YouVersion audio sheet used as
the reference for Berean's own audio sheet) and the v2 brief. Continues
[testing-backlog-2026-09-25.md](testing-backlog-2026-09-25.md) (SEP25 / UX ids stay valid) and the
permanent rules in [../ux-principles.md](../ux-principles.md).

"Sim" = verified in the iOS simulator with the probe harness (synthetic touches/typing). **Dev** =
needs the physical iPhone. Nothing here was run on the Mac app (shared changes are unit-tested and
built).

| ID | Requirement | Implementation | Files | Platform | Tests | Manual | Status |
|---|---|---|---|---|---|---|---|
| TEST25-NOTES-001 | Typed note text must never disappear | Root cause: every keystroke saved AND re-fed the note into the editor; a late re-render carried an older copy of the editor's own text and the editor replaced its document with it. Fixed twice: the editor ignores echoes of its own recent output (and any same-note update while the IME composes); the iPhone hosts give the editor load-time content only | pm/NoteEditorPM.tsx, mobile/notes/useNoteAutosave.ts, NoteEditorPage.tsx, study/VerseNotesSheet.tsx | both (editor) | staleEchoGuard (2), noteAutosave (3) | Sim: fast typing → shown + saved; switch tabs; relaunch → text there | COMPLETE (Dev: real keyboard / autocorrect) |
| TEST25-NOTES-002 | Autosave never drops a field | Pending patches accumulate across the debounce (a title edit used to replace a pending body save); failed saves keep their fields; flush on leave / background / unmount | useNoteAutosave.ts | iPhone | noteAutosave | — | COMPLETE |
| TEST25-NOTES-003 | No permanent formatting bar; format by selection; markdown | `chrome="phone"` hides the docked toolbar and stats; selection bubble (B / I / U / S / highlight / link / code) below the selection; input rules ("## ", "- ", "> ") | pm/NoteEditorPM.tsx (opt-in props), mobile/notes/PhoneSelectionToolbar.tsx | iPhone (desktop unchanged) | phoneNoteEditor | Sim: no bar | COMPLETE (Dev: bubble vs iOS callout) |
| TEST25-NOTES-004 | Floating + (bottom-left) with insert actions, keyboard-aware, hides on scroll | Glass + → Scripture reference, Image, Link, Heading, Bulleted list, Checklist, Quote, Divider (the editor's own slash commands) | mobile/notes/NoteInsertButton.tsx, noteInsertCommands.ts | iPhone | phoneNoteEditor | Sim | COMPLETE (Dev: above keyboard) |
| TEST25-NOTES-005 | Header without duplicate reference; stats in the caret | reference line only when the title doesn't say it; "Statistics" row in the note caret | NoteEditorPage.tsx | iPhone | — | Sim | COMPLETE |
| TEST25-NOTES-006 | Long-press note: Move (only if movable), Delete (to Trash, no confirm), Cancel | already so — verified | NotesHomePage.tsx | iPhone | — | — | COMPLETE |
| TEST25-NOTES-007 | Verse notes: preview cards; + bottom-right only when no note; tap card opens; + creates for the verse | cards; floating + with no notes; "Add another note" link keeps multi-note capability | study/VerseNotesSheet.tsx, notes/verseNotes.css | iPhone | — | Sim: + only when empty | COMPLETE |
| TEST25-NOTES-008 | A requested note never opens over the tags graph (found in testing) | switch to / create a Notes tab first; transformed tabs fall back to the space's most-recent tab | MobileApp.tsx, store swapTabType | iPhone | store tests | Sim | COMPLETE |
| TEST25-AUDIO-001 | Floating play/pause instead of the big bottom bar | 56 pt glass circle above the bottom controls (lower when they collapse), hidden under sheets / Hide Controls | audio/AudioBar.tsx, audio.css | iPhone | audioFollowAndControls | Sim | COMPLETE |
| TEST25-AUDIO-002 | Top-right audio button opens the audio sheet | speaker glass circle; header padding contract `data-floating-right` | AudioBar.tsx, readerChrome.css | iPhone | — | Sim | COMPLETE |
| TEST25-AUDIO-003 | Audio sheet: passage title, source, transport, progress, speed, sleep timer, Hide Controls | title "Genesis 2", "KJVA · voice", verse progress (TTS has no durations), ⏮ ⏯ ⏭, speed chip, Hide Controls, timer; Follow · Queue · Voice · Stop | audio/AudioSheet.tsx | iPhone | tests | Sim screenshot | COMPLETE |
| TEST25-AUDIO-004 | Hide Controls | hides the floating button only; audio continues; top-right stays | AudioBar.tsx, audioControls.ts | iPhone | tests | — | COMPLETE |
| TEST25-AUDIO-005 | Sleep timer (5–60 min, end of chapter / book), countdown only in the sheet | deterministic state machine; pauses (not clears); cancelled by Stop | audio/sleepTimer.ts | iPhone | 13 tests | — | COMPLETE (Dev: lock screen) |
| TEST25-AUDIO-006 | Auto-follow; manual scroll stops following until chapter change / resume | followState + one guard in ChapterView's follow effect; "Follow" chip + sheet action | audio/followState.ts, components/bible/ChapterView.tsx | iPhone (desktop: no-op) | tests | — | COMPLETE (Dev) |
| TEST25-SHEET-001 | Sheet drag keeps ownership when direction reverses; below the top detent an upward drag expands the sheet | sheetGesture: no hand-back mid-touch; `sheetTakesOver` up = !atTop | primitives/sheetGesture.ts, Sheet.tsx | iPhone | sheetGesture (11), sheetBodyDrag (3, incl. reversal) | Sim (earlier pass) | COMPLETE (Dev: feel) |
| TEST25-NAV-001 | Change the current tab's type without a new tab; history across types | store `transformTab` (same slot, stack carried, `switchType` entries; back / forward re-transform) | store/index.ts, types | iPhone (shared store) | transformTab (8) | Sim: Scripture → Notes → ‹ back to Genesis 2, tab count 16 → 16 → 16 | COMPLETE |
| TEST25-NAV-002 | Floating top-left switcher (fan, other types only, collapses on choose / outside / scroll) | TabTypeSwitcher: grid glyph, 7 options, dim scrim, thicker option material | navigation/TabTypeSwitcher.tsx, experiences.css, MobileApp.tsx | iPhone | — | Sim screenshot | COMPLETE |
| TEST25-NAV-003 | Search both ways understands "scripture", "notes", "history" … | keyword table (`experiences.ts`) → `exp-*` destinations; caret = current tab, plus = new tab | navigation/experiences.ts, destinationQuery.tsx | iPhone | 11 tests | — | COMPLETE |
| TEST25-NAV-004 | Go To actions for other experiences (not the current one) | experience row in the caret go-to and the plus sheet | CaretGoTo.tsx, NewTabSheet.tsx | iPhone | — | — | COMPLETE |
| TEST25-NAV-010 | Bottom controls collapse on scroll on every tab | `useChromeScrollCollapse` (same hysteresis) → `pageCollapsed` | primitives/useChromeScrollCollapse.ts, chromeState.ts, MobileApp.tsx | iPhone | — | — | COMPLETE (Dev) |
| TEST25-NAV-011 | Floating controls never cover header buttons (all experiences) | central header padding by `data-floating-left/right` for pages and hosted panels | reader/readerChrome.css | iPhone | — | Sim: Lexicon header fixed | COMPLETE |
| TEST25-VERSE-001 | No "Cross references" heading | the source switch leads the block | study/VerseStudy.tsx | iPhone | — | Sim | COMPLETE |
| TEST25-VERSE-002 | Strong's toggle only at the lowest position; on = whole verse, no highlight row; persists | toggle shown only `atLow`; compact position measured to fit; mode remembered per device | study/VerseActionSheet.tsx | iPhone | — | Sim screenshot | COMPLETE |
| TEST25-SCRIPTURE-001 | Very fast continuous scroll never blank | (SEP24 fixes) re-verified | ContinuousChapterScroll.tsx | both | — | Sim: 60 jumps of 2.6–3k px → 0 blank frames | COMPLETE (Dev: momentum) |
| TEST25-SCRIPTURE-002 | Rapid chapter changes never stick | (NEW-005C policy) re-verified | ReaderPage.tsx | iPhone | — | Sim: 12 taps in 420 ms → state = shown, track at rest | COMPLETE (Dev: real swipes) |
| TEST25-SCRIPTURE-006 | Strong's ≈1.5× in the reader, balanced in sheets | reader 0.92 em (≈14.7 px on 16 px text), sheets 0.85 em | mobile.css | iPhone | — | Sim screenshot | COMPLETE |
| TEST25-SCRIPTURE-008 | Reader settings incl. text width | Display → Text width (Wide / Normal / Narrow) | reader/readerWidth.ts, ReaderPage.tsx, readerChrome.css | iPhone | — | — | COMPLETE |
| TEST25-GLASS-001 | Real, readable material on floating controls | thicker material where controls sit over Scripture (switcher options, play/pause); no outer shadows on backdrop-filtered circles (WKWebView square-shadow) | experiences.css, audio.css | iPhone | — | Sim | COMPLETE (Dev) |
| TEST25-DB-001 | Database-aware navigation / fallbacks (Matthew 10 LXX → KJV; Genesis 10 LXX → LXX; missing chapter → first) | existing shared resolver + navigateToVerse translationOverride (SEP24/25) | lib/passageDestinations.ts, verseNavigation.ts | both | resolver tests | Sim | COMPLETE |

Items the brief repeats from earlier passes and that are unchanged (verified, not re-implemented):
book/chapter picker hierarchy and live chapter flow (SEP25-019), per-book filters (NEW-015), search
caret without Scope + History in the same sheet (NEW-014), floating-search keyboard dismissal
(NEW-013), tab cards + Recent / Custom (SEP25-020), same-sheet sub-views and geometry
(NEW-001/002), verse selection model (T23-028).

## Known limits

- TTS has no real durations: progress is by verse ("v. 7 of 25").
- "End of chapter" sleep stops paused at verse 1 of the next chapter (the title shows it).
- The phone selection bubble sits below the selection; its clearance from the iOS magnifier must
  be checked on a device.
