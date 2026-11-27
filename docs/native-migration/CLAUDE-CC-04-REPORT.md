# CC-04 — Messages folder rename/delete and reply-quote jump (Claude Code, 2026-11-26)

- **Branch:** `native/claude-chat-folders-20261126`, worktree `/Users/roywe/Berean-native-cc04`, based on `1dcafcaa`.
- **Scope:** implements CC-03 issues #1 and #2 ([CC-03 report](CLAUDE-CC-03-REPORT.md)). The queue's Codex ownership check was still pending, so it is built on an isolated branch and nothing is integrated. Neither file is on Codex's reserved list.

## Changed files

- `Packages/BereanKit/Sources/BereanNotes/ChatsService.swift` — new `renameFolder(_:to:)`.
- `Packages/BereanKit/Tests/BereanConformanceTests/ChatsServiceTests.swift` — new `renameAndRemoveFolderMoveEveryConversation`.
- `apple/Shared/ChatViews.swift` — folder actions, error reporting, reply-quote jump.

## Behaviour

- **`ChatsService.renameFolder(from, to:)`** ports the original `aiChats.renameFolder` (`aiChatsService.ts` 403–414):
  - Uses the same `cleanFolder` normalisation.
  - A blank name is refused and returns `nil`, with no writes.
  - `to: nil` unfiles every conversation in the folder.
  - Each moved row gets the same `updated_at` and an `upsert` change event.
  - All rows move in one `BEGIN IMMEDIATE` transaction, rolled back on error.
  - No schema or sync change.
- **Rename Folder… / Delete Folder…** (original `ChatHistoryList.tsx` 423–460):
  - Available in each folder section header's context menu, which works on Mac.
  - Also in a conversation's Folder submenu for its current folder. This is the reliable route on iPhone, because a long-press on an inset-grouped section header doesn't open its menu.
  - The rename prompt says every conversation moves with it.
  - The delete confirmation says "Its conversations stay, unfiled."
- **Errors are reported, not dropped:** pin, rename, move, folder rename/delete and conversation delete in the Messages sidebar now go through `attempt(…)`, which shows "Couldn't Update Messages" with the store's plain-language error. These were `try?`. A failed conversation delete no longer clears the selection.
- **Reply quote → original** (`ChatReplyQuote.tsx`, `ChatMessageRow.tsx` 235):
  - When the parent exists, the quote is a plain button: "Show the original message", with a VoiceOver label and hint.
  - It scrolls the thread to the original, centred, through a `ScrollViewReader`, then tints the row for about 1.6 s.
  - Reduce Motion scrolls without animation.
  - If a message search hides the original, the search is cleared first.
  - A deleted original stays a static "Original message deleted" label.

## Checks actually run

- **Tests:** `swift test -c release` full package, **391 PASS** (387 conformance in 95 suites + 4 core). That is Codex's 390 plus the new folder test.
- **Builds:** `npm run native:build:ios` and `npm run native:build:mac` both PASS. The worktree uses APFS-cloned `data/*.db`, untracked.
- **iPhone, real taps on Claude's simulator E8B01B22,** with fixtures `qa-chat-a` ("QA Feasts": original + 24 fillers + reply) and `qa-chat-b`, both in "QA Torah":
  - All Messages: tapping the reply's quote jumped 24 messages up to the original, centred and tinted.
  - Long-press QA Feasts → Folder showed New Folder… / Remove from Folder / Rename Folder… / Delete Folder….
  - Rename to "QA Torah Study" moved both conversations; the section header and times updated.
  - Delete Folder → confirm left both under Conversations.
  - Long-press on the section header itself did not open a menu on iPhone, as recorded above.
- **Mac, Claude's QA instance** (`--qa-library --qa-profile claude-20261120`), driven only by AX and PID-scoped actions:
  - The folder header (AXHeading) menu listed Rename Folder… / Delete Folder….
  - Rename through it moved both rows in the database.
  - The quote's AX button tinted the original.
  - Delete Folder unfiled both rows.
- **Cleanup:**
  - Fixtures deleted from both libraries: iPhone back to 3 chats, Mac QA back to 0.
  - My Mac instance quit. PID 2506 (another checkout) and D0CC were untouched. No production data.

## Not verified / open

- The failure alert was not triggered at runtime. It needs a locked or read-only store, as in the earlier U18 check.
- VoiceOver speech for the quote button (label and hint set, not listened to).
- Mac header menu by real right-click (exercised with AXShowMenu).
- Very long folders and conflicting names. Renaming onto an existing folder merges into it, as in the original.
