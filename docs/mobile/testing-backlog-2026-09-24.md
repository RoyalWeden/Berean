# Testing backlog — 2026-09-24 (refinement pass)

Source: the developer's notes `September 24, 2026 – Testing.md` plus 12 reference screenshots
(kept in `~/Downloads/`, not copied here) and the Sept 24 brief. Builds on
[testing-backlog-2026-09-23b.md](testing-backlog-2026-09-23b.md). **Dev** = needs the physical
iPhone to be fully verified. "Sim" = verified in the iOS simulator with the probe harness.

Navigation model (unchanged, now applied everywhere): **Tabs → current tab → caret / sheet →
sub-view in the same sheet → back.**

## Requirement ledger

| ID | Requirement | Implementation | Files | Platform | Automated | Dev | Status |
|---|---|---|---|---|---|---|---|
| SEP24-001 | Shared iPhone material system: subtle Apple-like glass, Arc density | Tokens `--m-glass-thin/regular/thick/sheet`, hairline, separator, radii; `.m-glass*` classes on sheets, cards, headers, bottom nav, fields, chips, tab cards | `mobile.css`, `ios-design-system.md` | iPhone | Sim screenshots | yes (feel) | COMPLETE |
| SEP24-002 | Reduce Transparency fallback | Native `BereanA11yPlugin` reports `reduceTransparency` (live notification) → `html[data-reduce-transparency]`; every material goes opaque | `BereanA11yPlugin.swift`, `plugins.ts`, `MobileApp.tsx`, `mobile.css` | iPhone | Typecheck; iOS build | yes | COMPLETE |
| SEP24-003 | Increase Contrast fallback | `data-contrast="more"` / media query: α ≥ 0.97, stronger hairlines, 1px rings | `mobile.css` | iPhone | CSS only | yes | COMPLETE |
| SEP24-004 | Sheets look native; detents drag naturally | Glass sheet surface, 30pt radius; sub-view transitions as CSS keyframes that always complete; pushes within 450 ms of opening don't animate | `Sheet.tsx`, `sheet.css` | iPhone | Sim | yes (drag) | COMPLETE |
| SEP24-005 | Book/chapter picker: low, medium, full detents; no persistence after close | Picker `detents [0.34, 0.62, 0.92]`, opens full; fresh state each open | `ReaderPage.tsx`, `ComparePage.tsx` | iPhone | Sim | yes | COMPLETE |
| SEP24-006 | Nested sheet content keeps detent and position | Unchanged from NEW-002, re-checked with the new transitions | `Sheet.tsx` | iPhone | Sim | no | COMPLETE |
| SEP24-007 | Picker opened offset sideways | Cause: an interrupted framer view transition parked at -28%. Replaced by CSS keyframes | `Sheet.tsx`, `sheet.css` | iPhone | Sim: transform none, flush | yes | COMPLETE |
| SEP24-008 | Remove "Why'd you go to…" on iPhone only | Prompt no longer rendered in `MobileApp`; Settings row removed; macOS untouched | `MobileApp.tsx`, `SettingsPage.tsx` | iPhone | Typecheck; vitest | no | COMPLETE |
| SEP24-009 | Continuous scroll: no blank page on chapter switch | On an external jump the height cache clears and it scrolls to the new chapter top, honouring `scroll-padding-top` | `ContinuousChapterScroll.tsx`, `readerChrome.css` | both (shared) | Sim: jumps land correctly | yes | COMPLETE |
| SEP24-010 | Continuous scroll: no blank on fast fling; rapid swipes can't corrupt state | Visible chapter measured from the DOM (not a stale observer); placeholder offsets mapped to chapters and mounted; deeper prefetch when fast | `ContinuousChapterScroll.tsx` | both (shared) | Sim stress test: zero blank samples | yes (momentum) | COMPLETE |
| SEP24-011 | Collapsed header: phone-matching radius, device-aware | Island: capsule under the island; notch: 32pt lower corners; home-button: small pill; `data-cutout` on `<html>` | `CompactPassageHeader.tsx`, `readerChrome.css` | iPhone | Sim (island) | yes (notch device) | COMPLETE |
| SEP24-012 | Blur must not affect the notch background | Band is the opaque reader surface with an 8px fade, no blur | `readerChrome.css` | iPhone | Sim screenshot | yes | COMPLETE |
| SEP24-013 | Screenshots of the notch look bad — investigate | iOS does not render the island/notch into screenshots; not changeable by apps. Documented | `ios-design-system.md` | iPhone | n/a | n/a | DOCUMENTED (platform limit) |
| SEP24-014 | Picker search at every level ("10", "10:5", "Matthew 10", "Matthew 10 LXX") | `PickerSearch` on collections, books and chapters; resolver `extractTextToken` + in-book numbers via `bookId` | `PassagePicker.tsx`, `passageDestinations.ts` | both (resolver) | 16 resolver tests; Sim | no | COMPLETE |
| SEP24-015 | Text token in a search switches the actual database | `withText()`; "Genesis 10 LXX" opens the LXX DB (Greek Strong's seen); "1 Enoch 10" → Enoch | `passageDestinations.ts` | both | Unit tests; Sim | no | COMPLETE |
| SEP24-016 | Caret header: location/search field + back/forward over the current tab's history, same on every caret | `CaretScope.location`; `CaretLocationBar` uses the shared `tabNavStacks` (`navTabBack/Forward`); Reader, Notes home, Note editor, Search | `caretRegistry.ts`, `CaretSheet.tsx`, pages | iPhone (shared history) | Sim: back/forward restores MAT 10 / DEU 9 | no | COMPLETE |
| SEP24-017 | Find on Page to the left of Strong's; Compare below; keep KJV/LXX switch | Tile order Find · Strong's · KJV/LXX · Read aloud; "Compare with the Septuagint/KJV" + All Translations in the text section | `ReaderPage.tsx` | iPhone | Sim | no | COMPLETE |
| SEP24-018 | Display options as an inline collapsible row | `CaretSection.collapsible` disclosure (size, line height, font, appearance, colour, continuous, verse numbers, red letters); sheet does not move | `caretRegistry.ts`, `CaretSheet.tsx`, `ReaderPage.tsx` | iPhone | Sim | no | COMPLETE |
| SEP24-019 | Find on Page: whole current book, highlights, next/prev, works in continuous scroll | `FindOnPageBar` loads the book once (cached), all-words match on displayed text, highlight via ChapterView `findQuery`, stepping moves the tab without history | `FindOnPage.tsx`, `ReaderPage.tsx`, `readerChrome.css` | iPhone | 3 unit tests; Sim: 7 matches, Next changes chapter | yes (keyboard) | COMPLETE |
| SEP24-020 | Strong's slightly larger in reader, balanced in sheets | 0.75em, wrapper inherits (was a fixed 10px caption class) | `mobile.css`, `compare.css` | iPhone | Sim: 12px on 16px text | yes (readability) | COMPLETE |
| SEP24-021 | Accurate, performant tab previews (Settings, Search, …) | Per-type previews from saved state (scripture at scroll verse, search summary saved by SearchPage, history, notes, lexicon); session cache; no tab reset; stale "Searching…" fallback replaced | `TabPreview.tsx`, `tabPreview.css`, `SearchPage.tsx`, `tabFields.ts` | iPhone | Sim screenshot | no | COMPLETE |
| SEP24-022 | Notes: remove "All views (desktop layout)" | Removed; Group by / Sort in the caret; `noteGrouping.ts` | `NotesHomePage.tsx`, `noteGrouping.ts` | iPhone | Unit tests; Sim | no | COMPLETE |
| SEP24-023 | Search result long-press context menu, per type | Scripture / note / lexicon / recent action specs; highlight as a sub-view | `resultActions.ts`, `ResultActionSheet.tsx`, `SearchPage.tsx` | iPhone | Unit tests; Sim (verse + recent) | yes (press feel) | COMPLETE |
| SEP24-024 | Action sheets native (grouped menu) | Inset-grouped rows with separators, separated Cancel, chevron for sub-views — app-wide | `ActionSheet.tsx`, `mobile.css` | iPhone | Sim screenshot | no | COMPLETE |
| SEP24-025 | Floating Search redesign | Filled field → one row of 8 icon destinations → inset Recent (5, Show All) → typed-query actions | `NewTabSheet.tsx` | iPhone | Sim screenshot | yes (keyboard) | COMPLETE |
| SEP24-026 | Bottom navigation glassy, same structure | Tabs / plus / caret on thick glass; collapses on scroll (unchanged) | `mobile.css` | iPhone | Sim screenshot | yes | COMPLETE |
| SEP24-027 | Global navigation / simplicity audit with destination map | Table below | this file | iPhone | n/a | no | COMPLETE |
| SEP24-028 | Gesture ownership audit | Table below | this file | iPhone | n/a | yes | COMPLETE |
| SEP24-029 | Density audit | Arc-like density kept: 44pt targets, 52pt action rows, 44pt reader header, inset groups | `mobile.css` | iPhone | Sim | no | COMPLETE |
| SEP24-030 | Accessibility audit | VoiceOver labels on icon tiles and caret nav (`a11yLabel`), 44pt targets, Reduce Transparency / Increase Contrast / Reduce Motion, Dynamic Type via `--m-type-scale` | various | iPhone | Typecheck | yes (VoiceOver) | COMPLETE |
| SEP24-031 | Device compatibility | Island / notch / home-button handled by `safeAreaTop()` classification | `CompactPassageHeader.tsx` | iPhone | Sim (17 Pro) | yes (notch) | COMPLETE |
| SEP24-032 | Shared vs platform decisions documented | Table below | this file | both | n/a | no | COMPLETE |
| SEP24-033 | Database correctness (text switch hits the right DB) | See SEP24-015; `textHasBookOrKjv` fixed for KJVA | `passageDestinations.ts` | both | Unit tests | no | COMPLETE |
| SEP24-034 | macOS: Lexicon side panel shows selected verses in Strong's mode unless an entry is open | `SelectedVersesStrongs`; opened entry wins; Back returns to the verses | `SelectedVersesStrongs.tsx`, `BibleRightPanel.tsx` | macOS | Unit test; desktop build | n/a | COMPLETE (manual pass) |
| SEP24-035 | macOS: selection action bar as a rounded glass pill | `.material-floating-bar` capsule | `VerseSelectionBar.tsx`, `global.css` | macOS | Desktop build | n/a | COMPLETE (manual pass) |
| SEP24-036 | Tests and builds | Typecheck PASS; vitest 201 files / 4315 tests PASS; desktop build PASS; iOS build PASS; no probe code in the normal build | — | both | yes | — | COMPLETE |
| SEP24-037 | Docs updated | This ledger; `ios-design-system.md`; `mobile-navigation.md`; `design-system.md` (macOS) | docs | both | — | — | COMPLETE |

## Destination map (user goal → where it lives)

| Goal | Path |
|---|---|
| Read a passage | Scripture tab |
| Jump to a passage | Scripture header title → picker, or caret location field |
| Go back to where I was | Caret ‹ › (this tab's history) |
| Switch KJV ⇄ LXX | Caret tile |
| Compare texts | Caret → Compare with the Septuagint/KJV, or All Translations |
| Find a word in this book | Caret → Find on Page |
| Show Strong's | Caret tile; tap a number → Strong's sheet |
| Change text size / font / theme | Caret → Display (inline disclosure) |
| Verse actions (note, highlight, copy, tag) | Tap a verse → verse sheet |
| Search everything | Plus → type, or Search tab |
| Act on a search result without opening it | Long-press the result |
| Write a note | Plus → Note, or Notes caret → New note |
| Today's note | Plus → Today, or Notes caret → Today |
| Find a note | Notes caret location field → note finder |
| Group / sort notes | Notes caret → View |
| Look up a Strong's number | Plus → type the number → Lexicon |
| Switch tabs | Tab cards (bottom left) |
| Sessions / archive | Tab cards sheet → session / archive buttons |
| History | Plus → History, or More |
| Settings | Plus → Settings, or More |

## Gesture ownership

| Gesture | Owner |
|---|---|
| Horizontal swipe / edge tap on text | Chapter pager (paged mode) |
| Left-edge swipe | iOS back — not captured by the reader |
| Vertical scroll | Reader (continuous: chapter stream) |
| Tap on verse | Verse sheet; long-press = native text selection |
| Drag on sheet grabber / body at scroll-top | Sheet detents |
| Long-press on search result | Result menu (no text callout) |
| Long-press on tab card | Card drag / reorder |

## Shared vs platform-specific decisions

- **Shared:** passage resolver (`passageDestinations.ts`), per-tab history (`tabNavStacks`),
  continuous scroll (`ContinuousChapterScroll`), note grouping, search result action specs.
- **iPhone only:** caret layout, Find on Page bar, picker UI, compact header, materials, action
  sheet look, removal of the study-trail arrival prompt (it stays on macOS).
- **macOS only:** Lexicon selected-verses view, glass selection bar.

## Architecture notes

- **History:** the caret's back/forward reuse the desktop's per-tab navigation stacks — no second
  history system.
- **Sheets:** in-sheet navigation uses CSS keyframe transitions (they can't be left half-done);
  detents are per sheet; a sub-view keeps the current detent.
- **Screenshots:** see SEP24-013.

## Physical-device pass
1. Scroll a chapter down: the passage pill joins the island / notch; the status area stays one colour.
2. Fling fast through continuous scroll, both directions: never a blank screen.
3. Open the picker: drag between the three detents; search "Matthew 10 LXX".
4. Caret: ‹ › after a jump; Display expands in place; Find on Page with the keyboard up.
5. Long-press a search result: menu appears without selecting text.
6. Turn on Reduce Transparency: sheets and bars go opaque.
