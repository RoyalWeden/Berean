# Word Replacer per-rule switches — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED + VERIFIED (scope below)**. Closes the "per-rule toggles / persisted `wordReplacerRules` / one rule set through every consumer" part of FOLLOWUP Word Replacer item. Custom-rule *creation* is still not offered (the original apps never had an add-rule UI either — WordReplacerSection.tsx is master switch + per-rule switches only), so this now matches the original editor.

## Legacy audit
- `src/store/index.ts`: `wordReplacerRules: WordReplacerRule[]` persisted with `wordReplacerEnabled`; `toggleWordReplacerRule(id)` flips `enabled`. Hydration merges missing default IDs: multi-word defaults prepended, single-word appended, existing order kept.
- `WordReplacerSection.tsx` (desktop + iPhone `WordReplacerPage`): master switch, Divine Name (Strong's, KJVA) group, Text rules group, per-rule switch.

## Native implementation
- `BereanText/WordReplacerRuleSet.swift`: holds the raw persisted JSON array verbatim (unknown fields, custom rules and malformed entries survive), decodes applicable rules, legacy merge order, `setEnabled` rewrites only that object's `enabled`, `enableAll` resets to default switches, `revisionKey` fingerprint. `WordReplacerRule` is now `Hashable`.
- `AppModel.wordReplacerRuleSet` persists to the device-local settings key `wordReplacerRules` (same table/key style as `wordReplacerEnabled`; nothing synced, no schema change). Loading never writes. `app.wordReplacerRules` + `app.wordReplacerKey` (enabled + enabled-rule ids).
- Every former `WordReplacer.defaultRules` consumer now uses the live set: reader (`readerVerses`, `VerseRowView` via new `rules:`), Compare cells/copy/share, verse/chapter copy+share (`SharedVerseSelection`/`SharedScriptureChapter` carry `rules`), Scripture search request (rules in the Hashable request → re-runs on change), search previews/snippets, Notes Scripture blocks (input + ratio cache keyed by `wordReplacerKey`), passage excerpts, lexicon prose/occurrence previews (task/staleness keyed by `wordReplacerKey`), Study inspector, tag views, iPhone tab previews.
- Settings → Reading → Word Replacer → Rules…: each rule row is a Toggle (accessibility label "H3068 to Yehovah"), dimmed when off or master off, disabled while master off; toolbar **Turn All On**.

## Verification
- 5 new `WordReplacerRuleSetTests` (absent→defaults, merge order, unknown/malformed preservation, disabled rule stops applying, encode/decode round trip). Full `swift test -c release`: **301 tests (4 core + 297/71 suites) PASS** `/tmp/claude-wr-tests.log`.
- `npm run native:build:mac` and `native:build:ios` PASS (`/tmp/claude-wr-{mac,ios}.log`).
- iPhone UI on a **separate simulator** (iPhone 18 Pro Max E8B01B22-30D0-4184-9D0D-B0A394817943, fresh Dev container — not Codex's D0CC… device): Genesis 2 showed "Yehovah God"; Rules sheet showed switches; turning off H3068+H3069 → Done → reader immediately showed "the LORD God"; settings row `wordReplacerRules` saved with `enabled:false` only on those objects; relaunch kept LORD; Turn All On restored all and disabled itself.
- **UNVERIFIED:** Mac UI interaction of the switches (same shared SwiftUI view; built only — Codex's QA app was live on the shared Mac GUI), search re-run on a rule toggle at runtime, lexicon preview refresh at runtime, VoiceOver.
