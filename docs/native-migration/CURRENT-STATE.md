# Current native migration checkpoint

Snapshot: **2026-11-21, Codex**. Broad goal ACTIVE; latest turn made concrete progress, not a blocker/wait-only turn. Start with [HANDOFF](HANDOFF.md), [owner principles](OWNER-PRINCIPLES.md), and [continuity contract](AI-CONTINUITY.md). Stay-within-limits disabled; no resets or new cutoff.

## Source and review

- Checkout `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`. Latest app source **852a4767**, following **8252c91c** (Mac live inspector target guard). This documentation checkpoint includes both source commits. Verify remote head/publication and exact-head checks live; the source commit identifier stays distinct from the documentation head. No dirty implementation remains.
- Previously published head7263836f includes source8ae5e4a6 (Compare active-column Presenter),7118fff8 (initial-layout history),40fb2923 (immediate Mac palette),0d6c0ad3 (clear/wider iPhone reader),da77a14c (diagnostics/timing),e3845c9b (history viewports). Later source publication must be rechecked live.
- Draft #24 remains open, base`native/m6-navigation`. Exact7263836f CI **44939514152**: legacy checks pass, native platform-SQLite test still running at observation. Old green44894290052 covers ec6138cd only. Never claim old-head checks verify new source.
- Push only verified remote `github` (RoyalWeden/Berean); `origin` is owner-local. Owner-only merge stack22→23 after retarget/green→draft24. No merge/ready/retarget/force, production data, sync, schema, signing or identity changes. Other checkout untouched.

## Latest completed source and evidence

- **8252c91c:** inspector binding and width callbacks validate live active tab type/layout, including same-ID Cmd+L replacements. Valid writes change only rightPanelOpen. Actual Scripture→Lexicon and Scripture→Search keep the same UUID/seven workspace tabs; raw replacement state contains only strongsNum or query, with empty local state. Inspector toggles work. Deterministic delayed-callback injection remains unverified.
- **852a4767:** correct AppKit's final offset-only adjustment during first-mounted history restoration. Trace proved446 was correctly requested/applied through width changes, then moved to440 at unchanged geometry. A bounded, generation-scoped next-main-turn correction now preserves446 without extending the existing timer. Native input cancels. Actual repeated Search Back/Forward exact446 passes; immediate user scroll wins and its new position survives history. Temporary diagnostics removed.
- Mac final build`mac-history-offset-settle-build.log` passes. iPhone last build`ios-compare-anchor-sequential-build.log` passes at source8ae5e4a6; later changes are Mac-only. Shared package unchanged since **349 tests pass** (345 conformance/90suites plus4core), log`shared-watchdog-tests.log`. These package tests do not prove app-only UI behavior.
- [Tab lifecycle evidence](TAB-LIFECYCLE-2026-11-21.md) has precise repro, failed attempts, source reasoning and current state. [History evidence](HISTORY-VIEWPORT-RESTORATION-2026-11-21.md) records earlier same-chapter/cross-chapter/iPhone and Presenter live/paused checks. [Presenter evidence](PRESENTER-REFINEMENT-2026-11-21.md) records actual secondary LXX audience and pause/tab-switch/resume, plus open Compare matrix.
- iPhone Scripture has no broad top blur; individual glass controls remain. Phone-only inset wide/normal/narrow8/14/26 versus12/20/32. Desktop widths/margins unchanged (920/760/600 caps). Final Simulator body-tap selection/deselection passes; all width presets/accessibility/physical touch remain open.
- Mac palette immediate query entry, Cmd+L prefilled replacement, Actions and outside dismissal pass within the focused scope. Instrumented first-frame timing remains open.
- **Physical iPhone watchdog cause OPEN.** Report is process-exit watchdog; sampled app frames resolve to entry point. Full diagnostics, local acknowledgement and content-free save timing added. Simulator lifecycle sanity does not prove physical resolution. [Investigation](IOS-WATCHDOG-2026-11-21.md).

## Safe runtime and data

- Durable ignored evidence`build/apple/qa-evidence/20261121`; Xcode cache`build/apple/DerivedData-codex-20261121`; Swift scratch`build/apple/swiftpm-codex-20261121`. Builds sharing this Xcode cache must run sequentially. No reliance on restart-deleted temporary evidence.
- Mac QA app`build/apple/DerivedData-codex-20261121/Build/Products/Debug/BereanMac.app`, arguments`--qa-library --qa-profile codex-controls-20261119`, runtime session40400/log`mac-history-offset-settle-runtime.log`. Revalidate PID/path/args. Separate owner process under`/Users/roywe/Berean-native/...` untouched.
- Current Mac Genesis1KJVA/selected1/Notes inspector, offset446, fraction0.4402764067127344, sidebar239/rightdivider1660 in current2000-point-wide QA window; Presenter closed160%. Older AX splitter setValue changed geometry; do not replay it or force stale800/660 widths. Controlled Compare→Genesis cycle without divider writes was stable; broad first-frame/reflow/width-memory matrix remains open.
- iPhone only Codex simulator **D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D**, identity`com.berean.native.ios.dev`; lastPsalm3LXX/no selection/no sheets/nine workspace tabs/CaptureKeyboardOFF. Container recorded`ios-container.txt`, requery after each install. QA DB suffix`Library/Application Support/BereanNative/berean.db`. Leave ClaudeE8B01B22 and physical devices untouched.
- Latest`tab-lifecycle-final-data-check.json`: all original note/settings/chat/tag row hashes retained; exact37Mac/47iPhoneactiveIDs,22/26notes. QA tab reading/history state legitimately changed. Existing owned fixtures remain (Mac synthetic image Chatab44752e-5113-4c1b-869a-8b7a60d9c706); do not hard-delete. Effective print Normal/four1inch custom values restored; Mac Default theme key retained.
- Preserved stash`codex-preserved-presenter-before-claude-20261121` contains superseded Presenter work; do not blindly pop.

## Next executable work

1. Verify publication of this checkpoint with8252c91c/852a4767 and live exact-head CI. Keep precise local versus published distinction; prior passes are bounded evidence.
2. Continue Compare projection actual pinned/mapped secondary edition/chapter, scroll/clear/reorder/removal/reentry/narrow cases; full multi-column mirroring remains partial parity. Preserve atomic projection, actual mapped chapters and paused snapshot semantics.
3. Broaden missing-viewport/rapid/history/startup/edition/paused/accessibility and inspector deliberate-drag tests; never change native geometry code from AX values alone. Full queue remains in TASKS/FOLLOWUP/FULL-FEATURE-PARITY.
4. Continue physical watchdog attribution only with full physical .ips or reproduction, preserving durability and the phone's data. No Apple voices, production/sync changes or merges.
