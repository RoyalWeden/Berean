# Berean AI Upgrade — Phase 0 Plan, Inventory, Risks and Traceability

Spec: `Berean_AI_Implementation_Master_Spec.md` (2026-10-28) — the source of truth. Benchmark: `Berean AI Benchmark Report.md`.
Audit detail: `audit/lane-a-ai-pipeline.md`, `audit/lane-b-data-notes-sync.md`, `audit/lane-c-packaging-platform.md`.
Journal: `JOURNAL.md`. Worktree `/Users/roywe/Berean-ai-upgrade`, branch `feature/ai-upgrade`.

---

## 1. Repository reality check (inferred from code unless marked)

| Benchmark/spec claim | Repo reality | Status |
|---|---|---|
| Default mode Commentary ON | store/index.ts:2069-2071 → 'commentary'; persist v8 identity migrate | confirmed |
| OFF+Deep not selectable, sent if stored | chatModes.ts:31-35 forces commentary for 'deep'; ChatComposer.tsx:196 sends stored | confirmed |
| Commentary receives no history | commentaryPrompt aiLookup.ts:846-898 | confirmed; verification/critique/prune also none |
| Main keeps last 6 history | aiLookup.ts:2509; renderer sends 8; budget trims more | confirmed |
| Strong's after availability check | check 2638-2640, Strong's 2673-2698 | confirmed (R09 root cause) |
| Only ollama-unavailable mapped | useChatController.ts:359-366 | confirmed (R02–R05 root cause) |
| Literal H2580 example | aiLookup.ts:811, 825; no word-question check | confirmed |
| Embedding index not shipped | embeddingsDb.ts:24-30; iOS excludes it | confirmed |
| lxx.db Greek-tagged, unregistered | TEXT_FILES bible.ts:10-30 (`lxx` → lxx_brenton); lxx.db 30,603 verses G-tagged, **no UNIQUE verse key (duplicates)**; still shipped by the *.db glob | confirmed + new caveat |
| BereanDownloadsPlugin resumable + SHA-256 | resumable yes; SHA computed after move, no expected-hash input, **not atomic**, not background | partially — needs extension |
| No morphology | none in any DB | confirmed |
| iPhone AI disabled | ChatPage.tsx:61, bridgeExtras.ts:240-260; D-009 desktop-only decision | confirmed (D-009 superseded by spec decisions 6/20) |

New findings not in the benchmark:
- No secure storage anywhere (no safeStorage/Keychain) → needed for BYO keys.
- No generic desktop download manager (ttsModel.ts is fetch + atomic rename, no resume/SHA).
- No profile concept; Zustand prefs and `settings` table are device-local; only DB entities sync (iCloud Drive op-log).
- No note/folder flag; system folders are virtual (computed), so exclusion for them needs a keyed setting.
- Strong's `occurrences` tables are treated as stale; app LIKE-scans `text_tagged` (lexiconService.ts:81-120). Hebrew occurrences lack text_id.
- `books.testament` labels apostolic fathers as Pseudepigrapha; no canon/collection field → collections need a mapping layer.
- MAS forbids `network.server` and `disable-library-validation` (verify-mas.mjs) → a localhost llama-server helper is not viable as-is; an in-process Node-API addon has precedent (berean_glass.node / berean_icloud.node).
- `npm run lint` has no ESLint config (likely broken; not used as a gate).
- Renderer type `AiLookupResultSource` lacks 'semantic'; `notesAreThePrimaryAnswer` unused; several stale comments.

Baseline (measured 2026-10-28): typecheck PASS; vitest 338 files / 5408 tests PASS.

---

## 2. Target architecture (adapted to this repo)

```
Renderer (shared: Mac + iPhone)                       Platform-specific
───────────────────────────────                       ──────────────────
ChatComposer → useChatController                      
   │  ResearchRequest {question, modes, scope,         
   │   profileId, convState, tabRef}                  
   ▼                                                  
src/lib/research/   (pure TS, no electron/sqlite)     
  normalize/      intent + entity extraction          
  state/          ConversationState reducer           
  policy/         permissions (notes/web/cloud), mode contract
  resolvers/      reference, quote, strongsId, lexicon(gloss/translit/script),
                  wordTags, occurrences, crossRefs, corpusSearch, notes, videos
  router/         deterministic tool router (+ model planner hook)
  evidence/       EvidenceItem store, provenance, validity vs relevance
  verify/         ref/Strong's validation of any model text
  compose/        ResearchResult schema → layout selection
  errors/         typed ResearchError codes
        │ uses ResearchSources interface (async)
        ▼
  Desktop: electron adapters over bible/lexicon/crossrefs (IPC)
  iPhone:  src/platform/services (bibleService, lexiconService, crossrefsService)

Model layer (provider abstraction)                    
  src/lib/research/llm/  LlmProvider {generateJson, generateText, capabilities}
     OllamaProvider (existing, fallback)    LlamaCppProvider (Phase 4, Node-API addon / iOS SPM)
     CloudProvider (Phase 6, BYO key, opt-in)
  model-assisted: topical extraction, planning (Deep), commentary (ON only)

UI: src/components/ailookup/results/*  typed components per ResultKind,
    reusing CardButton/RefChip/Chip/Badge/SectionLabel; mobile variants via tokens.
```

Key principle: everything model-free runs first and is shared by both platforms, so iPhone gains full model-free research in Phase 1–2 even before local inference (decision 6).

`electron/ipc/aiLookup.ts` keeps working throughout. New resolvers are wired into it first (Phase 1), then the pipeline is moved behind the shared orchestrator incrementally (Phase 2+), behind a feature flag `research.v2` with the legacy path as rollback.

---

## 3. Phased plan with gates (spec §11)

### Phase 1 — Deterministic retrieval and failure correctness
| # | Work | Modules | Tests / gate |
|---|---|---|---|
| 1.1 | Strong's id parser (G5485, g5485, G-5485, G 5485, H02617, mid-sentence, multiple) | src/lib/research/strongsId.ts | unit; C07, C55, R09 |
| 1.2 | Lexicon resolver: gloss / KJV-usage / transliteration / original script / lemma → ranked candidates grouped by language, never a single guess | src/lib/research/lexiconResolve.ts + source adapters | unit vs real DBs; C25,C29,C37,C39,C43,C46,C51-54, scenario 3 |
| 1.3 | Word-tag tokenizer from text_tagged (multi-tag, empty tags, punctuation) + verse word table | src/lib/research/wordTags.ts | unit; C11-C17, H13, scenario 5 |
| 1.4 | Occurrences with corpus/book filters + counts + pagination; source of truth = text_tagged scan, labelled | lexiconService extension | unit; C18, C20, scenario 2/13 |
| 1.5 | Model-free first: reference, quote, Strong's/lexicon, word tags resolved before any model availability check | aiLookup.ts runLookup reorder | R09, scenario 1-2 with Ollama off |
| 1.6 | Typed errors (spec §9.1 codes) end to end; never "No matching verses" for inference errors; preserve partial results | src/lib/research/errors.ts, aiLookup.ts, useChatController.ts, AiReplyBody | R02-R05, scenario 24 |
| 1.7 | Remove H2580 prompt example; gate model strongsNum (validated, only for word questions, never sole source) | aiLookup.ts extractionPrompt | prompt-contamination test |
| 1.8 | Output verification: every ref/Strong's in model text validated; unverifiable stripped/flagged; perVerse keys restricted to supplied | verifyGeneratedText extension | R19, S19, scenario 25 |
| 1.9 | Named-verse inclusion (in evidence set with support flag) | aiLookup.ts | K23, K32 |
| 1.10 | JSON robustness: think:false for thinking families, per-call num_predict, one constrained repair attempt | electron/ollama.ts | K02/K06, as-is thinking cases |
**Gate:** direct/Strong's lookups pass with Ollama off; reference + Strong's gold cases pass; failures distinguishable; full vitest green; benchmark layer A rerun shows R02–R05/R09 fixed.

### Phase 2 — State, modes, profiles, permissions
| # | Work | Modules |
|---|---|---|
| 2.1 | Four independent modes (Commentary × Deep); UI = two toggles not a 3-way menu; default OFF/OFF; store migration v8→v9 (preserve OFF+Deep as OFF+Deep) | chatModes.ts, ChatComposerControls.tsx, store |
| 2.2 | Strict OFF contract: OFF never calls commentary generation; OFF prose limited to templated factual summaries from evidence; interpretation request → "Explore interpretations" action | compose/, policy/ |
| 2.3 | Adaptive ON: requested-depth classifier (plain / historical / linguistic / interpretations / argument); labelled sections; history passed | commentaryPrompt |
| 2.4 | Structured ConversationState (entities, filters, citations, tab, corrections, reset) persisted per chat; user+assistant turns | src/lib/research/state/, ai_chats column (migration v49) |
| 2.5 | Tab chip ("Using this tab", dismissible) for phrase-triggered tab use | ChatComposer / ChatMessageRow |
| 2.6 | Study profiles (synced `study_profiles` table v49; neutral default; naming aliases for assistant prose only; collections; notes policy; web/cloud permission prefs; model prefs) | migrations, sync entities, settings UI |
| 2.7 | Collections + scope: canon / deuterocanon-apocrypha / pseudepigrapha / apostolic fathers / LXX mapping; explicit question scope overrides; corpus labels | src/lib/research/collections.ts |
| 2.8 | Note AI exclusion: notes.ai_excluded + note_folders.ai_excluded (v49) + system-folder keyed setting; inheritance; enforced in every AI read path, prompt, index | migrations, notesService, vault, aiLookup |
| 2.9 | Permission model + policy engine (local/notes/standalone notes/web/cloud) | policy/ |
| 2.10 | Saved research context (explicit save/use/delete) | ai_saved_contexts table v49 |
**Gate:** 8-way matrix, follow-up tests, profile migration, privacy tests, OFF leakage evaluation.

### Phase 3 — Retrieval + model research
3.1 holdout set (≥100 new cases, frozen before tuning) · 3.2 reproduce 17.4% semantic baseline · 3.3 retrieval-only baseline (FTS/lemma/xref/notes) · 3.4 ≥2 semantic alternatives (e.g. compact multilingual embedding; hybrid BM25+embedding rerank; passage-window index) — **needs approval for model downloads** · 3.5 human-review workflow for 75 gold sets + 40 outputs · 3.6 re-benchmark models on repaired pipeline (already-downloaded models; no new downloads needed for the shortlist).
**Gate:** exact measurements; conditional model choice; no acceptance below critical gates.

### Phase 4 — Local runtime, downloads, Mac packaging
4.1 sandbox spike: Node-API llama.cpp addon in a signed MAS-dev build (no network.server, no disable-library-validation) — **approval needed before any signing/entitlement change** · 4.2 LlmProvider abstraction with Ollama fallback · 4.3 desktop download manager (resume, SHA-256 expected-hash, atomic install, disk check) · 4.4 model manager UI · 4.5 auto/manual selection + local escalation · 4.6 license matrix for exact weights.
**Gate:** no CLI in new path; tested signed sandbox build; rollback.

### Phase 5 — Adaptive research UX (contracts start in Phase 1; components built incrementally)
Result components (spec §6.1 #1–15), layout router, progress/cancel, accessibility, Mac + iPhone variants, screenshot QA fixtures (spec §6.3).

### Phase 6 — Online research + BYO cloud
Web provider abstraction + permission; safeStorage / Keychain key store; one provider via clean abstraction; consent + cost disclosure. **Approval needed before any paid call (none planned in tests).**

### Phase 7 — iPhone local inference
Capability probe, llama.cpp SPM/xcframework, Downloads plugin extension (expected hash + atomic), memory/thermal handling. **Physical-device measurement required; Claude cannot perform it.**

### Phase 8 — Regression, beta readiness
Full suite + holdout + human review + security review + rollback drill; release only with explicit approval.

---

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | aiLookup.ts (3658 lines) regressions while refactoring | high | high | additive resolvers + tests first; feature flag; benchmark replay after each change |
| R2 | OFF interpretation leakage via templated summaries | med | critical | OFF uses no free-form model prose; policy tests + human safety set |
| R3 | MAS sandbox rejects llama.cpp addon (JIT/Metal/library validation) | med | high | spike before commitment; Ollama fallback retained; CoreML/MLX/Foundation Models alternatives evaluated |
| R4 | Model licenses disallow redistribution | med | high | license matrix from actual model cards; user approval |
| R5 | lxx.db duplicate verse numbers / tagging provenance | med | med | audit before registering; label "LXX Greek (Rahlfs)"; never align to Brenton |
| R6 | Migration v49 breaks sync with older builds | low | high | additive defaulted columns only; older builds ignore unknown fields (entities.ts) |
| R7 | Holdout leakage into heuristics | med | med | holdout written + frozen before Phase 3 tuning; hash recorded |
| R8 | iPhone memory/thermal unknown | high | high | capability probe; model-free fallback; physical-device gate |
| R9 | Scope too large for one session | high | med | phase gates; journal; checkpoint state on disk |
| R10 | Existing users lose intended mode on default change | med | med | migration preserves stored flags; only new chats default OFF |

---

## 5. True blockers / approvals required (spec §0.3, §14)

1. **Model downloads** for semantic alternatives (Phase 3.4) and any new runtime weights — will ask with sizes.
2. **Signing / entitlement changes** for the MAS sandbox spike (Phase 4.1).
3. **Physical iPhone** measurements (Phase 7) — Michael must run them.
4. **Licenses** — Claude will compile the matrix; acceptance needs Michael.
5. **Paid API calls** — none planned; cloud provider tested with mocks only unless approved.
6. **Destructive cleanup, beta/production release** — not in scope without approval.

---

## 6. Traceability matrix — 25 approved decisions

| Dec | Requirement | Phase | Modules | Acceptance |
|---|---|---|---|---|
| 1 | Intelligent research assistant; Deep = multi-step agent with budgets | 2, 3, 5 | router/, orchestrator, Deep loop | sc. 16, 26 |
| 2 | OFF factual, zero interpretation | 1.7, 2.2 | policy/, compose/ | sc. 4, 6, 10, 16; OFF safety set |
| 3 | ON adaptive depth, labelled | 2.3 | commentaryPrompt, compose | sc. 17, 18 |
| 4 | Deep with every model, adaptive depth | 2.1, 3 | Deep loop budgets | sc. 16 |
| 5 | Auto + manual model selection | 4.5 | LlmProvider registry | model manager tests |
| 6 | iPhone device-appropriate local models; model-free elsewhere | 1, 7 | shared resolvers; capability probe | sc. 27 |
| 7 | BYO API key cloud | 6 | CloudProvider, key store | sc. 23 |
| 8 | Strong's best-first, expandable, grouped, distinct lemmas | 1.2, 5 | lexiconResolve, StrongsCandidates UI | sc. 3 |
| 9 | Configurable collections, explicit scope, no Esther exclusion, labels | 2.7 | collections.ts | sc. 20 |
| 10 | Multiple study profiles, never rewrite quotes | 2.6 | study_profiles | sc. 19 |
| 11 | Semantic alternatives before removal | 3.2-3.4 | retrieval interface | semantic report |
| 12 | Downloads: onboarding (skip) + first use; size/suitability; resumable; removable | 4.3, 4.4, 7 | download manager, model manager | sc. 27, 29 |
| 13 | Deep and Commentary independent incl. OFF+Deep | 2.1 | chatModes, store migration | 8-way matrix |
| 14 | Normal mode limited extra searches; full Deep opt-in; time budgets | 2, 3 | orchestrator budgets | latency report |
| 15 | Adaptive result UX | 5 | results/*, layout router | sc. 30 |
| 16 | Verse-linked notes eligible for discovery; standalone notes = profile setting; notes ≠ Scripture | 2.8, 2.6 | notes resolver | sc. 11 |
| 17 | Explicit saved research context; within-chat user+assistant structured state | 2.4, 2.10 | state/, ai_saved_contexts | sc. 13, 14 |
| 18 | False premises investigated, OFF factual | 2.2 | premise check component | sc. 9, 10 |
| 19 | Online research hybrid, permission-gated, separate from cloud | 6 | WebProvider, policy | sc. 21, 22 |
| 20 | Cross-device consistent; no model binary sync | 2.6, 4, 7 | profile sync excludes model paths | device matrix |
| 21 | Automatic layout; subtle alternatives | 5 | layout router | sc. 30 |
| 22 | Moderate note influence; verse notes stronger for related/xref; never over text | 2.8, 3 | ranking features | sc. 11 |
| 23 | Configurable automatic web, privacy-conservative default | 6 | policy defaults | sc. 21, 22 |
| 24 | Profile instructions bounded by sources/safety/OFF | 2.6 | policy/, prompts | sc. 19 |
| 25 | Auto-escalate to stronger installed local model; cloud only opt-in | 4.5, 6 | provider router | sc. 23 |

## 7. Section 12 scenarios → phase

| Sc | Phase | Sc | Phase | Sc | Phase |
|---|---|---|---|---|---|
| 1 | 1 | 11 | 2 | 21 | 6 |
| 2 | 1 | 12 | 2 | 22 | 6 |
| 3 | 1 | 13 | 2 | 23 | 6 |
| 4 | 1+2 | 14 | 2 | 24 | 1 |
| 5 | 1 | 15 | 2 | 25 | 1 |
| 6 | 2 | 16 | 2 | 26 | 2 |
| 7 | 2/3 | 17 | 2 | 27 | 7 |
| 8 | 3 | 18 | 2 | 28 | 4 |
| 9 | 2 | 19 | 2 | 29 | 4 |
| 10 | 2 | 20 | 2 | 30 | 5 |
