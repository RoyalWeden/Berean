# Lane A — AI pipeline, IPC, chat UI, store, mobile (inferred from code, 2026-10-28)

## Benchmark claims vs code
- (a) Default Commentary ON — **holds**: src/store/index.ts:2069-2071 (commentary true, agentic false, tab false) → 'commentary' (chatModes.ts:27-29). Store `migrate` (3419) is identity; existing OFF users stay Passages Only.
- (b) OFF+Deep not selectable but sent if stored — **holds**: chatModeFlags('deep') forces commentary true (chatModes.ts:31-35); chatModeOf(false,true) displays 'deep' (28); ChatComposer.tsx:196 sends stored flags; caption chatModel.ts:227-233; emitPartial only when commentary (aiLookup.ts:3504).
- (c) Commentary gets no history — **holds**: commentaryPrompt aiLookup.ts:846-898 no history param (gets tab block + DB notes). Verification/critique/prune also no history. Only extractionPrompt (752) and buildEffectiveQuestion (491).
- (d) Main keeps last 6 — **holds**: aiLookup.ts:2509 slice(-6); renderer sends 8 (useChatController.ts:338 → chatModel.ts:51); budgetForExtraction (1034, called 2649) may drop more. Stale comment at 1016 ("4 turns").
- (e) Strong's after availability check — **holds**: check 2638-2640 → empty('ollama-unavailable'); extraction 2651-2656; Strong's detect/resolve 2673-2698 (incl. ids typed in the question). Notes ask 2555-2560, video ask 2565-2576, bare ref 2614-2620, QUOTE_TRIGGER 2627-2636 run before the check.
- (f) Only ollama-unavailable mapped — **holds**: useChatController.ts:359-361. 'ollama-request-failed' (2655) unmapped → "No matching verses found — try rephrasing." (or empty text + cards). IPC throw → "Something went wrong reaching Ask Berean." (366). No-candidates path (3124-3125) returns no error.

## Hazards
1. Literal "H2580" in extraction template (aiLookup.ts:811, 825); no check that the question is a word question before trusting strongsNum (2673). H2580 is real → passes verification.
2. Comments say notes never reach the model (useChatController.ts:17, 337; chatModel.ts:49-50) but aiHistoryFor sends "(my note) …" (chatModel.ts:56; asserted chatController.test.tsx:116).
3. Renderer type AiLookupResultSource (src/types/electron.d.ts:642) lacks 'semantic'.
4. notesAreThePrimaryAnswer computed (3416) and stored (useChatController.ts:46) but unused by AiReplyBody.
5. Stale comments: critiquePrompt "ALWAYS-ON" (1148) runs only under Deep (3377); references to AiLookupPanel.tsx call site; word-replacer rules come from ChatComposer.tsx:194.
6. iOS bridge exposes `commentary` member (bridgeExtras.ts:244) not in AiLookupAPI (cast).
7. No `think` option on any Ollama request.

## aiLookup.ts (3658 lines)
Exports: WordReplacerRuleLite 29, ResultSource 45, AiLookupResult 47, AiLookupResponse 66, AiLookupNoteResult 107, AiLookupVideoResult 115, AiLookupStrongsCard 130, AnswerKind 170, ChatHistoryTurn 173, stripQuotedSpans 267, detectFocusTextId 279, detectBookInQuestion 421, detectTestamentInQuestion 467, extractQuotedSpans 914, verifyGeneratedText 937, appendVerificationCaveat 974, AiLookupTabContextRef 992, CritiqueVerdict 1141, runCritique 1204, decideNotesAreLead 1238, searchTskeHeadingCandidates 1917, pickTopVotedNeighbors 1968, selectCrossRefAnchors 1992, expandCrossRefNeighbors 2009, mergeVideoSearchResults 2168, runLookup 2498, registerAiLookupHandlers 3583, re-export runOllamaText 3658.
Internals: extractionPrompt 752, commentaryPrompt 846, budgetForExtraction 1034, budgetCommentaryCandidates 1061, buildTabContextBlock 1075 (4000-char cap 1006), verificationPrompt 1115, critiquePrompt 1157, relevancePrunePrompt 1256, mergeAdjacent 1274, keywordOverlapScore 1385, scoreCandidates 1702, detectStrongsNumbers 1752, resolveStrongsNumbers 2047, QUOTE_TRIGGER 2104, REVERSE_QUOTE 2112, NOTE_ASK 2128, YOUTUBE_VIDEO 2137, maybeAddCommentary 2321, buildBareReferenceResponse 2368, runQuoteLookup 2412. Caps: 6 primary (187), 12 cross-refs (188).

runLookup order: history slice 2509 / tab block 2510 → focus/book/testament/effective question 2515-2543 → notes ask 2555 → video ask 2565 → empty() 2585 → bare ref 2614 → quote 2627 → **availability 2639** → budget 2649 → extraction 2651 → keywords/guesses 2662 → **Strong's 2673-2698** → focus/canonical pins 2735-2795 → guesses vs DB 2803-2896 → FTS 2915-2975 → TSKe headings 2986 → cross-ref seed/expand 3000-3008 → semantic 3026-3042 → mergeAdjacent 3047 → Deep verification loop ≤3 3059-3122 → no-candidates 3124 → notes signal/scoring 3129-3139 → assembly 3214/3227-3322 → Strong's first 3328 → implicit notes 3343 → critique (Deep) 3373-3387 → critique re-search 3396-3410 → decideNotesAreLead 3416 → prune (Deep) 3437-3449 → cross-ref nesting 3455-3486 → emitPartial (commentary) 3504 → commentary + fact-check 3513-3559 → return 3562.
IPC: ailookup:checkAvailable, ailookup:unloadModel, ailookup:query (3591; emits ailookup:progress, ailookup:partial), chat CRUD, ailookup:chatsChanged (3649).

## Ollama / embeddings
electron/ollama.ts: DEFAULT llama3.1:latest (16), NUM_CTX 16384 (30), checkOllamaAvailable /api/tags 2.5 s never throws (42), keep_alive 15m + idle unload (68, 81). runOllamaJson (138): format json, num_ctx 16384, num_predict 512, temp 0.3, 45 s; throws on non-2xx/abort/parse. runOllamaText (155) unused by pipeline. Extraction failure → 'ollama-request-failed'; verification/critique/prune/commentary failures swallowed.
embeddings.ts: nomic-embed-text /api/embed 10 s; brute-force cosine, index cached (~420 MB); semanticSearch null with no index. semanticCandidates.ts: [] on failure; RRF topK 20 keep 5. embeddingsDb.ts: dev path only. tokenBudget.ts: 4 chars/token; trim history → tab → candidates.

## IPC contract
electron/preload.ts:421-457 window.aiLookup (onProgress/onPartial). Types src/types/electron.d.ts:642-874: AiLookupResponse 694, AiLookupChatAiMode 740 {commentary, deepSearch, tabContext}, AiLookupChatMessage 766, AiLookupTabContextRef 807, query opts 825-843, onPartial 873. No token streaming.

## Renderer (src/components/ailookup/)
chatModes.ts (3 modes); ChatComposer.tsx (store 158-165, mode 169, submit 179-208, word-replacer 194); ChatComposerControls.tsx (ChatModeMenu 34, ChatContextToggle 80); useChatController.ts (send 305-375, history 338, query 347, errors 354-366, availability 226-229, listeners 233-243, messageFieldsFrom 42, editAndReask 397); chatModel.ts (aiHistoryFor 51, replyContext 89, mentionsCurrentTab 44, aiModeCaption 227); AiReplyBody.tsx (SourceBadge 114, StrongsCard 41, NoteCard 64, VideoCard 95, passage list, cross-refs, Show more, Related Passages); ChatMessageRow.tsx (caption 159); ChatSurface.tsx (progress 132, unavailable 257, empty hint 158); ChatTranscript.tsx (virtualized); AiLookupPanel.tsx; ChatWindowApp.tsx; ChatMarkdown.tsx; chatNav.ts; chatTokens.css; chatContent.css (.chat-passage 103, .chat-ai-row 137).

## Store
Fields store:598-608; defaults 2069-2071; setters 3149-3151; persist 'berean-app-state' version 8 (3406-3407), identity migrate (3419); partialize 3544-3546. crossWindowSync.ts:45 SHARED_PREFERENCE_KEYS includes the three AI keys; chat window rehydrates on storage event (ChatWindowApp.tsx:237).

## Mobile
src/mobile/chat/ChatPage.tsx:61 aiSupported:false; sparkle disabled "Ask Berean is available on the Mac" (30, 466-474). bridgeExtras.ts:240-260: checkAvailable false, query/commentary unavailable, chat CRUD via aiChatsService. Async services in src/platform/services: bibleService, lexiconService (getEntry, getOccurrences, getRelated, search, searchLexiconGloss, getLexiconOccurrences, findByNormalizedTransliteration), crossrefsService; hosted by src/platform/ios/services.ts. aiLookup.ts uses sync better-sqlite3 helpers (electron/ipc/bible.ts:102,118,188).

## Tests
electron: __tests__/tokenBudget.test.ts; ipc/__tests__/aiLookup.{decideNotesAreLead,mergeVideoSearchResults,runCritique,scopeDetection,tskeCrossRefWidening,verifyGeneratedText}.test.ts, semanticCandidates.test.ts, crossrefs.searchTskeHeadingsByKeywords.test.ts. **No runLookup error-path, history-cap or H2580 test.**
src: components/ailookup/__tests__/* (aiReplyBody, chatController, chatHistoryList, chatHistoryPanel, chatModel, chatOrganize, chatRedesign, chatReplies, chatRound3, chatRound9, chatTranscript, chatWindowLayout, partialResults); mobile/chat/__tests__/chatPage.test.tsx; platform/ios/__tests__/bridgeSurface.test.ts; store/__tests__/persistedSettings.test.ts.
Evals: scripts/eval/runRetrievalEval.ts (Ollama mocked, commentary/agentic false), semanticEval.ts (real embeddings), betterSqlite3NodeShim.ts, vitest.eval.config.ts.
