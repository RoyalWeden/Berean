# CC-02 — Collapsible Search result groups (Claude Code, 2026-11-26)

- **Branch:** `native/claude-search-groups-20261126`, **stacked on CC-01** (`a90d788c`, `native/claude-search-order-20261126`). It shares `ScriptureSearchView.swift` with CC-01, so integrate CC-01 first.
- **Changed files:** `apple/Shared/ScriptureSearchView.swift` (only), plus this report.

## Behaviour

Ported from the original `collapsedGroups` (`ScriptureSearchView.tsx` 450, 925–950, 1837–1856).

- **Header:** each group header is a whole-row button showing title, count and a chevron (down when open, right when collapsed). Clicking or tapping toggles the group.
  - Mac: hand cursor and help text "Hide/Show <group>".
  - VoiceOver: "<group>, N results", value Expanded/Collapsed, header trait.
- **Collapsed groups:** keep their header and count, and drop their rows from the list. The total ("19 results") and the edition chips are unchanged.
- **Unaffected:**
  - "No groups" never collapses.
  - The Jump to menu still lists every group and scrolls to its header.
  - Order, text/book grouping and all editions are unaffected.
- **Where the state lives:**
  - `@SceneStorage` per tab (`berean.search.collapsedGroups.<tabId>`), so it is device-local and survives a result round trip.
  - It stores **one** search fingerprint (`ScriptureSearchScrollContext.persistenceKey`, covering query, options, texts, mode, books, tags, context and replacer) plus the collapsed titles.
  - Another query or option set therefore starts fully expanded, and returning to the stored fingerprint brings its collapse state back.
  - No tab state, schema or sync change; opaque `filters` are untouched.
- **Restoration:**
  - **Result return:** if the row a result return is coming back to is in a collapsed group, that group is drawn open, so restoration lands on the real verse and never on an unrelated row.
  - **Collapsing the group that holds a pending return:** ends that return.
  - **Collapsing the group that holds the saved position:** the position is re-saved as the group's header (`group:<title>`), an explicit header fallback.

**Correction during testing:** the first version kept collapse state in `@State`. A result → Back round trip remounted the view and silently re-expanded the groups. Moved to per-tab `@SceneStorage`; `AppModel` was not used because it is Codex-reserved.

## Checks actually run

- **Builds:** `npm run native:build:ios` and `npm run native:build:mac` both PASS on the final source.
- **iPhone, real taps on Claude's simulator E8B01B22, "voice of joy"** (KJV + Apocrypha 10 / Septuagint 8 / T. Jacob 1). States were read from the accessibility tree.
  - Collapse KJV + Apocrypha: its rows were hidden, the header kept "10" with ›, and the total stayed 19.
  - Open LXX Isaiah 48:20 → More → Back: returned to Isaiah 48:20 with KJV + Apocrypha **still Collapsed** and LXX Expanded.
  - Order → Revelation → Genesis (new fingerprint): KJV + Apocrypha Expanded.
  - Reset Options (default fingerprint): KJV + Apocrypha Collapsed again.
  - Left expanded afterwards.
- **Mac, Claude's QA instance** (AX only):
  - Before: all three headers Expanded.
  - Pressing "KJV + Apocrypha" → Collapsed; the screenshot shows "KJV + Apocrypha 10 ›" with LXX and T. Jacob open.
  - Re-expanded, quit, and the test Search tab soft-deleted.

## Not verified / open

- **The "result return into a collapsed group" path:** source-reasoned. A pending return keeps its group open, and collapsing that group clears the return. A normal UI sequence can't put a pending return inside an already-collapsed group, because you can't collapse while the reader is showing.
- Manual scroll replacement after collapsing (the header fallback is written; not observed through a relaunch).
- Keyboard navigation of collapsed groups (native Search has no row-focus keyboard model to skip rows).
- VoiceOver speech (label/value/trait set and read from the tree, not listened to).
- Collapse state survives relaunch only as far as SwiftUI scene restoration goes. The rest of Search's options don't survive relaunch at all (pre-existing; see the CC-01 report).
