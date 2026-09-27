# Search Berean and the navigation contract

Permanent architecture for both apps (2026-09-27). Ledger: [mobile/testing-backlog-2026-09-27.md](mobile/testing-backlog-2026-09-27.md).
Related: [ux-principles.md](ux-principles.md) §2 (current tab vs new tab), [mobile/mobile-navigation.md](mobile/mobile-navigation.md).

## 1. What was wrong

**"Things that should just change this tab create a new tab."** Every store helper that opens
something — `navigateToVerse`, `requestOpenNote` + `ensureTab('note')`, `openLexiconEntry`,
`openSearchTab`, `openYouTubeVideo`, `ensureTab` — targets *the active tab of the destination's
SPACE, else a new one*. That is the desktop's model (one active tab per sidebar space). On the
iPhone the current tab is simply the tab on screen, so whenever the destination's type differed from
it, the helper silently switched to a DIFFERENT tab of that type — or created one:

| Pathway (iPhone) | Before | Now |
|---|---|---|
| Search tab → tap a verse / note / "Open in Lexicon" | jumped to the Scripture / Notes / Lexicon space's tab (or a new one) | the Search tab becomes it; ‹ returns to the results |
| Caret search in a Scripture tab → "Search …" | switched to (or created) a Search tab | results in the caret sheet; "All N verses" turns THIS tab into Search |
| Note → tap a verse link | `ensureTab('bible')` → another Scripture tab (or a new one) | the note tab becomes Scripture with the "← note" pill; ‹ returns |
| Strong's sheet (over Notes / Search / Lexicon) → occurrence, "Open in Lexicon" | the Scripture / Lexicon space's tab | the tab under the sheet |
| Verse sheet / selection bar → "Open in Notes" | `ensureTab('note')` → the Notes space's tab | this tab becomes the note; ‹ returns to the passage |
| History tab / History sheet → an entry | the entry space's active tab | this tab |
| Search result long press → "Add note" | the Notes space's tab | this tab |
| Study Trail page → a stop | `ensureTab` of that space | the tab under the page ("new tab" gesture → new tab) |
| Lexicon caret → "In Scripture" | `openSearchTab` → a Search tab | this tab becomes Search |
| Plus → Recent place | the space's active tab (changed the tab behind the plus) | a new tab (the plus is "new") |

Search had the parallel problem: each surface searched only its tab's kind of content (Scripture:
passages + "Search …" hand-off; Notes: a notes-only finder; the Search tab: one scope at a time,
Scripture by default), and the plus offered destinations but never results.

## 2. The contract (`src/lib/navigation/destination.ts`)

A **Destination** says WHAT; a **NavIntent** says WHERE. Every call site passes both —
`openDestination(destination, intent)`.

| Destination | Tab type |
|---|---|
| `passage` (book, chapter, verse, endVerse, textId, find-highlight, noteBack) | Scripture |
| `note` (noteId) | Note |
| `strongs` (num) | Lexicon |
| `search` (query, scope, filters) | Search |
| `video` (videoId, startTime) | YouTube |

| Intent | Meaning |
|---|---|
| **current-tab** | Change the tab on screen. Same type → navigate it (its own history step). Different type → the tab itself changes type (`transformTab`: same slot, history carried, ‹ returns). Creates a tab only when no tab exists at all. |
| **new-tab** | Create one tab and arrive in it. |
| **existing-tab** | The destination space's active tab, else a new one — the desktop model and external entry points, unchanged. |
| **sheet / overlay** | Presentations, not tab operations: a sheet or overlay never touches tabs until the user picks a destination inside it, and then uses the intent of the surface that presented it. |

Rules:
- PLUS = new. CARET = this tab. A result / reference / link tapped inside a tab = this tab.
  "Open in New Tab" (long press), Duplicate and the plus are the only new-tab actions.
- History: a current-tab navigation is a step of that tab's history; a new tab starts its own; an
  overlay (Calendar overlay, search sheet) records nothing; a sheet records nothing unless the user
  navigates from it. Duplicated tabs copy the history and then diverge independently.
- History / Settings are singletons in practice: More / "All History" / "More colours" reuse the
  existing one (existing-tab), by design.

## 3. Search Berean — one search system

```
Desktop Floating Search ─┐                 iPhone plus (new-tab) ─┐
                         │                 iPhone caret (current) ─┼─ SearchSurface (src/mobile/search)
                         │                 iPhone Search tab "All" ┘        │
                         ▼                                                  ▼
          searchIntent.ts  — deterministic parser (shared; desktop's source prefixes live here)
                         ▼
          unifiedSearch.ts — grouped results: Go to · Verses · Lexicon · Notes
                         ▼
     scriptureSearch.ts / strongsSearch.ts / notes.searchNotes / lexicon.search  (shared services)
                         ▼
          Destination → openDestination(dest, intent)
```

- **Sources:** every bundled text (`SEARCHABLE_TEXT_IDS`: KJV + Apocrypha, LXX, 1 Enoch, Jubilees,
  Hermas, Barnabas, Asc. Isaiah, Recognitions, T12P, 1 Clement, 2 Baruch …), Strong's Hebrew and
  Greek, and notes.
- **The tab type never narrows a search.** Its only influence is context: a bare "10" means a
  chapter of the current book, and a passage prefers the current text.
- **Scope:** All (default everywhere) · Scripture · Strong's · Notes. **Filters:** text (All texts
  or one), individual books, match (all words · any word · exact phrase). The Search tab keeps its
  existing verse-tag filter and sort as well.
- **Query understanding (deterministic):** "Matthew 10", "Matthew 10 LXX", "jubilees 23", "1 enoch",
  "lxx" → Go to. "Matthew", "zechariah" → the book as a Go-to, plus a word search. "H430", "G26 H430",
  "strong 430" → Strong's (only numbers that exist). "lxx love", "enoch: watchers", "love lxx" → words
  in that text. Quoted text → exact phrase. "notes", "my notes …" → notes only. Anything else →
  words everywhere. Case never matters, and the text is never re-capitalized.
- **Results:** the desktop's groups, order and source badges as iPhone inset-grouped rows, with
  highlighted snippets and "All N …" (the full list in a Search tab). Search as you type, debounced.
  Loading, empty and error states. Long press → the other intent (Open in New Tab / Open in This Tab).
- **History:** one list of recent searches (`recentSearchQueries`) for every entry point, clearable.
  Search tabs also keep per-tab ‹ › steps (query / scope / filters).
- **State:** the sheet's query, scope and filters live in a small store, so the Filters sub-view,
  the keyboard and result updates never lose the query. The query resets for each new sheet; scope
  and filters persist for the session.

## 4. Desktop relationship

The desktop's Floating Search is the reference (groups Go to · Verses · Lexicon · Notes ·
YouTube · Commands, source prefixes, search as you type). Now shared with the iPhone:
- the source-prefix parser (`detectTranslationPrefix` + its table, moved to `searchIntent.ts`
  unchanged);
- every search service;
- the destination model (`existing-tab`, which the desktop keeps).

Its UI and result providers are unchanged (no regression).

Platform limitation: the iPhone surface has no Commands, Cross-reference or YouTube groups (those
live in the caret, the verse sheet and the YouTube tab). The desktop's in-panel `⌘⇧F` advanced
search maps to the iPhone Search tab.

## 5. Audit — every pathway

| Action | Current | New | Existing | Sheet | Overlay | Notes |
|---|---|---|---|---|---|---|
| Plus → search result / Go to / "All N …" | | ✔ | | | | long press → current tab |
| Plus → experience row | | ✔ | | | | History / Settings: existing (singletons) |
| Plus → Recent place | | ✔ | | | | was existing-tab |
| Caret → search field (every tab type) | ✔ | | | ✔ (the search sheet) | | long press → new tab |
| Caret → Go-to row (experiences) | ✔ | | | | | `runExperience('current-tab')` → transformTab |
| Caret ‹ › | ✔ | | | | | per-tab history |
| Top-left tab-type switcher | ✔ | | | | Calendar | never creates a tab |
| Tab cards → a card | | | ✔ (switch) | ✔ | | |
| Tab cards → Duplicate | | ✔ | | | | history copied, then independent |
| Scripture: title → picker / swipe / edge tap | ✔ | | | ✔ (picker) | | |
| Verse sheet → Notes / Refs / Strong's / Copy | | | | ✔ | | nested views in the same sheet |
| Verse sheet → a cross reference | ✔ | | | | | |
| Verse sheet / selection bar → Open in Notes | ✔ | | | | | was existing-tab |
| Verse sheet → Compare this verse | ✔ | | | | | ‹ returns |
| Strong's sheet → occurrence / Open in Lexicon | ✔ | | | | | was existing-tab |
| Note → verse link / Strong's "Open in Lexicon" | ✔ | | | | | long press → Open in new tab |
| Note → wikilink to another note | ✔ | | | | | |
| Search tab → result, reference, Open in Lexicon, All-scope Go to | ✔ | | | | | was existing-tab |
| Search tab → Strong's row | | | | ✔ | | Strong's sheet |
| Search result long press → Open in New Tab | | ✔ | | | | |
| Search result long press → Add note | ✔ | | | | | the new note opens in this tab |
| History tab / History sheet → entry | ✔ | | | | | long press → new tab |
| Calendar overlay → day | ✔ | | | | ✔ | daily note in this tab |
| Calendar tab → day | ✔ | | | | | ‹ back to the month |
| Study Trail page → stop | ✔ | ✔ (new-tab gesture) | | | | |
| Lexicon caret → In Scripture | ✔ | | | | | was a Search tab |
| Tags → Manage (tags graph) | | | ✔ | | | singleton tags tab |
| Deep link, Spotlight, Siri / Shortcuts, Share Extension | | | ✔ | | | external: the space's tab (unchanged) |
| Desktop: everything | | | ✔ | | | per-space model unchanged |

## 6. Tests

`src/lib/navigation/__tests__/destination.test.ts` (contract, histories, duplication),
`src/lib/search/__tests__/searchIntent.test.ts`, `src/lib/search/__tests__/unifiedSearch.test.ts`,
`src/mobile/__tests__/searchSurface.test.tsx` (caret vs plus, global from Scripture / Notes,
filters keep the query, recent searches shared, capitalization not forced).
