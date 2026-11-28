# CC-01 — Search order in both directions (Claude Code, 2026-11-26)

Branch `native/claude-search-order-20261126` (worktree `/Users/roywe/Documents/ChatGPT/Berean/claude-worktrees/search-order`), fast-forwarded from b4db91b8 to 7b7631b8 before the change. One source file changed.

## Changed files

- `apple/Shared/ScriptureSearchView.swift` — the only source change.
- `docs/native-migration/CLAUDE-CC-01-REPORT.md` — this report.

No AppModel, Compare, reader, Notes, Presenter, Messages, SearchViewport, schema, sync allowlist or test changes.

## What changed and why

The original desktop Search has Sort By (Relevance / Book Order) plus a direction (`ScriptureSearchView.tsx` 872–897, menu 1283–1297). Reverse flips the group order **and** each group's verses. Native offered only Scripture order and Best match first.

- **Order picker:** now four choices, matching the original's labels:
  - Genesis → Revelation (`bookOrder`, still the default)
  - Revelation → Genesis (`bookOrderReverse`)
  - Best match first (`relevance`)
  - Best match last (`relevanceLast`)
- **Why the direction lives in the existing native `sort` field, not a new key:**
  - `SearchViewports.configurationFields` and the native search-history snapshot already include `sort`. Every order therefore gets its own viewport fingerprint and history snapshot, with no contract change.
  - A new key would have changed the configuration fingerprint of every existing Search tab, dropping saved positions once.
  - `sort` is native-only. The original uses `sortMode`, and the Capacitor app uses `filters.sort` + `filters.direction`. Neither reads the native field.
  - An older native build reading the new values treats them as Best match, which is harmless.
- **Reset Options:** already removes `sort`, so it restores Genesis → Revelation.
- **`hasActiveOptions`:** already flags any non-default `sort`.
- **Reversal is applied in `groups`:** the groups are built in forward order, then the group list and each group's verses are reversed, exactly like the original. The Jump to menu, row navigation and the empty state read the same `groups` / `shown`.
  - My first attempt reversed the flat list. That was not a strict mirror under By book: a book present in two editions (Baruch, Judith, Jeremiah…) took its group position from the other edition's first verse. Corrected and re-verified.
- **Hit text is not modified:** copied text, filters, counts, scope and the scope callback are untouched. The `set()` path is unchanged, and nothing reads computed state inside `app.update`.

## Checks actually run

- **Builds:** `npm run native:build:ios` and `npm run native:build:mac` both PASS on the final source.
  - The worktree needed `data/*.db`. I added them as APFS clones (`cp -c`) from `/Users/roywe/Berean/data`, untracked.
  - The first Mac build preceded the `groups` correction. The final Mac build and every result below are from the final source.
- **iPhone, real taps on Claude's simulator E8B01B22 (`com.berean.native.ios.dev`), query "voice of joy", all texts:** 19 results (KJVA 10, LXX 8, T. Jacob 1) in every order.

  | Order (grouping) | First | Last | Group order |
  |---|---|---|---|
  | Genesis → Revelation (by text) | 1 Chronicles 15:16 (KJVA) | — | — |
  | Revelation → Genesis (by text) | Testament of Jacob 8:5 | 1 Chronicles 15:16 | T. Jacob → LXX → KJVA |
  | Best match first | Isaiah 65:19 (KJVA group) | — | — |
  | Best match last | Testament of Jacob group | Isaiah 65:19 | — |

  - Reset Options restored Genesis → Revelation and hid the Reset button.
  - Revelation → Genesis reopened at that order's own saved position, not the forward list's.
  - Opening a result (Isaiah 51:3), then More → Back, returned to Search still in Revelation → Genesis with that row visible.
- **Mac, isolated QA instance** (`--qa-library --qa-profile claude-20261120`). Driven only by AX actions and keys sent to that PID; no coordinate clicks. PID 2506 (another checkout) was left untouched.
  - By text: Revelation → Genesis showed T. Jacob → LXX (Baruch 2:23 … 1 Chronicles 15:16) → KJVA.
  - By book, group headers read through AX:

  | Order | Group headers |
  |---|---|
  | Genesis → Revelation | 1 Chronicles 2, Ezra 2, Psalms 1, Isaiah 3, Jeremiah 4, Luke 1, John 1, Judith 2, Baruch 2, Testament of Jacob 1 |
  | Revelation → Genesis | the exact reverse, same counts |
  | Best match first | Isaiah 3, Baruch 2, Judith 2, Luke 1, Jeremiah 4, John 1, 1 Chronicles 2, Psalms 1, Ezra 2, Testament of Jacob 1 |
  | Best match last | the exact reverse, same counts |

  - Reset Options returned to By text, Genesis → Revelation.
- **Cleanup:**
  - The test Search tab in Claude's Mac QA library was soft-deleted (`deleted_at`) after the instance quit.
  - Simulator: the Isaiah 51 reader was toggled KJVA → LXX → KJVA (my mis-tap), then stepped back through history. The search tab stays, with default options after relaunch.
  - E8B now runs this branch's build.
  - No production data, no D0CC, no physical phone.

## Found while testing (pre-existing, not changed here)

**Search options don't survive relaunch.** `TabFields.sync[.search]` persists only `query`, and `.local` only `scrollTop/results/scope/filters/preview`. Order, grouping, scope texts, match mode, testament and books therefore reset on relaunch (observed: the row held only `{"query":"voice of joy"}`). Fixing it means extending the shared split contract, which mirrors the original `splitTabState`. That is Codex's call; I did not change it.

## Not verified / remaining

- VoiceOver reading of the four picker items.
- Mac Back/Forward between two Search visits with different orders. The iPhone result→Back round trip passed.
- Ungrouped (No groups) reverse was not run on screen. It follows from the same `groups` path, a single group with its verses reversed.
- No new automated test. The order logic is private view code, and the queue brief says not to mirror it in a test.
- CC-02 (collapsible groups) not started. It shares this file, so it should start after Codex integrates CC-01.
