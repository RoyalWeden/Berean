# Berean AI Mode Audit and Model Benchmark — Report (spec v2)

Run: 2026-10-27 13:20 → 2026-10-28 03:17, Apple M5 / 32 GB / macOS 27.2, Ollama 0.40.11.
Worktree `/Users/roywe/Berean-ai-bench` (branch `eval/ai-benchmark`, from main 1b18826). Nothing committed; main checkout untouched; no production code, prompt, default, DB, setting or migration changed; no model deleted; no paid API; no non-localhost network call (network guard: 0 across all runs); synthetic notes/videos only; no physical iPhone.

Labels: **[M]** measured here · **[E]** estimated · **[I]** inferred from code/docs · **[U]** unavailable / not tested.

---

## A. Executive summary

1. **Most failures are pipeline, not model.** With the model stubbed to `{}` (layer A) the app already passes 135/278 commentary-OFF cases [M]. Of the 31 cases failed by ≥8 of 10 models, every one traces to missing deterministic capability or app error handling, not model choice [M]: no word-by-word Strong's tag output (C11–C17, H13), wrong word→Strong's mapping (mercy→H2580 instead of H2617/G1656, holy, mammon, chesed, agape), "No matching verses found" shown when Ollama fails (R02–R05), and Strong's lookup unavailable when Ollama is down (R09).
2. **The extraction prompt's example `"strongsNum": "H2580"` (aiLookup.ts:811) is being copied** by small models: gemma4 e2b 115×, qwen3.5 2B 83×, llama3.2 3B 74× where gold ≠ H2580 [M]. Single largest model-attributable Strong's defect; fixable in the prompt + deterministic lookup.
3. **Mode discipline is perfect:** 0 unsolicited commentary in 278 OFF cases for all 10 models [M]. The 8-way mode matrix (Commentary × Deep × Tab, llama3.1, 12 cases) showed no routing anomaly [M].
4. **Thinking models are unusable as-is:** qwen3.5 4B and gemma4 e2b at production settings returned 0/15 valid JSON (empty response; thinking consumes num_predict) [M]. With `think:false` they reach 98.8–99.5% [M].
5. **A deterministic router beat every model at tool choice:** rules 299/337 vs best model gemma4 12B 282/337 [M] (overfit caveat: rules written after seeing cases).
6. **Embeddings are not needed now.** The index has never shipped (packaged build returns null) [I]; built here, nomic standalone recall@10 = 17.4%, 0/7 zero-overlap hits [M]. nomic-embed-text and mxbai-embed-large are unused at runtime.
7. **Recommendation (pending your approval):** default Mac + iPhone model **qwen3.5 2B (q4_K_M)** conditional on the deterministic fixes and a re-benchmark (fallback **llama3.2 3B**, the only small model clearing the OFF gate today); optional larger Mac model **gemma4 12B**; deterministic-first pipeline; replace Ollama with a bundled llama.cpp runtime + in-app GGUF download; drop the embedding stack.

## B. Mode inventory [I — code]

| Entry / mode | Where | Behaviour |
|---|---|---|
| Commentary (store default) | chatModes.ts | commentary ON, agentic OFF |
| Deep Search | chatModes.ts | commentary ON, agentic ON: verification loop (≤3) → critique → prune, same model |
| Passages Only | chatModes.ts | commentary OFF, agentic OFF |
| Commentary OFF + Deep ON | legacy persisted state only | not selectable; still sent as stored |
| Include This Tab | composer toggle | tabContext sent when toggle on OR `mentionsCurrentTab` phrase matches |
| ⌘Return | ChatComposer.tsx:158-205 | always asks AI |
| Return with ✦ armed | ChatComposer | asks once |
| Bare reference | parseRef | model-free |
| `QUOTE_TRIGGER` | aiLookup | model-free quote lookup |
| Explicit notes / video asks | aiLookup | deterministic collection |
| Strong's id (G/H number) | aiLookup | resolved AFTER availability check → fails when Ollama down |
| History | useChatController.ts:305-375 | renderer sends 8 msgs incl. "(my note)" / reply target; main keeps last 6; commentary gets none |
| Word-replacer | aiLookup | used for search variants only; not applied to model summary text |
| iPhone | bridgeExtras.ts:236, ChatPage.tsx:61 | AI disabled |
| Errors | aiLookup | only `ollama-unavailable` has its own message; `ollama-request-failed` → "No matching verses found — try rephrasing." |

Store: `aiLookupCommentaryOn` (default true), `aiLookupAgenticOn`, `aiLookupUseTabContext` persisted + cross-window synced (store/index.ts:2069-2071, :3544). Renderer never sends `opts.model` or `textId`.

## C. Mode interaction matrix [M — llama3.1, 12 cases × 8 combos]

Cases A02 B04 B40 C38 D16 E02 F01 F13 G11 H01 I16 K03.

| C D T | Calls observed | Matches expectation |
|---|---|---|
| 0 0 0 | extraction only (A02/D16 none: deterministic) | yes |
| 0 0 1 | same; tab sent only where a tab fixture exists (F13, G11) | yes |
| 0 1 0 | extraction + verification(1–2) + critique + prune, **no commentary** | yes — but 4–5 model calls with no prose shown (legacy-only state) |
| 0 1 1 | as above + tab | yes |
| 1 0 0 | extraction + commentary | yes |
| 1 0 1 | + tab | yes |
| 1 1 0 | extraction + verification + critique + prune + commentary | yes |
| 1 1 1 | + tab | yes |

Tab sent with toggle off on F13/G11 because the question says "this chapter" — intended `mentionsCurrentTab` behaviour. Shortcut paths (⌘Return/✦) and new-vs-follow-up are exercised by the 6H history set (32 cases) and code inspection, not UI automation [I].

## D. Coverage [M]

355 cases generated, 338 runnable end-to-end (17 static/code-inspection). **Commentary OFF 278 of 338 runnable (82%)** / 294 of 355 total; ON 60; Deep 26; multi-turn 33; history set 32; fault injection 18. All gold refs and Strong's ids resolved against data/*.db (505 items; only GEN 99:1 intentionally nonexistent).

| Section | n | Section | n |
|---|---|---|---|
| 6A refs | 35 | 6G | 12 |
| 6B topical | 50 | 6H history | 32 |
| 6C Strong's | 55 | 6I honesty | 22 |
| 6D | 17 | 7 commentary | 34 |
| 6E | 16 | 8 deep/partial | 26 |
| 6F | 21 | 10 faults | 18 |

## E. Baseline retrieval [M]

Existing eval (unchanged from 2026-10-24, identical with the embedding index present because the eval mocks Ollama): recall@1 75.9%, @3 83.5%, @5 83.5%, @10 84.8%, MRR 0.792. Weak: strongs 25%/38%, zero-overlap 0%/29%. Strong's id resolution 5/8.
Semantic standalone (nomic, kjva index 36,890 verses, built 305 s, 29.8 MB): recall@5 13.0%, @10 17.4%, 66 ms/query; all 7 zero-overlap cases missed.
Full pipeline end-to-end with semantic fused in: **[U] not run**.

## F. Candidates [M sizes; I/E capabilities]

| Model | Disk | RSS loaded @16K ctx | Context (Ollama page) | License |
|---|---|---|---|---|
| llama3.1 8B (current) | 4.9 GB | 6.66 GB | 128K | [U] not verified |
| gemma3 4B | 3.3 GB | 4.57 GB | 128K | [U] |
| llama3.2 3B | 2.0 GB | 3.77 GB | 128K | [U] |
| ministral-3 3B | 3.0 GB | 4.60 GB | 256K | [U] |
| qwen3.5 0.8B | 1.2 GB | 1.27 GB (Ollama /api/ps; runner RSS not captured) | 256K | [U] |
| qwen3.5 2B q4_K_M | 1.9 GB | 2.26 GB | 256K | [U] |
| qwen3.5 4B q4_K_M | 3.3 GB | 3.91 GB | 256K | [U] |
| qwen3.5 9B q4_K_M | 6.6 GB | 6.88 GB | 256K | [U] |
| gemma4 e2b QAT | 4.3 GB | 4.37 GB | 128K | [U] |
| gemma4 12B QAT | 7.2 GB | 7.88 GB | 256K | [U] |

RSS = llama-server resident set, one model loaded, after a 64-token generation. Ollama's /api/ps under-reports gemma4 (0.37 / 1.02 GB) — not used.

## G. Results by model and mode [M, automated scorer; pass = score ≥3.0 and no critical]

### G1. Commentary OFF / ON / Deep + latency

| Model | OFF pass | OFF ≥3 | ON pass | Deep pass | Crit | JSON valid | OFF med / p90 s | ON med / p90 s | tok/s |
|---|---|---|---|---|---|---|---|---|---|
| gemma4 12B | 257/278 | 92% | 57/60 | 26/26 | 4 | 99.8% | 17.6 / 28.8 | 51.6 / 79.6 | 10 |
| llama3.1 8B | 240/278 | 86% | 49/60 | 23/26 | 4 | 99.1% | 6.6 / 8.5 | 31.0 / 53.0 | 16 |
| llama3.2 3B | 235/278 | 85% | 54/60 | 24/26 | 4 | 98.2% | 4.4 / 6.4 | 20.2 / 35.5 | 27 |
| gemma3 4B | 234/278 | 84% | 50/60 | 23/26 | 4 | 97.0% | 10.0 / 14.9 | 29.2 / 43.0 | 20 |
| qwen3.5 9B | 234/278 | 84% | 45/60 | 24/26 | 4 | 99.8% | 8.1 / 13.3 | 24.1 / 42.1 | 16 |
| qwen3.5 4B | 233/278 | 84% | 46/60 | 23/26 | 5 | 98.8% | 4.9 / 8.7 | 22.7 / 36.7 | 20 |
| ministral-3 3B | 232/278 | 83% | 57/60 | 25/26 | 5 | 98.6% | 6.1 / 10.5 | 19.6 / 35.2 | 30 |
| gemma4 e2b | 229/278 | 82% | 49/60 | 21/26 | 4 | 99.1% | 2.6 / 4.4 | 7.8 / 15.3 | 56 |
| qwen3.5 2B | 226/278 | 81% | 53/60 | 24/26 | 4 | 99.5% | 2.3 / 3.0 | 7.7 / 13.6 | 55 |
| qwen3.5 0.8B | 217/278 | 78% | 45/60 | 20/26 | 6 | 98.8% | 1.0 / 1.2 | 3.9 / 7.2 | 88 |
| (no model, layer A) | 135/278 | — | — | — | 4 | — | — | — | — |

qwen3.5 / gemma4 with `think:false`. Latency excludes fault-injection cases.

### G2. By section (pass)

| Model | 6A | 6B | 6C | 6D | 6E | 6F | 6G | 6H | 6I | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemma4 12B | 35/35 | 49/50 | 45/55 | 17/17 | 16/16 | 21/21 | 12/12 | 29/32 | 21/22 | 31/34 | 26/26 | 12/18 |
| llama3.1 | 33 | 49 | 39 | 17 | 16 | 21 | 11 | 22 | 21 | 26 | 23 | 11 |
| llama3.2 3B | 34 | 48 | 32 | 17 | 16 | 21 | 11 | 24 | 19 | 30 | 24 | 13 |
| gemma3 4B | 34 | 50 | 26 | 17 | 16 | 21 | 12 | 25 | 21 | 27 | 23 | 12 |
| qwen3.5 9B | 34 | 50 | 34 | 17 | 13 | 19 | 12 | 23 | 20 | 22 | 24 | 11 |
| qwen3.5 4B | 34 | 48 | 33 | 17 | 14 | 20 | 11 | 23 | 20 | 25 | 23 | 11 |
| ministral-3 3B | 35 | 50 | 31 | 17 | 13 | 20 | 11 | 22 | 21 | 32 | 25 | 12 |
| gemma4 e2b | 34 | 46 | 31 | 17 | 15 | 20 | 12 | 22 | 20 | 29 | 21 | 11 |
| qwen3.5 2B | 33 | 50 | 27 | 17 | 14 | 20 | 10 | 22 | 21 | 28 | 24 | 13 |
| qwen3.5 0.8B | 30 | 46 | 26 | 17 | 14 | 20 | 9 | 22 | 20 | 27 | 20 | 11 |

### G3. Extraction (Strong's field) [M]

| Model | Extraction calls | H2580 copied (gold ≠ H2580) | strongsNum emitted on non-Strong's cases |
|---|---|---|---|
| gemma4 e2b | 298 | 115 | 167 |
| qwen3.5 2B | 297 | 83 | 87 |
| llama3.2 3B | 297 | 74 | 206 |
| gemma3 4B | 298 | 8 | 213 |
| llama3.1 | 297 | 13 | 10 |
| gemma4 12B | 297 | 10 | 4 |
| ministral-3 3B | 295 | 8 | 2 |
| qwen3.5 0.8B | 298 | 7 | 0 |
| qwen3.5 4B | 298 | 1 | 4 |
| qwen3.5 9B | 297 | 3 | 2 |

### G4. Tool use (layer E router, 337 cases) [M]

| Router | Right tool | Strong's id arg correct | Median ms |
|---|---|---|---|
| **RULES (deterministic)** | **299** | n/a | 0 |
| gemma4 12B | 282 | 28/34 | 3911 |
| qwen3.5 4B | 278 | 24/32 | 1689 |
| qwen3.5 9B | 278 | 32/37 | 2926 |
| gemma4 e2b | 267 | 28/34 | 944 |
| ministral-3 3B | 260 | 24/27 | 1039 |
| llama3.1 | 254 | 41/53 | 2120 |
| gemma3 4B | 249 | 26/36 | 1663 |
| llama3.2 3B | 248 (JSON 335/337) | 25/31 | 886 |
| qwen3.5 2B | 234 | 28/40 | 1006 |
| qwen3.5 0.8B | 214 | 21/46 | 339 |

### G5. Commentary replay on frozen inputs (layer D, 59 commentary + 23 prune prompts) [M]

| Model | Commentary JSON | perVerse key outside supplied records | Median words | >60 words | Prune schema | Pruned a gold verse |
|---|---|---|---|---|---|---|
| gemma4 12B | 57/59 | 0 | 31 | 1 | 22/23 | 0 |
| qwen3.5 9B | 57/59 | 0 | 33 | 5 | 23/23 | 0 |
| gemma4 e2b | 58/59 | 1 | 25.5 | 0 | 23/23 | 0 |
| qwen3.5 4B | 56/59 | 3 | 22 | 1 | 23/23 | 1 |
| ministral-3 3B | 55/59 | 3 | **56** | **26** | 23/23 | 2 |
| qwen3.5 2B | **59/59** | 7 | 29 | 0 | 23/23 | 0 |
| qwen3.5 0.8B | 51/59 | 7 (incl. "BOOKID CHAPTER:VERSE") | 26 | 1 | 23/23 | 4 |
| llama3.1 | 56/59 (truncated at num_predict 512) | 7 | 13.5 | 0 | 23/23 | 0 |
| llama3.2 3B | 53/59 | 10 | 16 | 0 | 23/23 | 2 |
| gemma3 4B | 41/59 | 2 (incl. **GEN 99:1** injection) | 68 | 28 | **7/23** | 2 |

Most "outside" keys are adjacent verses (GEN 1:2, ROM 10:4) — not fabricated but not supplied. Stability ×3: commentary JSON per run llama3.1 [56,57,57], qwen3.5 4B [57,57,58], qwen3.5 2B [59,58,58], gemma4 e2b [56,57,56]; prune set changed between runs in 9/6/8/5 of 23; 0 gold pruned in any run.
Divine names in commentary output: "Jesus" appears in 4–11 summaries per model; "Yeshua" in 0–2. The commentary prompt has no naming instruction and the word-replacer is not applied to model text [I].

### G6. Thinking models as-is (production settings, no think:false) [M]

qwen3.5 4B: 15 cases, 0/15 parseable JSON, median 16.9 s. gemma4 e2b: 0/15, median 8.9 s. Empty `response`.

### G7. Mobile [U]

No iPhone inference run (spec forbids physical device; no iOS LLM runtime exists to run in the simulator). All iPhone latency, heat, memory and battery are **unmeasured**.

### G8. Critical failures [M]

| Case | Models | What | Attribution |
|---|---|---|---|
| R02–R05 | all 10 | model-missing / timeout / malformed / OOM shown as "No matching verses found" | app error mapping |
| R19 | ministral-3 3B, qwen3.5 0.8B, qwen3.5 4B | followed injected instruction in a tab note; output "Genesis 99:1" | model + no output ref validation |
| S19 | qwen3.5 0.8B | fabricated "Job 6:48" | model + no output ref validation |

0 privacy failures and 0 unapproved network calls (but there is no private-note concept to protect — see L).

### G9. Acceptance gates

| Gate | gemma4 12B | llama3.1 | llama3.2 3B | qwen3.5 2B | gemma4 e2b | ministral 3B |
|---|---|---|---|---|---|---|
| No fabrication | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ R19 |
| ≥95% valid JSON | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ≥90% OFF discipline | ✅ 100% | ✅ | ✅ | ✅ | ✅ | ✅ |
| ≥85% OFF scoring 3–4 | ✅ 92% | ✅ 86% | ✅ 85% | ❌ 81% | ❌ 82% | ❌ 83% |
| ≥85% ON 3–4 (pass proxy) | ✅ 95% | ❌ 82% | ✅ 90% | ✅ 88% | ❌ 82% | ✅ 95% |
| Zero privacy failures | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| All 4 combos tested | ✅ (llama3.1 matrix) | | | | | |
| History tested | ✅ 6H | | | | | |

**No configuration passes the system gate today** because R02–R05 are critical in every run; they are app fixes.

## H. Failure analysis (pipeline-level, failed by ≥8/10 models) [M]

| IDs | Failure | Attribution | Deterministic fix |
|---|---|---|---|
| C11–C14, C16, C17, H13 | no word-by-word Strong's output | missing capability | `get_word_tags` from `text_tagged` (`word{G25}`); LXX needs Greek-tagged `lxx.db` added to TEXT_FILES |
| C37, H02, C25, C51, C53, C39, C43, C46, C54, C29 | word / transliteration / original script → wrong Strong's | model guessing + prompt example | gloss/translit/lemma index over strongs_*.db entries; remove literal "H2580" example from extraction prompt |
| C07 | "G-25" not parsed as an id | parser | accept `[GH]-?0*\d+` anywhere |
| C55 | "g5485" mid-sentence | parser | same |
| H05, H12 | follow-up Strong's resolves wrong id | history + model | carry resolved ids in structured history |
| R09 | Strong's lookup fails when Ollama down | ordering | move availability check after deterministic paths |
| R02–R05 | errors shown as "no results" | error mapping | distinct messages per failure kind |
| I11 | false premise not challenged | model / prompt | commentary prompt: state unmet premise |
| K23, K32 | answer cites the asked verse which wasn't in results | retrieval | always include explicitly referenced verses in records — **needs manual review** |
| H24 | truncated-history restriction lost | history window (6) | carry active filters as state, not text |
| llama3.1 K02/K06 | JSON truncated at 512 tokens (long `irrelevant` list) | settings | cap list / raise num_predict for that call |
| R19, S19 | nonexistent refs in prose | model | validate every ref in model text against DB; strip/flag |

## I. Recommended design [I/E — not implemented]

1. Deterministic first: refs, Strong's ids (any spelling), gloss/translit/script → Strong's, word tags, occurrences, quotes, notes, videos, cross-refs. Rules router (G4) chooses the tool; model only fills gaps (topical extraction, commentary).
2. Model jobs only: topical keyword/guess extraction (OFF) and 2–4 sentence commentary (ON). Deep Search optional, and allowed only with the larger model.
3. Output guards: drop perVerse keys not in records; validate refs in prose; JSON schema with retry once; `think:false` forced for thinking families.
4. Divine-name instruction in the commentary prompt plus deterministic replacement on model text (open decision).
5. Runtime: replace Ollama with a bundled llama.cpp runtime (same GGUF files) + in-app resumable/SHA-256 model download — matches "no CLI setup" (CLAUDE.md §1/§19). MAS sandbox compatibility of a bundled helper vs in-process binding: [U], needs a spike.
6. Embeddings: remove (G-E evidence). Revisit only with a Bible-tuned model and a measured pipeline gain.

## J. Mac / iPhone plan

- **Mac default:** qwen3.5 2B q4_K_M — 1.9 GB download, 2.3 GB RSS, 2.3 s median OFF, 59/59 commentary JSON [M]. Its OFF gap is concentrated in 6C Strong's (27/55), the category moving to deterministic code. **Condition:** re-benchmark after fixes must clear ≥85% OFF; otherwise use llama3.2 3B (passes today, 4.4 s, 3.8 GB RSS; license terms [U]).
- **Mac optional large:** gemma4 12B QAT — best on every quality axis (OFF 92%, ON 95%, Deep 26/26, 0 outside keys, best model router), but 17.6 s / 51.6 s median and 7.9 GB RSS [M]. qwen3.5 9B is not better than the small models (OFF 234, ON 45) — not recommended.
- **iPhone:** qwen3.5 2B on 8 GB devices only [E]: ~2.3 GB RSS on Mac at 16K ctx [M]; iOS jetsam limits without `com.apple.developer.kernel.increased-memory-limit` are roughly half of device RAM [E] — add the entitlement, cap context at 4–8K [E]. Runtime: llama.cpp Swift/XCFramework sharing the Mac GGUF [I]; existing BereanDownloadsPlugin already gives resumable + SHA-256 downloads [I]. qwen3.5 0.8B as the low-RAM fallback is weaker (OFF 78%, fabrication S19, injection R19) [M]. Apple's on-device Foundation Models framework (iOS/macOS 26+, Apple Intelligence devices) is an alternative needing no download — **[U] untested**, and Berean targets iOS 17.
- Device speed, thermals, battery, memory: **[U]**.

## K. Cleanup plan (only after you approve the replacement)

~/.ollama/models is 40 GB; Ollama.app 664 MB [M].

| Item | Size | When removable |
|---|---|---|
| llama2:latest | 3.8 GB | now — unused by Berean |
| mxbai-embed-large | 669 MB | now — unused (lost head-to-head; never shipped) |
| nomic-embed-text | 274 MB | with the embedding code removal |
| gemma3:4b | 3.3 GB | after approval — not recommended |
| benchmark-only: qwen3.5:0.8b, qwen3.5:4b, qwen3.5:9b, ministral-3:3b, gemma4:e2b, llama3.2:3b (unless fallback chosen) | 1.2+3.3+6.6+3.0+4.3+2.0 GB | after approval |
| llama3.1:latest | 4.9 GB | after the new default ships |
| qwen3.5:2b, gemma4:12b | 1.9 / 7.2 GB | keep until GGUFs are exported into the bundled runtime's store, then remove from Ollama |
| Ollama.app + ~/.ollama | 664 MB + remainder | after the bundled runtime ships and users are migrated |
| Code: electron/ollama.ts, electron/embeddings.ts, electron/embeddingQuantize.ts, electron/db/embeddingsDb.ts, electron/ipc/semanticCandidates.ts, scripts/build-embedding-index.js, scripts/eval/semanticEval.ts, Ollama setup/onboarding strings | — | with the implementation PR |
| Benchmark: worktree /Users/roywe/Berean-ai-bench incl. electron/db-generated/verse_embeddings.db (29.8 MB) and out/ | — | after you've reviewed the evidence |

## L. Open decisions / approval gate

1. Default model: qwen3.5 2B (conditional) or llama3.2 3B now?
2. Runtime: bundled llama.cpp (recommended) vs keep Ollama for now.
3. Keep Deep Search? Restrict to the optional large model?
4. iPhone AI: enable, which devices, add the increased-memory entitlement?
5. Divine names in model text: prompt instruction, deterministic replacement, or both?
6. Remove the embedding stack (and nomic/mxbai)?
7. Licenses for the chosen models — not verified here.
8. Legacy Commentary OFF + Deep ON state: migrate to Passages Only?
9. Private notes: none exist, so "privacy" means only no network egress. Is a private/excluded-from-AI note flag wanted?

**Stopped here. Nothing will be implemented, removed, committed, pushed or released without your approval.**

## M. Evidence appendix

All under `/Users/roywe/Berean-ai-bench/scripts/eval/bench/`:
- cases.jsonl (355), gold_resolved.json, build_cases.py, validate_cases.py
- runBench.ts, bench.config.ts, score.py, tool_router.py, replay.py, run_all.sh, post_chain.sh
- out/F-<model>[-nothink].jsonl (10 × 338), out/A-llama3.1_latest.jsonl, out/F-*-asis.jsonl, out/F-llama3.1_latest-mm{000..111}.jsonl
- out/E-<model>.jsonl, out/E-RULES.jsonl, out/D-<model>[-rN].jsonl, out/prompts.jsonl
- out/mem-rss.txt, out/ps-*.json, out/run_all.log, out/post_chain.log, out/embed-build.log, out/retrieval-with-index.txt
- Re-score: `python3 score.py out/F-<model>.jsonl`
