# Berean AI — requirement status against the master spec

As of 2026-11-05 (second update). Supersedes `SPEC_AUDIT.md`. The upgrade is **not fully finished**: see Blocked and Not implemented.

## Where everything stands

**Complete** (built, automated tests pass, and exercised in the real running app):
Direct references and Strong's without a model; comparison views; premise check and its fixed wording; Commentary OFF prose stripping; Stop; exclusions; named verses leading; model picker and Automatic order; Deep Search escalation; occurrences explorer; Mac Settings screens; desktop startup guard; local model list, re-pull progress and removal (tested by re-pulling an installed model and removing a tiny test model).

**Implemented, not manually verified by Michael:**
Research findings view; "Your note" links; first-launch model step; cloud settings; online research on Mac (permission tests only; live API shape checked); iPhone profile, scope and mode screens (simulator only); iPhone online research (real search in simulator, not on a device); iPhone rename and Quick Open.

**Partially implemented:**
- Commentary ON quality. Sample of 6 questions on 3 models (Claude's review, not a human one, 2026-11-05): grounded and no invented references seen, but "historical setting" tends to paraphrase the verse, "compare the main interpretations" names no perspectives, and qwen3.5 2B wrongly said the Sabbath verses give no instructions. gemma4 12B was more accurate but far slower and still named no perspectives. Scenarios 17 and 18 are not met to the spec's standard.
- Verse-note influence: fixed boost plus linked references, not context-tuned, Mac only.
- Time budgets: per-call limits only.
- Result ranking on the full library: with all collections on, keyword matches from other texts can rank above canonical verses for some questions. The benchmark doesn't score order.
- Model downloads: real re-pull and removal tested; a full new download and a cancel of one were not, to avoid a large download.

**Blocked:**
- Physical iPhone testing and low-memory behaviour: needs Michael's device.
- Local AI on iPhone: needs a device, approval for a model download, and Mac App Store runtime work first.
- Bundled runtime and sandbox (scenarios 28, 29): provisioning profile, installer certificate, approval for the 1.9 GB model path.
- Human review of answers: the review page has no entries.
- ChatGPT plan connection: eligibility decision (`SUBSCRIPTIONS.md`).
- General web search: provider decision.

**Not implemented:**
Cloud model on iPhone (needs native Keychain storage). Per-device model selection. Automatic cross-chat memory (later by design). A fresh independent holdout, so no new independent quality claim exists.

## The 25 decisions

| # | Decision | Status | Note |
|---|---|---|---|
| 1 | Research intelligence | Done | Deep Search multi-step on Mac. iPhone is deterministic only |
| 2 | Commentary OFF | Done | Prose stripped in the main process; premise notice and online sources carry no model or page text. Human review set still open |
| 3 | Commentary ON adaptive | Partial | Prompt-level; prose quality not human-reviewed |
| 4 | Deep Search, any model | Done (Mac) | iPhone blocked on having a model |
| 5 | Auto and manual model | Done | Per-profile picker, Automatic order from the sweep |
| 6 | iPhone compatibility | Partial | Model-free works, tested in simulator. Local model blocked |
| 7 | BYO cloud | Done, unverified by hand | Mocks only: no real call made |
| 8 | Strong's presentation | Done | |
| 9 | Collections | Done | Mac and iPhone UI |
| 10 | Study profiles | Done | Mac and iPhone UI. A profile edited on the other device may need re-selecting |
| 11 | Semantic search study | Done | Kept current index after measurement |
| 12 | Downloads | Partial | Ollama manager, first-use link and onboarding step. Bundled runtime blocked; no full new download tested |
| 13 | Independent modes | Done | |
| 14 | Automatic depth and budgets | Partial | One refine pass; per-call timeouts, no per-question budget |
| 15 | Adaptive result UX | Done | Reviewed in the real Mac app and iPhone simulator |
| 16 | Verse notes aid discovery | Done (Mac) | Boost plus references from the note. Unused on iPhone |
| 17 | Cross-chat memory | Done | Explicit saving; automatic memory is later by design |
| 18 | False premises | Done (Mac) | Needs a model, so not on iPhone |
| 19 | Online research hybrid | Partial | Wikipedia and Sefaria, Mac and iPhone. General web search awaits a decision |
| 20 | Cross-device models | Partial | Same settings model; per-device selection needs iPhone inference |
| 21 | Layout controls | Done | Automatic |
| 22 | Note relevance weight | Partial | Fixed boost; never outranks text. Not tuned by context |
| 23 | Automatic web | Done (Mac) | Default off; ask; automatic with Deep Search |
| 24 | Profile instructions | Done | No adversarial test set |
| 25 | Model escalation | Done (Mac) | Automatic, installed, local, Deep Search only, memory-gated. Measured on 32 GB only. Cloud is never automatic |

## The 30 scenarios

| # | Scenario | Status |
|---|---|---|
| 1 | John 3:16, no model | Done (simulator) |
| 2 | G5485 forms | Done (simulator) |
| 3 | mercy word study | Done (simulator) |
| 4 | Compare H2617 and H7356 | Done |
| 5 | Word table | Done |
| 6 | Loving God by keeping commandments | Done (benchmark) |
| 7 | Obedience but not rulers | Done (real-data test) |
| 8 | Zero-overlap concept | Partial: Mac only |
| 9 | Moses entering Canaan | Done (real models) |
| 10 | Paul and the Sabbath | Done (trigger tested); not hand-reviewed |
| 11 | Verses connected to my note | Done (real-data test) |
| 12 | Excluded note | Done |
| 13 | Now only Greek | Done |
| 14 | Compare the second with the first | Done |
| 15 | "this chapter" | Done; chip not hand-reviewed |
| 16 | OFF plus Deep | Done (benchmark matrix) |
| 17 | ON historical setting | Partial: prompt-level |
| 18 | ON compare interpretations | Partial: prompt-level |
| 19 | Profile switch | Done |
| 20 | Apocrypha, 66 books, mixed | Done |
| 21 | Web disabled | Done (test: no network) |
| 22 | Web auto | Done with mocks; one free live probe of each API |
| 23 | Cloud off and on | Done with mocks |
| 24 | Timeout, bad JSON, missing model | Done (end-to-end test) |
| 25 | Injected note | Done |
| 26 | Deep Search cancel | Done (end-to-end test); not hand-tested |
| 27 | iPhone low memory | Partial: no model to exhaust memory; physical device needed |
| 28 | Mac App Store sandbox runtime | Blocked: profile and installer certificate |
| 29 | Offline without Ollama | Blocked: bundled runtime and model download approval |
| 30 | UI selection, accessibility | Partial: no VoiceOver pass |

## Result components (§6.1)

All 14 components are live, including the paginated occurrences explorer and a research findings view for Deep Search.
