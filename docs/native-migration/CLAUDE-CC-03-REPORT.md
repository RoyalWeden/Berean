# CC-03 — Presenter and Messages follow-through (read-only audit, Claude Code, 2026-11-26)

Source read at `48353f49` (`native/reader-notes`).
- **Original:** `src/components/viewer/*`, `src/types/viewer.ts`, `src/components/ailookup/*`, `src/platform/services/aiChatsService.ts`, `electron/ipc/aiLookup.ts`.
- **Native:** `apple/BereanMac/PresenterView.swift`, `apple/Shared/ChatViews.swift`, `Packages/BereanKit/Sources/BereanNotes/ChatsService.swift`.
- **Docs:** `PRESENTER-*`, `BEREAN-CHAT-2026-11-20.md`, parity rows U07/U18.
- No app or data edits; nothing launched.

**Excluded as already known or owned:**
- Presenter side panel (original `ViewerSidePanel`: note / lexicon / cross-references beside presented Scripture, toggled in `PresenterControls`). Already listed open in U07.
- Compare presentation. Codex owns Compare.
- Correction to U07: the original viewer has **no laser pointer**, so "Laser" in that row's open list looks stale.

## 1. Messages — folders can't be renamed or deleted (data workflow gap)

- **Original:** the folder context menu has Rename Folder… and Delete Folder… (`ChatHistoryList.tsx` 423–460). Both call `aiChats.renameFolder(from, to)` (`aiChatsService.ts` 403–414).
  - Every conversation in the folder moves to the new name.
  - `to: null` removes the folder and leaves its conversations unfiled.
  - Blank names are rejected, and the call reports the moved count.
- **Native:** per-conversation Folder ▸ move / New Folder… / Remove from Folder only (`ChatViews.swift` ~100–146). `ChatsService` has no folder-level operation. A misspelled folder can only be fixed by moving each conversation by hand.
- **Also:** `organize` calls there use `try?`, so a failed move closes the prompt silently. This is the same pattern the Nov 23 audit fixed for PDFs and Trails.
- **Reproduce:** put two conversations in folder "Torah"; there is no way to rename it to "Torah Study" or to delete it.
- **Packet:**
  - Add `ChatsService.renameFolder(from:to:) throws -> Int` as a transaction that ports `cleanFolder`: same trimming/limit, rejects blank, `nil` = unfile. Update `updated_at` per moved row, the same columns as the original. No schema change.
  - Add Rename Folder… and Delete Folder… (confirmation: "Its conversations stay, unfiled") to the folder row/section menu on both platforms.
  - Surface errors instead of `try?`.
  - Tests: rename moves all, null unfiles all, blank rejected, other folders untouched, `updated_at` advanced.
  - Files: `ChatsService.swift` + its test, `ChatViews.swift`.
  - Verify: Mac and iPhone rename and delete with two fixture conversations, then remove the fixtures.

## 2. Messages — a reply's quote can't take you to the original message

- **Original:** inside a bubble, `ChatReplyQuote` is a button. "Show the original message" scrolls to the quoted message (`ChatReplyQuote.tsx` 7–29, `ChatMessageRow.tsx` 235, `actions.jumpTo`). A deleted original reads as deleted and is not a button.
- **Native:** `bubble()` renders the quote as a static `Label` (`ChatViews.swift` ~314–317). It also has no accessibility hint, so VoiceOver can't reach the original either.
- **Reproduce:** reply to an older message, scroll away, tap the quote in the reply; nothing happens.
- **Packet:**
  - Make the quote a plain button (when the parent exists) that scrolls the transcript's existing `ScrollViewReader` to the parent's stable message target.
  - Then briefly highlight the parent row with a native flash or selection, respecting Reduce Motion.
  - Label: "Replying to …, Show the original message".
  - Files: `ChatViews.swift` only.
  - Verify: Mac and iPhone jump to an off-screen parent, a deleted parent stays static, and VoiceOver activates it.

## 3. Presenter — a presented note doesn't follow the main window's scrolling

- **Original:** the `{ kind: 'note', scrollPercent }` payload mirrors the main note editor's proportional scroll into the viewer (`ViewerApp.tsx` 48–63, `types/viewer.ts` 22). The audience sees the part of the note being read. The Bible side panel likewise carries `sidePanelScrollPercent`.
- **Native:** `.note` renders in a plain `ScrollView` (`PresenterView.swift` ~222–231) with no follow. Scripture follows the reader (`ScrollViewReader`, ~257–301); notes don't. Scrolling a long note in the main window leaves the Presenter at its top.
- **Reproduce:** open a long note, Window ▸ Show Presenter, scroll the note in the main window; the Presenter doesn't move.
- **Packet:**
  - Publish the active note editor's proportional scroll position (throttled) from the Mac note editor into an AppModel presentation value. Follow Scripture's existing pattern; don't persist it.
  - Apply it in `PresenterView`'s note branch, honouring Pause (the paused snapshot keeps its position, as Scripture does).
  - Files: `PresenterView.swift`, the Mac note editor's scroll observer (`RichNoteEditor.swift` / `NotesViews.swift`), and a small `AppModel` field.
  - Ownership: AppModel is Codex-reserved, so Codex must clear this before it is assigned.
  - Verify: follow, pause/resume, and note switching on the Mac.

## Recommendation for the next Claude implementation task

**#1 + #2 together as CC-04** (Messages), subject to Codex confirming ownership. Both are confined to `ChatViews.swift`, `ChatsService.swift` and its test. Neither touches Codex-reserved files, and both have exact original behaviour to port. #3 needs AppModel, so it should wait for Codex or be split.
