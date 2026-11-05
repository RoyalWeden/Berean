# Berean AI — requirement status against the master spec

As of the final gate on 2026-11-05. Supersedes the statuses in `SPEC_AUDIT.md`, which recorded the state before this session's work.

- **Done**: built, reached by the live path, automated or simulator test passed.
- **Done, unverified by hand**: built and auto-tested; needs Michael's eyes or a real service.
- **Partial**: part works; the gap is stated.
- **Blocked**: needs an approval, hardware or a decision.

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
| 12 | Downloads | Partial | Ollama manager, first-use link, skip. No onboarding step; bundled runtime blocked; no real download tested |
| 13 | Independent modes | Done | |
| 14 | Automatic depth and budgets | Partial | One refine pass; per-call timeouts, no per-question budget |
| 15 | Adaptive result UX | Done, unverified by hand | Mac not reviewed visually; iPhone comparison and options seen in simulator |
| 16 | Verse notes aid discovery | Done (Mac) | Boost plus references from the note. Unused on iPhone |
| 17 | Cross-chat memory | Done | Explicit saving; automatic memory is later by design |
| 18 | False premises | Done (Mac) | Needs a model, so not on iPhone |
| 19 | Online research hybrid | Partial | Wikipedia and Sefaria, Mac only. General web search awaits a decision |
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
| 30 | UI selection, accessibility | Partial: no VoiceOver pass, Mac not reviewed |

## Result components (§6.1)

Direct passage, topical, Strong's, word table, Strong's comparison, translation parallel, passage comparison, cross-reference badges, premise check, note association, video evidence and external source cards are live. Occurrences has a by-book breakdown but no paginated explorer. Research findings has no dedicated view.
