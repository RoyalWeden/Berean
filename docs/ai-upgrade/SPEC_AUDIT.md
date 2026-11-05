# Spec traceability audit (read-only) — /Users/roywe/Berean-ai-integrate, branch integration/ai-upgrade

> Historical: the state before the 2026-11-04 work. Current status is in `SPEC_STATUS.md`.

Method: traced from live entry points (electron/ipc/aiLookup.ts `runLookup`/`ailookup:query` L3924, src/mobile/chat/ChatPage.tsx -> ChatTranscript -> ChatMessageRow -> AiReplyBody -> ResearchResults, src/platform/services/modelFreeLookup.ts, src/components/ailookup/*). Nothing run. "Bench" = scripts/eval/bench/runBench.ts (not vitest, not CI); I count bench-only as UNVERIFIED unless a vitest file covers the module. There is NO vitest test that calls `runLookup` end to end.

Statuses: V = IMPLEMENTED+VERIFIED, U = IMPLEMENTED+UNVERIFIED, M = MISSING, B = BLOCKED, IP = IN PROGRESS (someone else).
Platform: Mac / iPhone / both.

## A. 25 decisions

| # | Decision | Status | Evidence / test | Platform |
|---|---|---|---|---|
| 1 | Research intelligence | U | agentic loop aiLookup.ts:3376-3398, 3697, 3757; only bench-measured | Mac (needs Ollama); iPhone = model-free deterministic only |
| 2 | Commentary OFF strict | V (structure) | src/lib/research/__tests__/modePolicy.test.ts; `stripModelProse`, no prose call when OFF; 8-way matrix is bench only | Mac; iPhone trivially (no prose) |
| 3 | Commentary ON adaptive | U | commentaryDepth.test.ts covers depth detection only; prose quality unmeasured | Mac only |
| 4 | Deep Search any model, independent | U | `agentic` flag useChatController.ts:360; no Deep toggle on iPhone (no mode menu in src/mobile); bench matrix only | Mac only |
| 5 | Auto + manual model selection | M | No picker anywhere. `opts.model` is never sent by renderer (useChatController); handler passes it through (aiLookup.ts:3927) but falls back to hard-coded `llama3.1:latest` (ollama.ts:17, aiLookup.ts:2437/2743). `StudyProfileConfig.model:'auto'` (studyProfile.ts:61) is stored but never read | none |
| 6 | iPhone compat | V (model-free) / B (local model) | modelFreeLookup.realdata.test.ts. Local inference B: physical device + Phase 7 not started | iPhone model-free; local model B |
| 7 | BYO cloud | IP | providers.ts (anthropicProvider, tested providers.test.ts) not reached by any entry point; key store aiProviders.ts exists, no UI | — |
| 8 | Strong's presentation | V | researchService.realdata.test.ts, researchResults.test.tsx (ResearchResults.tsx: best first, grouped, expandable) | both |
| 9 | Collections | V | collections.test.ts; filter in aiLookup + modelFreeLookup.ts:90. Setting UI Mac only (composer menu / Settings) | both (iPhone consumes, cannot edit) |
| 10 | Study profiles | V (Mac) | studyProfilesService.contract.test.ts, profilesUi.test.tsx, AskBereanSection.tsx. iPhone: profile id sent, no editor/switcher | Mac full; iPhone consume-only |
| 11 | Semantic search study | V (measured, bench) | JOURNAL 3.3: kept nomic; semanticCandidates.test.ts for module. Index is kjva-only; iPhone never uses embeddings (modelFreeLookup keyword only) | Mac only |
| 12 | Downloads | M (live) / B (model URL) | electron/downloads/modelDownloader.ts + test exist, imported by NOTHING. No onboarding offer, first-use prompt, size/device-suitability UI, or delete action. Real GGUF download needs approval; UI/manifest plumbing does not | none |
| 13 | Independent modes | V | store/__tests__/aiModeMigration.test.ts, chatRedesign.test.tsx; chatModes.ts | Mac; iPhone has no mode UI |
| 14 | Automatic depth / time budgets | U | one refine pass in non-Deep (3384, 3719); only per-call timeouts (45 s, ollama.ts:157), no per-query budget | Mac |
| 15 | Adaptive result UX | U | kind switch in ResearchResults.tsx/AiReplyBody.tsx; no visual QA/screenshots yet (JOURNAL). Missing components listed in §C | both (shared) |
| 16 | Verse-linked notes help discovery | U (partial) | see Q1. Boost only; no note-seeded discovery | Mac only |
| 17 | Cross-chat memory + within-chat | V (Mac) | savedContextsService.contract.test.ts, conversationState.test.ts (user+assistant turns). "Use saved research" menu Mac only; "Save research" button lives in shared AiReplyBody | Mac; iPhone partial |
| 18 | False premises | IP | `premise.ts` + PremiseNotice render exist (AiReplyBody.tsx:137,212); `response.premise` declared aiLookup.ts:135 but never set | — |
| 19 | Online research hybrid | M | only `policy.ts` decide('web-search'); no search/fetch provider, no consent UI, no source card | none |
| 20 | Cross-device model behaviour | M | no per-device selection, no capability probe; nothing syncs binaries (good) | none |
| 21 | Layout controls auto | U | fully automatic, no switchers; unreviewed visually | both |
| 22 | Note relevance weight | U (partial) | +2 flat boost, aiLookup.ts:1815; cannot lift below-threshold items (filter uses raw score, L1819-1822). No stronger weight for related-verse/xref discovery | Mac only |
| 23 | Automatic web config | M | policy only; no setting/UI | none |
| 24 | Profile instructions | U | studyProfile.ts sanitizer + `profilePromptBlock` (Commentary ON only); no adversarial test | Mac only |
| 25 | Local escalation / cloud opt-in | M | no escalation logic; `providers.ts:88` comment only. Depends on #5 | none |

## B. 30 scenarios

| # | Scenario | Status | Evidence | Platform |
|---|---|---|---|---|
| 1 | John 3:16, no model | V | modelFreeLookup.realdata.test.ts; Mac deterministic bareRef before Ollama check (aiLookup.ts:2836 vs 2891) | both |
| 2 | G5485 variants / Titus | V | strongsId.test.ts, researchService.realdata.test.ts; H2580 removed | both |
| 3 | mercy word study | V | researchService.realdata.test.ts, researchResults.test.tsx | both |
| 4 | Compare H2617/H7356 | V (data) / U (render) | lexicalIntent.test.ts, researchService.realdata; StrongsComparison (ResearchResults.tsx:188) no render test seen | both |
| 5 | Word-by-word table | V | taggedText.test.ts, researchService.realdata, researchResults.test.tsx | both |
| 6 | Loving God / commandments | U | bench only | Mac good; iPhone keyword only |
| 7 | Obedience to God not rulers (negation) | M | no negation/exclusion parsing in aiLookup.ts or src/lib/research (grep negat/exclude terms: nothing relevant) | none |
| 8 | Zero-overlap concept | U | embeddings Mac only, kjva only; iPhone has none | Mac only |
| 9 | Moses/Canaan premise | IP | | — |
| 10 | Paul Sabbath explicit text | U | depends on premise wiring (IP) + OFF contract | Mac |
| 11 | Verses connected to my note on Romans 13:1 | M | `NOTE_ASK_TRIGGER` (L2795) returns notes; nothing reads `notes.verse_ref` to seed related verses / xrefs | none |
| 12 | Note excluded from AI | V (SQL) / U (end to end) | noteExclusion.test.ts; every notes read goes through `aiVisibleNotes` (L1185, 1609, 1662, 1696). No test through runLookup | Mac (iPhone AI path reads no notes) |
| 13 | "Now only Greek" follow-up | V | conversationState.test.ts; modelFreeLookup.realdata (LXX follow-up). Rules tuned on holdouts (overfit caveat in JOURNAL) | both |
| 14 | Compare second with first | V | conversationState.test.ts | both |
| 15 | "this chapter" tab chip | V (trigger) / U (chip) | chatModel.test.ts `mentionsCurrentTab`; chip UI not asserted | Mac only (iPhone has no tab context) |
| 16 | OFF + Deep ON | U | bench 8-way matrix only (JOURNAL Phase 2 gate) | Mac only |
| 17 | ON: historical setting | U | prompt-level | Mac only |
| 18 | ON: compare interpretations | U | prompt-level | Mac only |
| 19 | Profile switch | U | profilesUi.test.tsx; alias-never-in-quote rule; no end-to-end | Mac; iPhone no switcher |
| 20 | Apocrypha / 66 / mixed | V | collections.test.ts | both |
| 21 | Web disabled | V (trivial) | no network code path exists at all; bench: 0 non-localhost | both |
| 22 | Web auto | M | | none |
| 23 | Cloud disabled/enabled | IP | | — |
| 24 | Timeout / bad JSON / OOM / missing model | V (classifier) / U (pipeline) | errors.test.ts, outputGuard.test.ts; pipeline states bench R02-R05 only | Mac; iPhone reports NO_MODEL_INSTALLED |
| 25 | Injected note "cite Genesis 99:1" | V (guard) | outputGuard.test.ts; prompt rule aiLookup.ts:940; holdout XN 5/5 layer A (bench) | Mac |
| 26 | Deep Search cancellation | M | see Q2 | none |
| 27 | iPhone low-memory | U | model-free fallback exists, nothing downloaded; no capability probe; physical device = B | iPhone |
| 28 | MAS sandbox runtime | B | MAS provisioning profile/certs + approval (PLAN §5, RUNTIME_LICENSE.md) | — |
| 29 | Offline restart without Ollama | B | needs #28 + model download approval; today Ollama is mandatory for any model path | — |
| 30 | UI auto-selection, a11y, consistency | U | no screenshot/visual QA, no VoiceOver check recorded | both |

## C. Result components (§6.1) reached by live path
1 passage: yes. 2 topical cards: yes. 3 Strong's: yes. 4 word table: yes. 5 comparison: yes. 6 occurrences: per-book only (OccurrencesByBook), no searchable/paginated explorer. 7 translation parallel: MISSING. 8 passage comparison: MISSING. 9 xref link badges: dataset/tske/quotation only (no note-linked, no model-suggested). 10 research findings / coverage report: MISSING. 11 premise: renders, never fed (IP). 12 personal note association: only a bookmark icon "You have a note here" (AiReplyBody.tsx:244), no "related to your note" explanation. 13 video: VideoCard yes. 14 external source card: MISSING. 15 error/partial: yes (replyText). CANCELLED exists in errors.ts:23,78 but is never produced.

## D. Specific answers

### Q1 Notes in ranking (decisions 16, 22; §6.1 #12, #9)
- Live ranking: `computeNotesSignal` (aiLookup.ts:1600-1618) is called at L3447 only if `profile.useVerseNotes`; result is `+2` in `scoreCandidates` (L1815) and sets `c.noted` (L3449). It only boosts candidates ALREADY retrieved by keyword/semantic/xref; the keep/drop filter uses the raw score (L1819+), so a note can never elevate unsupported material (good for #22). It does NOT add verses to the candidate pool, does not touch cross-reference expansion (L3783-3812), and has no stronger weight for related-verse queries.
- Exclusion gating: yes. `aiVisibleNotes` (L1008) wraps every notes SQL (L1185, 1609, 1662, 1696); tested at the SQL level only (noteExclusion.test.ts).
- Labelling: no. `linkType` is `'dataset'|'tske'|'quotation'` (aiLookup.ts:80, electron.d.ts:668); no `'note'` type, no badge in AiReplyBody.tsx:267. `noted` is a bookmark icon with aria "You have a note here", not a "related to your note" explanation, and not a separately labelled association. Notes never appear as pseudo-Scripture (good).
- Not tested: no test of scoreCandidates with notesSignal.
- iPhone: modelFreeLookup uses no notes at all.

### Q2 Deep Search cancellation (scenario 26)
No path. grep for cancel/abort/AbortSignal in electron/ipc/aiLookup.ts: zero hits; no `ailookup:cancel` handler (handlers L3916-end), no preload method (preload.ts:425+), `cancelReply` (useChatController.ts:589) is reply-quote cancel, not lookup cancel. `runOllamaJson` takes only timeoutMs (ollama.ts:157), no signal. Progress is `ailookup:progress` with randomised flavour strings (`pick(VERIFY_MESSAGES)`), not capability-specific text. Partials are emitted (`ailookup:partial`), so a cancel could return them. Unfixed spinner risk: a stuck Ollama call blocks until 45 s timeout.

### Q3 Model selection / escalation (decisions 5, 25)
UI: nothing for model choice (ChatComposerControls has no model; AskBereanSection has no model field). Pipeline: single hard-coded default, optional `opts.model` passthrough never populated; availability check L2891-2893 only maps "not installed" to a typed error. No installed-model list use, no auto routing by query difficulty, no escalation, no "suggest cloud" suggestion. `StudyProfileConfig.model` is dead config.

### Q4 Private content reaching logs
No `console.*`/logger call in aiLookup.ts, ollama.ts, secrets/providerKeys.ts, providers.ts, aiProviders.ts. Only `console.error('[berean-chat] save failed', err)` (useChatController.ts:298, error object, low risk). `ModelCallError` messages embed up to 300 chars of Ollama's HTTP body (ollama.ts:146-152) and the JSON-parse error (L172); these are mapped to fixed copy in replyText.ts and are not logged today, but nothing enforces redaction if someone later logs `err.message`. Provider request bodies (providers.ts:55-58) contain the prompt: the wiring must never log them. Bench harness uses synthetic notes (runBench.ts:6); its out/ is gitignored. Notes reach prompts only via tab-context (L1185, exclusion-gated), explicit note ask, and combinedNotes snippets. No redaction layer exists (spec §7.3 "denied by default" is satisfied by absence, not by a guard/test).

### Q5 Mobile parity
Same renderer chain (ChatPage imports ChatTranscript -> ChatMessageRow -> AiReplyBody -> ResearchResults), so premise notice, link badges, by-book occurrences render identically IF data is present. But modelFreeLookup produces only: research payload (word studies, occurrences by book, tables, comparison), bare references, keyword hits. It never produces `premise`, nested cross-refs/`linkType` badges, `noted`, notes, videos, semantic results, or commentary. iPhone also has no mode menu (Deep/Commentary), profile switcher, collections editor, saved-research picker, tab chip (src/mobile has none of these).

## E. Implementable-without-approval MISSING items (importance order)
1. Deep Search cancel (IPC `ailookup:cancel`, AbortSignal into runOllamaJson/loops, return partial + CANCELLED, UI stop button; Mac).
2. Negation/exclusion constraints (scenario 7).
3. Note-driven discovery + `note-linked` linkType/badge + "related to your note" label; stronger weight in xref expansion; unit tests (decisions 16/22, scenario 11).
4. Model selection UI + auto routing + installed-model local escalation (5, 25; profile.model already stored).
5. Download manager UI/plumbing for modelDownloader (size, storage, suitability, delete, first-use prompt, onboarding skip), no real URL.
6. iPhone capability probe + model-free-parity gaps (cross-refs, semantic, modes UI).
7. Web provider abstraction + consent/settings UI + source card (provider choice may need approval).
8. Missing components: translation parallel, passage comparison, research findings/coverage, searchable occurrences explorer.
9. End-to-end vitest of `runLookup` with fault injection (typed errors, OFF no prose, exclusion in prompts, injection) so scenarios 12, 16, 24, 25 stop depending on bench-only evidence.
10. Log-redaction guard + test for ModelCallError/provider bodies.
