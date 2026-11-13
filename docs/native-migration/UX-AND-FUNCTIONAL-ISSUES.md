# UX and functional issue register (native apps)

Stable IDs; issues are never deleted — fixed ones stay with their evidence.

**Severity.** P0 crash, data loss or sync corruption · P1 major missing or broken workflow · P2 usability or incomplete · P3 polish.

**Status.** OPEN · IN PROGRESS · FIXED (verified how, where) · WONTFIX (reason).

Each row gives: issue (expected vs actual, how to reproduce) · platform · severity · feature · status / evidence / commit.

## Open

| ID | Issue | Plat | Sev | Feature | Status |
|---|---|---|---|---|---|
| SHARED-FUNC-006 | Study Trail missing entirely. | both | P1 | U14 | OPEN |
| SHARED-DATA-001 | No native sync; native libraries are isolated dev copies (by design until the M4 gates). | both | P1 | A01 | OPEN (gated, OD-5) |
| IOS-FUNC-002 | iPhone reader: no cross-verse text selection (per-verse rows). | iOS | P2 | S07 | OPEN |
| MAC-UI-008 | Strong's search results do not highlight the matched words (the occurrence word indices are available). | both | P3 | Q03 | OPEN |
| MAC-UI-009 | Strong's hover gloss tooltip (original: word, transliteration, short definition) missing; click works. | Mac | P2 | S05 | OPEN |
| SHARED-FUNC-010 | Verse actions lack Play Audio From Here (Copy Reference and Compare This Verse added). | both | P3 | S08 | OPEN (waits for Read Aloud) |
| SHARED-FUNC-011 | Notes editor: tables as source text, images as captions, columns/threads without chrome (ADR-0014 limits). | both | P2 | N04/N05 | OPEN |
| SHARED-FUNC-012 | No global History screen (original History tab/sheet). | both | P2 | S10 | OPEN |
| MAC-FUNC-013 | No calendar on Mac (⌘⇧D Today's Note now exists). | Mac | P2 | N12 | OPEN (partly fixed) |
| SHARED-FUNC-014 | Settings missing sections: Texts, Shortcuts, About, Notes, Hermas translation, verse-number and red-letter toggles. | both | P2 | U12/S11 | OPEN |
| MAC-UI-015 | Sidebar drag: no drop line and no auto-scroll near the edges; no pinned-tab grid; no density setting. | Mac | P2 | U02 | OPEN |
| SHARED-FUNC-016 | Tag manager / tag graph missing (tags can be created, applied, searched and removed per member). | both | P2 | U16 | OPEN |
| MAC-FUNC-017 | Single window only: no floating tabs, presenter or secondary windows. | Mac | P2 | U07 | OPEN |
| SHARED-FUNC-018 | PDFs, YouTube, Read Aloud, Ask Berean not ported. | both | P2 | U17/M01/M05/G01 | OPEN |
| SHARED-FUNC-019 | Deep links (`berean://`) not handled natively. | both | P2 | A06 | OPEN |
| IOS-FUNC-004 | iPhone New sheet has no notes results (Mac ⌘K does). | iOS | P2 | Q09 | OPEN |
| SHARED-UI-020 | Accessibility: no full VoiceOver pass; dark mode checked only on the reader, search and sidebar. | both | P2 | A14 | OPEN |

## Fixed

| ID | Issue | Plat | Sev | Fix and evidence |
|---|---|---|---|---|
| MAC-FUNC-001 | Note Share / Export did nothing (SwiftUI fileExporter never presented; sandbox lacked user-selected file access). | Mac | P1 | Native NSSavePanel + entitlement; `npm run native:ui:smoke` PASS; PR #22 (26a3835) |
| MAC-FUNC-002 | An open note did not refresh after import. | Mac | P2 | Reloads on `notesRevision` unless editing; PR #22 |
| SHARED-DATA-002 | textId `lxx` served from `lxx.db` instead of `lxx_brenton.db` (the existing app's mapping). | both | P1 | `Corpora.files`; PR #23 (04db467) |
| MAC-FUNC-020 | Reader crashed when restoring an empty selection after a chapter change (NSSelectionArray empty). | Mac | P0 | Restore a zero-length selection instead; PR #23 |
| MAC-FUNC-021 | Right-clicking verse text showed the system text menu, hiding the verse actions. | Mac | P1 | Verse number / row menu; PR #23 |
| IOS-FUNC-003 | iPhone Plus opened a clipped 520-pt palette with no buttons. | iOS | P1 | NewSheet; real taps in Simulator; PR #23 (35b48b6) |
| MAC-UI-001 | Sidebar button blocked by a full-height window-drag area. | Mac | P1 | Drag area below the title bar only; verified; PR #23 |
| SHARED-FUNC-022 | **Single-chapter books showed no chapter to pick** (owner report 2026-11-12); Sirach / 1 Clement prologue (chapter 0) unreachable; last chapter dropped. | both | P1 | Chapter lists from real chapters; single-chapter books open directly; stepping over real chapters; all-books test over 19 texts; verified Philemon / Jude 5 / Sirach 0 in the running app; PR #23 |
| SHARED-FUNC-023 | Bare book names and "Jude 5" did not resolve (also absent in the original parser). | both | P2 | PassageResolver; verified "jude 5" → Jude 1:5; PR #23 |
| MAC-UI-024 | Switching to a passage with the same verse count kept the old scroll position. | Mac | P2 | Scroll kept only within one passage; verified; PR #23 |
| SHARED-FUNC-025 | **Clicking a verse number opened a menu instead of selecting the verse** (owner report). | both | P1 | Click toggles selection, ⇧-click range, selection bar, ⌘C copies verses, Esc clears; right-click opens actions; verified John 3:14–16 (Mac); PR #23 (a07ae1d) |
| MAC-UI-026 | **Back / Forward not in the sidebar** (owner report). | Mac | P2 | [sidebar ‹ ›] group in the sidebar title bar, same place when collapsed; verified both states; PR #23 |
| SHARED-SEARCH-001 | **Search limited to one text, no scope control, no Strong's queries, weak options** (owner report). | both | P1 | ScriptureSearchView + ScriptureSearch engine: All Texts default, scope menu, per-text counts, options, Strong's, phrase, history; verified "watchers" (22 results, 4 texts) and G5485 (284); 6 engine tests; PR #23 (d3e9342) |
| SHARED-SEARCH-002 | Strong's bridge and Strong's search missed most occurrences of common numbers (the 1000-row, book-id-ordered cap also exists in the original). | both | P2 | Search uses uncapped occurrences; tests (Ps 23:1 via Yehovah; Gen 1:1 for H7225 + H430) |
| MAC-FUNC-003 | ⌘K did not find notes. | Mac | P1 | Grouped palette: Recent · Go to · Lexicon · Search · Notes · Commands, with ↑/↓ and Return; verified "grace" listing 2 notes; PR #23. (The iPhone uses New, which has no notes group yet; tracked below as IOS-FUNC-004.) |
| MAC-FUNC-004 | No find in chapter. | Mac | P1 | ⌘F find bar with match count and next/previous, ⌘G; verified "world" (5 matches) in John 3; PR #23 |
| MAC-FUNC-007 | Notes home was a filtered list only. | both | P1 | Folders home (All Notes, system folders, folder tree with counts, Trash, Recently Edited) · folder view (subfolders, Pinned, recency sections, sort, group by status / folder / type) · previews · row menu (pin, move, status, duplicate, export, trash) · folder menu (new subfolder, rename, move, delete keeping or trashing notes) · Trash (restore, delete permanently, empty). Services tested. Verified on the Mac (create folder, move note, open folder, note → back to its folder) and on the iPhone (home renders); PR #23 (9b69814) |
| IOS-FUNC-005 | New sheet stayed open after Return (`dismiss()` ineffective after navigation). | iOS | P1 | Closes through the presenter's binding; verified "obadiah" → Obadiah 1 with the sheet closed (Simulator); PR #23 |
| IOS-UI-006 | The verse selection bar overlapped the bottom bar. | iOS | P2 | Raised 72 pt on iPhone; PR #23 |
| MAC-FUNC-005 | No highlight from a partial text selection. | Mac | P1 | Context menu → Highlight Selection ▸ colour; selection split per verse, display offsets → stored offsets (OffsetMap) → character highlight. Verified John 3:16: stored 50–69 = "begotten Son, that", the shown words; PR #23. (iPhone partial selection waits for IOS-FUNC-002.) |
| IOS-FUNC-001 | iPhone reader had no swipe chapter change. | iOS | P1 | Horizontal swipe (> 90 pt, mostly horizontal, not from the very edge) → next / previous chapter over real chapters and books. Verified in the Simulator: Obadiah 1 → Jonah 1 → Obadiah 1, and vertical scroll unaffected; PR #23. Edge-tap paging not added (the system back gesture owns the edge). |
| MAC-FUNC-027 | Found by exploratory testing: single-digit verse numbers were nearly impossible to click — the tap landed on the gutter tab before the right-aligned number. | Mac | P1 | The whole gutter (both tabs and the number) is the verse-number target; verified that a click on "3" selects it and ⌘C copies "John 3:3 …"; PR #23 |
| MAC-FUNC-028 | Found by exploratory testing: app shortcuts such as ⌘⇧D did nothing while the reader had focus (NSTextView swallowed them). | Mac | P1 | The reader passes unhandled key equivalents to the menus; verified ⌘⇧D → today's note `daily-2026-11-12` (the existing app's id format); PR #23 |
