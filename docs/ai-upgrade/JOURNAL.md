# Berean AI Upgrade — Implementation Journal

Source of truth: `Berean_AI_Implementation_Master_Spec.md` (2026-10-28, 25 approved decisions).
Evidence input: `Berean AI Benchmark Report.md` (2026-10-28) and `/Users/roywe/Berean-ai-bench` (branch `eval/ai-benchmark`).

Worktree: `/Users/roywe/Berean-ai-upgrade` · branch `feature/ai-upgrade` · base `main` 1b18826.

Labels: **measured** · **estimated** · **inferred from code** · **not tested**.

---

## Phase 0 — Discovery and plan

### 2026-10-28 — Setup and baseline (measured)

- Worktree created from main 1b18826; `npm run setup:worktree` OK.
- Benchmark worktree `/Users/roywe/Berean-ai-bench` confirmed present (branch `eval/ai-benchmark`, uncommitted suite + `out/`).
- `npm run typecheck`: PASS (8.0 s).
- `npx vitest run`: PASS — 338 files, 5408 tests (33.4 s).
- No production code changed. Nothing deleted. Ollama and all models untouched.

### Audit lanes

- Lane A — AI pipeline, IPC, renderer chat UI, store, mobile gating: `audit/lane-a-ai-pipeline.md`
- Lane B — notes/folders schema, sync, settings, Bible/lexicon DB schemas, secure storage, downloads: `audit/lane-b-data-notes-sync.md`
- Lane C — packaging, entitlements, sandbox precedents, iOS targets, test infra, design system: `audit/lane-c-packaging-platform.md`

### 2026-10-28 — Phase 0 audit complete

- Audit lanes A/B/C written (`audit/`). All six benchmark claims about the current pipeline confirmed in code; new findings recorded in `PLAN.md` §1 (no secure storage, no generic desktop downloader, no profile concept, BereanDownloads not atomic, lxx.db has 80 duplicate verse keys, MAS bans network.server → no localhost llama-server helper).
- `PLAN.md`: architecture, phases/gates, risk register, approvals list, traceability for all 25 decisions and 30 scenarios.

---

## Phase 1 — Deterministic retrieval and failure correctness

### Changes (2026-10-28)

New shared modules (no Node/Electron imports — usable on iPhone):
- `src/lib/research/strongsId.ts` — G5485 / g5485 / G-5485 / G 5485 / H02617 / mid-sentence / bare "Strong's 26" (both languages unless named).
- `src/lib/research/taggedText.ts` — `text_tagged` tokenizer: multi-tag, untagged `{}`, untranslated `~`, supplied italics `*`, red letter `!`, punctuation split; coverage counts.
- `src/lib/research/lexicon.ts` — KJV rendering index (English word → Strong's id → verse count, from kjva only; Brenton excluded because its tag alignment is offset), English inflections, transliteration (exact + loose: ç→s, ow→o, iy→i, final h), original script (points/accents/final forms stripped), verse-scoped resolution, merged readings (e.g. "chesed" = H2617 transliteration + the name Chesed).
- `src/lib/research/lexicalIntent.ts` — word-study / id / compare / occurrences / word-table / untagged-words detection.
- `src/lib/research/references.ts` — shared mid-sentence reference scanner (port of aiLookup's).
- `src/lib/research/errors.ts` — spec §9.1 codes, classifier, retry policy, copy.
- `src/lib/research/replyText.ts` — bubble text from the typed outcome; never "no matches" for a model failure.
- `src/lib/research/outputGuard.ts` — removes nonexistent references from model text (catches out-of-range chapters parseRef hides).
- `src/lib/research/payload.ts` — serializable `ResearchPayload`.
- `src/platform/services/researchService.ts` — model-free word studies, word tables, exact occurrence counts (SQL COUNT over text_tagged), registered as `services().research`.

Pipeline (`electron/ipc/aiLookup.ts`, `electron/ollama.ts`):
- Word studies / Strong's / word tables answered **before** the Ollama availability check (R09).
- Ollama down / model not installed / extraction failure → typed `errorCode`, one retry for timeouts, then **model-free keyword fallback** with `partial: true`; no further model calls in that lookup.
- Empty-but-valid extraction falls back to the question's own words.
- Model `strongsNum` is no longer trusted; the literal `"H2580"` example and its rule were removed from the extraction prompt.
- Model text guarded: nonexistent references removed from summaries with a note; captions citing them dropped.
- Commentary failures reported (typed) instead of swallowed.
- Explicitly named verses always included, `source: 'named'` (K23/K32).
- Commentary calls get `num_predict` 1024 (was 512; K02/K06 truncation) and a matching prompt budget.
- `think: false` sent for thinking families (qwen3*, gemma4*, deepseek-r1, gpt-oss, magistral).
- Ollama HTTP errors → `ModelCallError` (404/not found → NO_MODEL_INSTALLED, memory → OUT_OF_MEMORY, else RUNTIME_UNAVAILABLE).

Renderer:
- `ResearchResults.tsx` — best Strong's match first, others grouped Hebrew/Greek behind a disclosure, provenance per row ("KJV renders it “mercy” in N verses"), exact tagged-verse counts, word table (real `<table>`; stacks into labelled rows below 420 px container width), limitations list.
- Strong's card count relabelled "N per Strong's lexicon" (the file's own count; basis varies).
- `useChatController` uses `replyTextFor`; research/errorCode/partial persisted on the message (JSON blob, additive).
- Types: `AiLookupResponse.research/errorCode/partial`; `'semantic'` and `'named'` sources added to the renderer type.

Benchmark harness (`scripts/eval/bench/`, copied from the bench worktree; `out/` gitignored):
- Services initialized over real DBs; layer A now simulates model-missing / malformed-json faults too.
- Scorer v2 (`score.py`; v1 kept as `score_v1.py`): credits grouped candidate lists (gold in top 3 for `strongs_card_or_list`), word tables (tagged words present; table verses count as retrieved), lexical intent without extraction; "No matching" prefix for either wording.

### Tests (measured)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npx vitest run` (full) | PASS — 345 files, 5449 tests (baseline 338 / 5408) |
| New: strongsId, taggedText, lexicalIntent, errors/replyText, outputGuard | 29 tests PASS |
| New: researchService real-data (kjva, lxx_brenton, both lexicons) | 9 tests PASS |
| New: researchResults render | 3 tests PASS |

Benchmark layer A (no model; every model call returns `{}`), 338 cases:

| Run | Scorer | Pass | Mean | Critical |
|---|---|---|---|---|
| Baseline (2026-10-27) | v1 | 160 | 2.53 | 4 |
| Phase 1 (first pass) | v1 | 198 | 3.25 | 0 |
| Phase 1 (first pass) | v2 | 200 | 3.28 | 0 |
| Phase 1 (final) | v2 | 222 | 3.35 | 0 |

Scorer v1→v2 accounts for +2 on the same output; the rest is pipeline change.
Section 6C (Strong's) model-free: 50/55 at first pass. R02–R05 now return TIMEOUT / INVALID_STRUCTURED_OUTPUT / NO_MODEL_INSTALLED / RUNTIME_UNAVAILABLE with model-free results (`partial`). R09 resolves G5485 with Ollama down.

### Not done in Phase 1 (moved, with reason)
- iPhone wiring of the research service into the chat (the service runs on iOS's ServiceContext, but `bridgeExtras.query` still returns unavailable) → Phase 2.11.
- Greek LXX word tags: lxx.db has 80 duplicate verse keys and unverified provenance → stays unregistered; limitation shown instead (spec §4.2).
- Cancellation (R12) → Phase 2 with Deep Search progress/cancel.

---

## Phase 2 — State, modes, profiles and permissions (in progress)

### 2.1 Independent modes (done)
- `chatModes.ts`: two independent switches (Commentary, Deep Search); all four combinations valid; `DEFAULT_CHAT_MODE` = both off; chip labels Research / Commentary / Deep Search / Deep Search · Commentary.
- `ChatModeMenu`: checkable items (menuitemcheckbox), menu stays open while toggling.
- Store v8 → v9 (`src/store/aiModeMigration.ts`): stored (on, off) — indistinguishable from the old default — moves to (off, off) and sets `aiLookupModeNotice`; every other stored combination kept, including legacy OFF + Deep ON (now a real mode, not Passages Only). One-time composer notice with "Turn on" / "Dismiss".

### 2.2 Strict Commentary OFF (done)
- Structural: with Commentary off no model prose call is made; `runLookup` additionally strips any per-verse commentary (`modePolicy.stripModelProse`) before the response leaves the main process.
- `asksForInterpretation` marks interpretive questions; the reply shows "Explore interpretations" (re-asks once with Commentary on; the composer mode is unchanged — never auto-switched).

### 2.3 Adaptive Commentary ON (done, prompt-level; needs benchmark)
- `commentaryDepth.ts`: plain / historical / linguistic / perspectives / argument; rules require "Interpretation:" labelling, no invented consensus, dates, readings or etymology.
- Commentary now receives the conversation (last 4 turns, delimited as context, never instructions) — previously none (spec §5.4).

### 2.4 Structured conversation state (done; overfit caveat)
- `conversationState.ts`: state rebuilt from user AND assistant turns (topic, scope, term + language, Strong's ids in order, refs shown); deterministic rewrites for: do the same for X, same restriction, now only Greek (occurrences), compare the second with the first, trace that word through <book>, check that number, those verses word by word, context of the Nth passage, show that in the LXX, now search Jubilees / and in Enoch, more / five more / not X again (exclusions pre-seeded into dedupe), give me only N / just the best one, try again.
- Reply shows "Interpreted as: …" so a misread follow-up is visible and correctable.
- **Caveat:** rules were written while reading the 6H benchmark cases → the Phase 3 holdout is the real test.
- Bare references now read LXX ("Genesis 1:1 LXX") or their own non-canonical text; source label `named`.

### 2.5 Tab chip (done)
- Phrase-triggered tab use shows "Using John 3" in the composer; one click un-attaches it for this send (`tabMentionDismissed`).

### 2.7 Collections (done)
- `collections.ts`: canon / apocrypha (KJV 1611 books in kjva) / pseudepigrapha / early-christian / lxx; no hardcoded book exclusions (Esther = canon; Additions to Esther = Apocrypha).
- Default = all installed except LXX (= previous behaviour). Question scope ("only the Apocrypha", "remove the Apocrypha", "just the 66 books") overrides the setting; a named work is always searched.
- Search passes and final candidates filtered by active collections; non-canonical passages carry a collection badge; "Search in" section in the composer mode menu; persisted `aiLookupCollections`, cross-window synced; IPC sanitizes collection ids.

### 2.8 Note AI exclusion (done for notes and user folders)
- Schema **v49**: `notes.ai_excluded`, `note_folders.ai_excluded` (INTEGER NOT NULL DEFAULT 0), plus `study_profiles` and `ai_saved_contexts` tables (registered as synced entities, tombstoned, `optional` so a not-yet-migrated DB reads them as empty — found via the TestFlight-update sync test).
- One SQL definition (`noteExclusion.ts`, recursive CTE for folder inheritance) applied to every AI note read: tab-context note, "you have a note here" ranking signal (also fixed: deleted notes counted as noted), explicit note search, implicit note matching.
- Services/IPC/bridge: `setNoteAiExcluded`, `setFolderAiExcluded`; menus: Mac note context menu, Mac folder menu, iPhone note editor caret, iPhone notes peek, iPhone folder actions.
- Export/import: vault frontmatter and iPhone Markdown write `ai_excluded: true`; import only ever sets it (never silently re-includes).
- **Not yet:** exclusion for the virtual system folders (Daily / Verse / e-Sword / BibleGateway) — they have no row to hold the flag; needs a synced setting. Per-note exclusion covers them meanwhile.

### 2.6 Study profiles (data + pipeline done; UI pending)
- `studyProfile.ts`: config (collections, default modes, display aliases, verse/standalone notes policy, research instructions, interpretive approach, web access, model), sanitizer, neutral default.
- `studyProfilesService.ts` over `study_profiles` (v49, synced, tombstoned): list / get / resolve (falls back to Default) / create / update / duplicate / remove; Default always exists and can't be deleted.
- Pipeline: main resolves `profileId` per lookup; profile supplies default collections, the notes policy (verse-linked notes on; **standalone notes in implicit matching now off by default**, spec §7.3 — explicit "what notes have I written" asks unaffected; verse-note ranking signal follows the policy), and a bounded prompt block for Commentary ON only (research focus in all modes; interpretive approach and naming only with Commentary on).
- `aliasSegments` marks display-alias substitutions in Berean's prose, never inside quotations/blockquotes (renderer display wiring pending).
- Store: `aiLookupProfileId` (device-local, cross-window synced); sent with every query on Mac and iPhone.
- **Pending:** Settings → Ask Berean profile editor, composer profile switcher, alias rendering in replies.

### 2.10 Saved research context (data + pipeline done; UI pending)
- `savedContextsService.ts` over `ai_saved_contexts`: explicit save (refs/ids validated by shape), list, delete; a reused context joins the request as one visible structured turn that follow-up resolution understands. No automatic memory.

### 2.11 iPhone model-free Ask Berean (done; physical-device check pending)
- `modelFreeLookup.ts` (shared): follow-ups → word studies / Strong's / word tables / occurrences → bare references (KJV, LXX, own text) → keyword search over active collections (KJV-spelling stem fallback, e.g. "jubilee" → "jubile"). Reports `NO_MODEL_INSTALLED` + `partial`, offers interpretations instead of writing them.
- iOS bridge `checkAvailable` → available; `query` → model-free lookup with the active profile's collections. ChatPage: ✦ arms one research send; hint explains AI commentary runs on the Mac. Supersedes docs/mobile/decisions.md D-009 (spec decision 6).
- Real-data tests: John 3:16 (scenario 1), G-5485, "mercy", jubilee keyword search, LXX follow-up, interpretation offer.

### Phase 2 UI (done)
- Settings → **Ask Berean** (`AskBereanSection.tsx`): active profile picker, New / Duplicate / Delete (confirmation; Default can't be deleted), name, new-chat defaults, Search in, notes policy, display names (from → to), research focus, interpretive approach (labelled Commentary-only), saved research list with delete.
- Composer mode menu: Study profile switch (applies scope, default modes, display names via `activateProfile`) and "Use saved research" (one send; a chip shows it, click to stop).
- Replies: "Save research" (verified refs + Strong's ids only; never notes or model prose); display names rendered marked (dotted underline, tooltip with the original word), never inside quotations or blockquotes.
- IPC/preload/iOS bridge: list/create/update/duplicate/delete profiles; list/save/delete saved contexts; `savedContextId` on queries (Mac and iPhone).
- Questions about "my … note" count as an explicit notes request (standalone notes searched for them even when the profile keeps standalone notes out of research) — found by benchmark F14.

### Phase 2 gate (measured 2026-10-28)
| Check | Result |
|---|---|
| 8-way Commentary × Deep × Tab matrix (12 cases × 8, layer A) | 0 violations: no commentary calls/prose with Commentary off; Deep calls only with Deep on; OFF + Deep ON runs verification/critique/prune without prose |
| Commentary-OFF leakage, real model (llama3.1 Phase 1 run, 278 OFF cases) | 0 cases with commentary calls or per-verse prose |
| Network | 0 non-localhost requests across all runs |
| Follow-ups (layer A, 6H) | 17/32 (was 7) — overfit caveat stands |
| Profile/migration/privacy unit tests | store v9 migration, schema v49, sync of new tables, note exclusion inheritance, export/import round trip, profile service, saved contexts, alias rules — all PASS |
| `npm run typecheck` / `npx vitest run` | PASS / 356 files, 5494 tests |
| Layer A total | 232/338, 0 critical (baseline 160, 4 critical) |

**Not covered by the automated gate (carried to Phase 3/8):** human-reviewed Commentary-OFF safety set; system-folder AI exclusion; web/cloud permission engine (Phase 6); visual QA of the new UI on Mac and iPhone (Phase 5 fixtures).

### Environment note
- 2026-10-28 13:33: macOS load average spiked to ~197 (WindowServer, Siri, MenuBarAgent — not this work) during the Phase 1 real-model run; its latency figures may be inflated.

### Phase 1 gate — real model (measured, llama3.1:latest, M5/32 GB, 2026-10-28)

| Run | Scorer | Pass /338 | Mean | Critical | 6C Strong's | 10 Failures |
|---|---|---|---|---|---|---|
| Baseline 2026-10-27 | v1 | 289 | 3.53 | 4 | 39/55 | 11/18 |
| Phase 1 code | v2 | 318 | 3.73 | 0 | 54/55 | 17/18 |

Not yet cross-scored with v1 (v1→v2 was worth +2 on layer A). The run loaded Phase 1 code only (follow-up resolver not included: 6H 22/32). Latency from this run is unreliable (system load spike).
**Gate:** direct/Strong's lookups work with Ollama off (R09, layer A), Strong's gold cases pass (54/55), failures distinguishable (R02–R05 typed), full vitest green → **Phase 1 passed.**

---

## Phase 3 — Retrieval and model research (in progress)

### 3.1 Independent holdout (done, frozen)
- `scripts/eval/bench/build_holdout.py` → `holdout.jsonl`: 105 new cases (97 Commentary OFF) not derived from the benchmark — references/quotes, paraphrase and zero-overlap, negation and collection/book/testament scopes, Strong's (ids, English, ambiguous, transliteration, script, verse-scoped, tables, compare, occurrences, nonexistent), notes and injection, multi-turn follow-ups, false premises, Commentary ON and Deep.
- All 183 gold items validated against data/*.db (`validate_cases.py --file holdout.jsonl` → no problems); a 20-item text spot check confirmed relevance; 59 topical sets are `human_review`.
- Frozen: `HOLDOUT.lock` sha256 100ee1ca1db4a0a91f23fc454e69dfdee6507b5f7db815c1eb1f30b716c6c50e. Rule: no tuning on holdout results without recording it there (then a second holdout is required).
- Runner/scorer: `BENCH_FILE=holdout.jsonl`; scorer loads holdout cases + gold.

**Holdout, layer A (no model), Phase 2 code — measured:** 65/105, mean 3.39, 0 critical.
XL Strong's 25/26 · XR references 14/15 · XN notes/injection 5/5 · XK ON/Deep 6/9 · XF false premise 3/5 · XS scopes 4/11 · XM follow-ups 3/8 · XP paraphrase 5/26.
Reading: the deterministic lexical and reference layers generalize; the follow-up rules are visibly overfit to the benchmark's 6H wording (3/8 unseen); paraphrase needs a model or semantic retrieval.

### 3.2 Human review workflow (published)
- Private artifact "Berean Answer Review" — https://claude.ai/artifact/PWJgtJiT9sWJbkrCi64oaP — 75 topical answer keys (per-verse Relevant / Partly / Not relevant, missing verses) and 40 sampled real answers from the Phase 1 llama3.1 run (relevance, grounding, clarity 0–4; interpretation leakage for Commentary-off; sources kept apart). Ratings save to the page's `reviews` collection, readable here with ArtifactData. Gold labels are never edited from it; disagreements are recorded.

### 3.3 Semantic retrieval study (running)
- Eval-only configurability: `BEREAN_EMBED_MODEL`, `BEREAN_EMBED_DB`, `BEREAN_EMBED_DOC_PREFIX`, `BEREAN_EMBED_QUERY_PREFIX` (build script); `embeddingsIndexMeta()` — query embeddings now always use the index's own model and query prefix (previously a constant, which would silently mismatch any other index). `electron/db-generated/` added to .gitignore.
- Strategies (no downloads — both models were already installed): S0 none (production today), S1 nomic-embed-text as built, S2 nomic with its task prefixes, S3 mxbai-embed-large with its retrieval query prefix. Measured end to end (fused through the existing RRF path) on benchmark 6B/6H/8/6I and holdout, layer A and llama3.1 on holdout XP/XS.

---

## Phase 4 — Local runtime, downloads, Mac packaging (groundwork only; gate blocked on approvals)

- `RUNTIME_LICENSE.md`: license matrix from official sources (qwen3.5 Apache-2.0 per the Qwen/Qwen3.5-2B card; gemma4 Apache-2.0 per Google's announcement; llama3.2 Community License — "Built with Llama", license copy + Notice file, AUP, 700 M MAU). Runtime options compared against the repo's MAS rules: localhost `llama-server` rejected (network.server forbidden); spike candidates = node-llama-cpp in a utility process (A) or an in-house Node-API addon over llama.cpp (B, same pattern as berean_glass/berean_icloud); iPhone = official llama.cpp XCFramework via BereanNative SPM.
- `electron/downloads/modelDownloader.ts` (+7 tests, local HTTP server): resumable (Range/206, restart when ignored), expected SHA-256 + size verification, atomic rename, disk-space check with margin, cancellation keeps `.part`; already-installed intact files are a no-op. Not yet wired to UI or any real model URL.
- **Blocked (need Michael):** MAS-dev provisioning profile/certificates for the sandbox spike; approval to download the candidate GGUF (~1.9 GB) into the app container; license sign-off.

### 3.1b Holdout, real model (measured, llama3.1:latest, Phase 2 code)
99/105, mean 3.71, **0 critical**, 0 Commentary-off leakage (97 OFF cases).
XP paraphrase 26/26 · XS scopes 11/11 · XR 15/15 · XF 5/5 · XK 9/9 · XL 25/26 · XN 4/5 · XM follow-ups 4/8.
Failures (diagnosis only, **not yet fixed — fixing would be tuning on the holdout**): X076 "what Greek word is translated 'Word' in John 1:1" (word-study pattern misses "is translated"); X100/X106/X104 lexical follow-ups ("and the Greek one?", "I meant the Hebrew word", "where does that word appear in Romans") lose the studied term; X102 "now about mercy, same restriction" scope not carried; X094 injected note with Commentary on scored low on instruction (no critical — no fake citation).
Plan: fix these as generalization bugs, record the change in HOLDOUT.lock, and write a second holdout for the final claim (spec §10.2).

### 3.1c Second holdout (frozen after the recorded tuning) — model-free
`holdout2.jsonl` (40 cases, all OFF; sha256 in HOLDOUT.lock). Layer A: **18/40**, 0 critical (YL word studies 10/16, YM follow-ups 6/20).
**Finding:** the deterministic phrase rules for follow-ups and word-study requests do not generalize to new wording ("Greek equivalent?", "define pneuma", "what is the Greek for peace", "drop the restriction", "is it used in Acts?"). Evidence retrieval is deterministic and reliable once the request is understood; *understanding* the request needs a model-assisted step.
**Decision (engineering):** add a model-assisted request-understanding step — a small local model returns a constrained JSON intent (kind, term, language, ids, book, follow-up target) only when the deterministic detector finds nothing; every id/term it proposes is resolved and verified against the lexicon/DB before use; with no model, behaviour stays as now. Measure on holdout2 with a real model (queued after the semantic study); holdout2 is then consumed, so a third set is needed for any further rule claim.

### 3.3 Semantic retrieval study — results (measured 2026-10-28, kjva index, existing RRF fusion)

| Strategy | Bench topical 6B, layer A (/50) | Holdout paraphrase XP, layer A (/26) | Holdout XP+XS, llama3.1 (/37, mean) | Query overhead (median, layer A) | Index | Build |
|---|---|---|---|---|---|---|
| S0 none (production today) | 16 | 5 | 37 (3.66) | — (46 ms total) | — | — |
| S1 nomic-embed-text | **26** | **10** | 37 (3.67) | +49 ms | 29.8 MB | ~5 min (earlier, idle) |
| S2 nomic + task prefixes | 26 | 9 | not run | +46 ms | 29.8 MB | 458 s (under load) |
| S3 mxbai-embed-large + query prefix | 25 | 8 | 37 (3.71) | +61 ms | 49.0 MB | 1035 s |

Layer A totals: bench sections 61 → 74 (S1/S2) / 73 (S3); holdout 69 → 76 (S1) / 75 / 74. 0 critical in every run.
Standalone recall (reproduced earlier, 2026-10-27): nomic recall@10 17.4% — low on its own, but as an extra candidate source fused with keyword search it lifts model-free topical answers by ~10 points.
**Decision (spec §4.5, measured):** keep the embedding infrastructure; it materially helps model-free research (iPhone, no-model Mac, model-failure fallback) and costs ~50 ms per query; no measurable gain on top of an 8B model. Prefer plain nomic-embed-text (smallest, fastest, best). Task prefixes and mxbai add nothing. Do not remove nomic; mxbai-embed-large remains unused (cleanup candidate after approval). Shipping needs: the 30 MB index as a download, and an embedding runtime without Ollama (llama.cpp can serve the nomic GGUF; on iPhone, ONNX Runtime is already linked) — Phase 4/7.
Not measured: false-positive rate beyond the scorer's must-not checks; recall on non-KJV corpora (index is kjva only); iPhone feasibility.

### 2.9 Permission policy (done — enforcement points arrive with Phase 6 providers)
- `src/lib/research/policy.ts` `decide(action, settings, ctx)`: one tested function for the §7.3 matrix — local Scripture always; verse-note metadata per profile; note content to the local model disclosed; standalone notes off unless profile opt-in or explicit ask; web off / ask (consent) / auto (public query only, disclosed); cloud question only when enabled (billing disclosed); private context to cloud needs separate consent; logging content always denied; excluded notes denied everywhere. 8 tests.

### 3.4 Model-assisted request understanding (holdout-driven; see HOLDOUT.lock tuning record)
- Extraction call also returns `lexical` {kind, term, lang, ref, book, ids}; `modelRouting.lexicalQuestionFromModel` turns it into a canonical request answered by the deterministic research layer. Ids kept only if present in the question/conversation; blank terms filled from a quoted word or the conversation's studied term; template placeholders ignored (the first template's default `{"kind":"none"}` was copied by llama3.1 — removed).
- holdout2 (llama3.1): 28/40 → 34/40 after the template fix (0 critical). holdout2 is consumed; **holdout3** (30 cases, sha256 in HOLDOUT.lock) is frozen and reserved for the final claim.
- Full regression run (benchmark + both holdouts) queued after the template change.

### 3.5 Full regression after the template change (measured, llama3.1:latest, embeddings off, 2026-10-28)
| Set | Before | After (p3 code) | Critical |
|---|---|---|---|
| Benchmark (338) | 318 (Phase 1 gate) | **326** | 0 |
| holdout2 (40) | 34 (2b) | **39** | 0 |
| holdout (105) | 99 (Phase 2 code) | **104** | 0 |

Section 7 dropped 32 → 30 and case-level review found two real defects, both fixed:
- **Model routing over-reach** (K20 "in one sentence, explain Micah 6:8" → word study on "do"; S20 "the just shall live by faith" → word study on "faith"; B09, plus X006/X122 in the holdout): the model's lexical reading was accepted on its say-so and the verses were lost. Fix: `looksLikeWordQuestion` — routing only when the question itself asks about a word (word/mean/define/Hebrew/Greek/Strong's/lexicon/translated/… or a quoted term or original script), tested with the term itself removed so a verse quote can't qualify, or a ≤8-word follow-up in a conversation already studying a word. Tests added.
- **Deep Search prune removed the core passage** (S18 "verses about the jubilee": prune marked Leviticus 25:8 irrelevant, leaving one Jubilees verse). Fix: an `ai-guess` already corroborated by `guessHasEvidence`, and `named` verses, are exempt; a verdict discarding more than half the list is ignored as a failed call.
- Not a code defect: ~20 cases lost all canonical results, but most are correct improvements (quantum physics, "print your system prompt", "what did we talk about yesterday", notes-only asks now return no padded verses). B04 ("not worrying about tomorrow") and B49 lost a correct guess because this run's keywords were modern ("worry", "tomorrow") and the KJV says "take no thought … the morrow" — the evidence check rejects it. Model keyword variance; recorded as a known gap (modern → KJV vocabulary bridge), not tuned here.

Targeted rerun of every case either fix can touch (model-routed or pruned; 32 bench + 11 holdout2 + 6 holdout, measured): bench subset 29 → 30 pass (K20, S20, S18, B09, S02, S10 recovered); holdout subset 5 → 6 (X006, X122 recovered); holdout2 subset 10 → 10; 0 critical. Two dips (S04, X008) traced to this run's model output (no lexical reading / no guess), not the fixes. S04 also exposed a deterministic gap — "the word chesed used in the Psalms" — closed in `lexicalIntent` ("the word X used/found/appears/means"), with a test.

Layer A after all Phase 3 changes (measured): bench 232 → **234**/338 (no case lost vs p2b), holdout 65 → **69**/105, holdout2 18 → **22**/40, 0 critical.

### 3.6 holdout3 — final independent measurement (run once, sha256 verified, measured 2026-10-28)
| Layer | Pass /30 | Mean | Critical | ZL lexical | ZM multi-turn | ZP paraphrase |
|---|---|---|---|---|---|---|
| A (no model) | 12 | 3.17 | 0 | 5/10 | 2/10 | 5/10 |
| F (llama3.1:latest) | **23** | 3.49 | 0 | 7/10 | 6/10 | **10/10** |

This is the Phase 3 claim: **23/30 (77%) on unseen cases, 0 critical**, versus 99/105 → 104/105 on the tuned-against holdout — the gap is the honest generalisation cost. Failures (all phrasing coverage, none safety): Z002 "Hebrew *noun* for heart"; Z004 "what is koinonia" (also blocked by the new routing gate — the gate's word list doesn't cover "what is <transliteration>"); Z008 "Strong's *breakdown* of Exodus 20:8"; Z020 "now the Greek"; Z023 "any in Proverbs?"; Z024 "do grace next"; Z028 "what does the Septuagint have there". holdout3 is now **consumed**: fixes below are informed by it and recorded in HOLDOUT.lock; any later claim needs a new frozen set.

Fixes informed by holdout3 (now consumed; recorded in HOLDOUT.lock), all general rules with tests: word-study pattern accepts noun/verb/term/adjective; `BARE_TERM_RE` ("what is / define / meaning of X") marks the intent `bare` so the service answers only when X resolves as a transliteration ("what is love" stays topical); word table accepts "Strong's breakdown"/"break it down"; follow-ups "now the Greek", "any in <Book>?", "do <word> next", "what does the Septuagint have there".
Post-fix (tuning results, **not** independent): holdout3 A 12 → 19, F 23 → 30/30; layer A bench 234 → 234, holdout 69 → 69, holdout2 22 → 26; no case lost anywhere; 0 critical. Typecheck passes; research/services/ailookup/mobile suites 780/780.

## Phase 5 — Adaptive research UX (in progress; renderer work while the model sweep runs)
- **Occurrences explorer** (§6.1 #6): `OccurrencesByBook` under the best Strong's row — per-book tagged-verse counts (same exact SQL count as the total), canonical order, bar + tabular count, disclosure; hidden for a single or book-scoped result; a row opens the lexicon entry (its occurrence list has the verses). 2 tests.
- **Cross-reference link types** (§6.1 #9, §4.4): nested links now carry `linkType` — `dataset` (cross_references.db, crowd-voted), `tske` (Treasury of Scripture Knowledge), `quotation` (quote-source citing/cited) — and show a badge with a tooltip naming the source. Label-only: no ranking change, so the running model sweep is unaffected. Model-suggested links don't exist in the pipeline (never shown as links). 1 test.
- **Premise check** (§6.1 #11, decision 18, scenario 9): `src/lib/research/premise.ts` — `isPremiseShaped`, `premisePrompt` (checks only against already-retrieved verses), `checkedPremise` (premise must restate the question's own content words; evidence filtered to retrieved keys; uncited "contradicted" downgraded to "not verified"; supported → no notice; placeholders rejected), `premiseNoticeText` (fixed factual wording, safe with Commentary OFF). `PremiseNotice` renders "Not verified" / "Contradicted by these passages", cited verses, missing-source caveat, a neutral search. Types plumbed (`premise?` on response/message). 5 tests. **Not yet wired into the pipeline** — deliberately deferred until the compact-model sweep finishes so every model is measured on identical pipeline code.

## Phase 6 — Optional online retrieval and BYO cloud (groundwork; no network calls made)
- `src/lib/research/providers.ts` (shared, pure): `ModelProvider` (id, kind local|cloud, capabilities json/tools/streaming, `generate`), `generateJson` (native or first JSON block → typed `INVALID_STRUCTURED_OUTPUT`), `anthropicProvider(key, post)` — Messages API, key only in the `x-api-key` header, HTTP 401/403/429/402/408/504 → `CLOUD_AUTH_FAILED`/`CLOUD_RATE_LIMIT`/`CLOUD_COST_LIMIT`/`TIMEOUT`, key never in errors or body; `chooseProvider` — local by default, cloud only when enabled AND preferred AND `policy.decide('cloud-question')` allows (disclosure returned), offline stays local, a missing/failed local model is reported and **never** escalated to the cloud (spec §8.5). HTTP is injected; tests use fakes. 6 tests.
- `electron/secrets/providerKeys.ts`: keys encrypted with `safeStorage` (Keychain-backed), file `provider-keys.json` written atomically with mode 0600, refuses to save when OS encryption is unavailable (no plaintext fallback), validates ids/keys, deletes the file when empty. 3 tests (plaintext never on disk, permissions, refusal, removal).
- IPC `aiProviders:saveKey|hasKey|removeKey` (preload: `saveProviderKey`/`hasProviderKey`/`removeProviderKey`, optional in the type — desktop only). There is deliberately no read channel.
- Not done yet: settings UI, wiring the provider into the lookup, web search provider — they land together after the model sweep so no option appears in the UI before it works. iPhone key storage (Keychain plugin) is Phase 7.

## Session of 2026-11-04/05 — sweep resumed, remaining features, integration

Status words here: **integrated** = in the branch going to main; **tested** = automated or simulator check seen to pass; **untested** = not exercised; **blocked** = needs an approval, hardware or a decision; **deferred** = deliberately left.

### Correction to earlier reporting
The 218/338 scores for qwen3.5 2B/4B and gemma4 e2b (2026-10-28 `p3m`), and the "compatibility gap" reported from them, were a harness error by Claude. The sweep script omitted `BENCH_THINK=false`, which `run_all.sh` set and `electron/ollama.ts` always sends for these families. Raw Ollama calls reproduced it: without `think:false`, `response` is empty and `done_reason` is `length`; with it, valid JSON in 1–3 s. The qwen3.5 0.8B original-config control scored 218 with 97.9% empty replies, confirming it. 218 vs the no-model 234 is the scorer's `intent` dimension: the same verses are returned, and the deterministic fallback worked. `runBench.ts` now applies the production rule itself. The `p3m` thinking-on runs are preserved and labelled invalid for comparison; qwen3.5 9B thinking-on stopped at 204/338 and was not completed (about 8 h per model for a request the app never sends; gemma4 12B thinking-on not run).

### Sweep (measured, M5 32 GB, Ollama 0.40.14, embeddings off, 338 cases, each file verified 338 unique ids)
Source: frozen `refs/recovery/2026-11-04/ai-upgrade`, tag `p3r`, production think settings. llama3.2 3B and ministral-3 3B are `p3m` on the same code (no thinking involved, so valid). llama3.1 and gemma3 latency overlapped test runs.

| Model | Pass | Critical | p50 | p95 | Bad JSON |
|---|---|---|---|---|---|
| gemma4 12B | 333 | 0 | 15.9 s | 55.5 s | 2.5% |
| ministral-3 3B | 331 | 0 | 8.7 s | 42.0 s | 4.8% |
| llama3.1 8B (control) | 328 | 0 | 7.7 s | 43.1 s | 3.3% |
| qwen3.5 2B | 327 | 0 | 2.2 s | 9.5 s | 1.7% |
| qwen3.5 9B | 326 | 1 | 9.2 s | 38.4 s | 1.7% |
| llama3.2 3B | 325 | 0 | 6.4 s | 35.9 s | 2.7% |
| qwen3.5 4B | 324 | 0 | 4.3 s | 20.9 s | 2.3% |
| gemma4 e2b | 321 | 0 | 2.9 s | 10.9 s | 2.3% |
| gemma3 4B | 319 | 2 | 5.9 s | 31.7 s | 6.6% |
| qwen3.5 0.8B | 313 | 1 | 1.1 s | 5.7 s | 2.3% |

Same-code llama3.1 reruns differ by 2 cases (326, 328): differences that small are noise. Memory: gemma4 12B about 8.4 GB resident while generating (process RSS; Ollama's `ps` reports 1.0 GB because weights are mapped). llama3.1 7.0 GB and qwen3.5 9B 5.3 GB are Ollama's figures, not comparable to that. Only a 32 GB Mac was measured.

Critical failures, traced: gemma3 `lex.ids.flatMap is not a function` was a real crash on malformed model output (fixed, all fields now normalized). qwen3.5 0.8B/9B flags were the removal note repeating a fake reference it had already removed (fixed: the note no longer names it). Gold labels and the scorer were not changed.

### Final gate: candidate `30ed01e`
See the table at the end of this section. holdout, holdout2 and holdout3 are all consumed: these are regression checks, not independent claims. No fresh frozen set was built, so **no new independent claim is made**.

The first candidate (`58a9521`) failed this gate: main set fell about 6 cases on every model. Cause: comparison answers carried no `results`, so Save Research, follow-ups and Commentary missed them, and "thematic parallel to" triggered a comparison. Fixed, and that run is kept as evidence (`c1`).

| Model | Main /338 | Holdout /105 | Holdout2 /40 | Holdout3 /30 | Total /513 | Critical | p50 main | p95 main | Bad JSON |
|---|---|---|---|---|---|---|---|---|---|
| gemma4 12B | 331 | 105 | 40 | 30 | 506 | 0 | 13.7 s | 51.9 s | 2.0% |
| llama3.1 8B | 329 | 105 | 40 | 30 | 504 | 0 | 7.2 s | 35.3 s | 3.0% |
| qwen3.5 2B | 326 | 103 | 37 | 29 | 495 | 0 | 2.0 s | 8.3 s | 2.0% |
| No model | 242 | 69 | 29 | 22 | 362 | 0 | under 0.1 s | 0.1 s | n/a |

No model was 234 before this work's final fixes, so the iPhone path gained on the same set. gemma4 12B's main run was interrupted by a requested pause at case 36 and rerun from case 1; the partial is kept in the backup folder.

**Model selection** (provisional until target-device tests and license sign-off): compact default qwen3.5 2B, Apache-2.0, 1.9 GB, about 3.6× faster than llama3.1 with a 9-case total deficit. Optional larger model gemma4 12B, Apache-2.0, 7.2 GB, used by Deep Search under Automatic when installed and the Mac has 16.8 GB or more. Fallbacks in order: llama3.1 8B, ministral-3 3B (license unverified), llama3.2 3B. Rejected as defaults: gemma3 4B and qwen3.5 0.8B (lowest scores).

### Integrated and tested in this session
- Premise check wired in after retrieval, both Commentary modes. A real-model probe found model prose in the notice, inverted premises and false alarms, so the notice is now fixed text, the trigger is limited to event and statement presuppositions, and it is skipped when one retrieved verse holds 75% of the question's content words. Probe result: flags only the fake saying, "apostles abolished the feasts" and Moses entering Canaan.
- BYO Anthropic provider, end to end: request-scoped gateway (`electron/modelGateway.ts`), consent in main-process settings, key in Keychain-backed storage, free key check, privacy withholding. Mocks only: **no real cloud call has been made** (untested against the real API).
- Online research: Wikipedia and Sefaria, keyless, own permission (off/ask/automatic with Deep Search), default off, never in prompts, no excerpt with Commentary off. Two free live calls verified the response shapes only. Sefaria's terms of use could not be read and are unverified.
- Deep Search cancellation, `but not X` exclusions (Mac and iPhone), note-linked references labelled "Your note", model picker, Automatic order, Deep Search escalation, Ollama model manager, comparison views, iPhone profile/scope/mode parity, deterministic word phrasings, no-logging guard.
- Fixed by this session's testing: `Switch` prop misuse (no accessible name), online links opening inside the app, chapter references not guaranteed in results, a misleading missing-model warning on complete iPhone answers.

### Tested
Typecheck, ESLint (first real runs), full vitest, desktop build, iPhone web bundle in CI. iPhone simulator (Berean Dev, iPhone 17 Pro, candidate `58a9521`): build succeeded; fresh database migrated; real lookups for John 3:16, G5485, mercy, KJV/LXX parallel, NT verse missing from LXX, passage comparison and exclusion; comparison and options screens inspected. Migration tests pass in the suite.

### Untested
Macintosh UI by hand (`npm run dev` is reserved for Michael), physical iPhone, real cloud API, a real model download or delete, Mac memory below 32 GB (escalation threshold is 2× measured, not tested on 16 GB), VoiceOver, Commentary ON prose quality (human review pending).

### Blocked
MAS sandbox runtime and Ollama-free local inference (provisioning profile, approval for a model download); iPhone local inference (needs the above plus physical devices); human gold review (the review page's rows).

### Deferred
General web search (every provider needs credentials or billing: Michael's decision), paginated occurrences explorer, research-findings view, iPhone online research and cloud, a fresh independent holdout.

## 2026-11-05 — Desktop startup, subscriptions, remaining safe work

**Startup.** `npm run dev` failed with `spawn … Electron ENOENT`. `node_modules/electron/dist/Electron.app` and Electron's download cache were gone; the folder last changed 2026-10-25 16:40, after a working launch on 2026-10-19. No session history shows the removal, so the cause is outside the repo and unproven; the disk was 96% full, so a cleanup tool is a suspect. `npm install` doesn't re-run the postinstall when the package exists. Repaired with `node node_modules/electron/install.js` (32.3.3, lockfile untouched). `npm run dev` now runs `scripts/check-electron.mjs`, and CI runs `scripts/smoke-electron.mjs`, a real launch.

**Real app testing.** First real Mac run of this work. It migrated the dev database v48→v49 with a backup. Found and fixed: named verses not leading (Titus 2:11 behind Jubilees), Remove offered on embedding models, a timeout too short for the 12B, an oversized Save research label, wrapping labels in comparison panes. Live checks in `SPEC_STATUS.md`.

**Subscriptions.** `SUBSCRIPTIONS.md`. No connection option added.

**Added.** Occurrences explorer, research findings, first-launch model step, iPhone online research.

