# Berean Chat — architecture notes (2026-10-18 redesign)

Short orientation for whoever touches Chat next. The code is the source of truth; this records the
decisions that aren't obvious from it.

## Surfaces
- **Mac panel** `src/components/ailookup/AiLookupPanel.tsx` — floating panel over the main window. One
  compact bar: the title is a conversation switcher (popover with `ChatHistoryList`), then New,
  Expand (opens the Chat window with the same conversation + draft), Close.
- **Mac window** `ChatWindowApp.tsx` (`?chat=1`) — sidebar (`ChatSidebar` → `ChatHistoryList`, date
  groups) + one centred column (transcript + composer, `--chat-column-max`). Sidebar visibility is
  remembered (localStorage `berean-chat-window-sidebar`); ⌃⌘S / ⌘⇧S toggle; below 640 px it becomes an
  overlay without changing the preference.
- **iPhone** `src/mobile/chat/ChatPage.tsx` inside `navigation/chatOverlay.tsx` — own NavigationStack
  (list → thread, edge swipe), same controller, rows and renderer as the Mac.
- Shared: `useChatController.ts` (one per surface), `ChatSurface`, `ChatTranscript`, `ChatMessageRow`,
  `AiReplyBody`, `ChatMarkdown`.

## Message format — Markdown stays canonical
`ai_chats.messages[].content` is Markdown (legacy rows are plain text, which is valid Markdown — no
migration). Search, previews (`plainChatText`), AI history and iCloud all read it as text.
- **Composer** (`composer/`): ProseMirror on the notes editor's `bereanSchema`, parsed with the notes
  `parseMarkdown` and serialized with its handlers (hard break = plain newline; unformatted text is
  stored exactly as typed). Chat-specific input rules are stricter than notes (no snake_case / URL /
  verse-ref false conversions).
- **Renderer** (`ChatMarkdown.tsx`, `chatMarkdownParse.ts`): its own markdown-it (html off, indented
  code and setext headings off) → React elements only (never innerHTML). Links: http(s)/mailto only.
  Images are never loaded (shown as links). Verse refs / Strong's linkified in text only, with a
  false-positive guard ("Song 2", "Is 1", "Am 3" don't link). Streaming text closes open fences.
- User notes with document structure (heading / table / code fence) render as a neutral card instead
  of an accent bubble.

## Organising (2026-10-18, schema v48)
- Pins and folders are two `ai_chats` columns, `pinned_at` (ISO) and `folder` (name), so they sync
  per field with the row. A folder exists while a conversation is in it; renaming moves every
  conversation, deleting only unfiles them. Lists: Pinned (newest pin first), Folders (A→Z), then
  the date groups — each conversation appears once (`organizeConversations`).
- All Messages / a day write to NO conversation by default: the reserved row `berean-unfiled`
  (fixed id, so every device converges on one row), never listed as a conversation. "To: …" above
  the composer picks a conversation instead; the choice resets when the view is left.
- The Mac message hover shows Reply · Copy · "…" (Ask Berean About This, Edit, Delete…); right-click
  has everything.

## Replies (2026-10-18)
A note or Ask Berean question can reply to an earlier message of the same conversation:
`inReplyTo: <message id>` on the message (optional/additive — an older client just shows the
message). The bubble shows a quote (who + one line, `quoteSnippet`) that scrolls to and flashes the
original; a deleted original reads "Original message deleted". Start a reply: Mac — the Reply hover
button or right-click → Reply (the full message menu: Reply / Copy / Ask Berean / Edit / Delete…);
iPhone — press and hold → popup menu → Reply, or swipe the message right (touch events; starts
within 28 px of the left edge stay the back-swipe). The composer shows "Replying to …" (× / Esc).
The reply target is kept per conversation, device-local (`composer/chatReplies.ts`, next to the
drafts, shared by the panel and the window). A question sent as a reply gives Ask Berean the quoted
message as its LAST history turn, marked "(the message I am replying to)", however old it is.

## Composer, search and find (2026-10-19)

- **Ask Berean mode** lives in the composer (accessory row, shown while ✦ is armed): Commentary,
  Deep Search, Passages Only (`chatModes.ts`). The request still carries the two original switches
  (`commentary`, `agentic`), sent exactly as stored; picking a mode sets both. Return with ✦ armed
  asks Berean (it used to need ⌘Return). No floating options panel.
- **This Tab** is a separate toggle (context, not a mode) that names what it sends ("John 3");
  unavailable when the tab has nothing readable; "this chapter" in the message still includes it.
- **Conversation selector** (`ChatConversationPicker`): searchable (titles + previews, summaries
  only — no message bodies loaded), New Conversation, Unfiled (All Messages / a day), recents,
  incremental "Show More". iPhone: a full "Send To" page. "No Conversation" is now shown as
  **Unfiled** (display only — the stored row title is replaced on read).
- **Remembered conversation**: the panel's last conversation is persisted per device
  (`aiLookupActiveChatId`, not synced — syncing would switch conversations under another device);
  deleted → the latest; an unsent draft in a new conversation keeps it new on reopen.
- **History**: All Messages with its days folded under it (counts labelled as messages), then
  collapsible date groups; month groups start collapsed (per-device state, `berean-chat-groups-v1`).
- **Global search** (⌥⌘F / sidebar field / iPhone list): All · Conversations · Messages, every match
  marked, no composer under it. Opening a message result opens its conversation with Find set to
  the query on that message (`openSearchResult` → `findRequest`).
- **Find in conversation** (⌘F on the Mac, … → Find in Conversation on iPhone): `chatFind.ts` matches
  the rendered text of message bodies (`[data-find-body]`, quotes of other messages skipped) and
  paints with the CSS Custom Highlight API — no DOM rewriting, queries are plain text. While open,
  the transcript renders every loaded row. WebKit paints no highlight on `user-select: none` text,
  so the iPhone transcript is selectable only while Find is open.
- **Scripture find bar**: `absolute` in its panel, 8px under the toolbar (it was `fixed`, which the
  Scripture pane's `container-type` re-anchored 50px too low). Enter in the floating search →
  find bar with no lost keys: see `src/lib/findHandoff.ts`.

## AI replies
The local model returns STRUCTURED results (`AiLookupResponse`), not free Markdown. `AiReplyBody`
presents them: prose summary → passages list (reference, Scripture in its own style, commentary in
normal text) → cross-refs (disclosure) → Strong's card → notes / videos → "Related Passages". AI text
is never rewritten. When the user asks Berean, the conversation's plain notes ride along as context
("(my note) …" turns) — a plain message alone never reaches the model.

## iCloud
Entity `ai_chat` (whole row) through the shared sync engine; `messages` merges as a union by message
id (sorted by instant — fixed 2026-10-18: it compared timestamp strings), title last-writer-wins.
Formatting travels inside `content`. Covered by `src/platform/sync/__tests__/aiChatSync*.test.ts`
(MemoryCloud — not a real two-device test).
- **Drafts are device-local by design** (`composer/chatDrafts.ts`, localStorage
  `berean-chat-drafts-v1`, per conversation, survive relaunch; the Mac panel and window share them). A
  half-typed draft jumping devices / conflicting is worse than Messages-style per-device drafts.
- The selected conversation is not synced (it would move you between contexts).

## Materials
Mac panel = one `material-panel`, popovers `material-popover` — CSS materials, not native Liquid
Glass. iPhone composer = CSS approximation as well. Native glass is only the iPhone shell controls.

## Visual QA
Mac: `BEREAN_QA_USER_DATA=<tmp dir> BEREAN_CDP_PORT=9223 npx electron-vite dev` runs a throwaway
instance with a fresh database (sync and vault export off) — never your Berean Dev data.
