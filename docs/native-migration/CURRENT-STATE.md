# Current native migration checkpoint

2026-11-23, Codex. **Broad migration goal ACTIVE.** Current slice: per-visit Compare reading positions. Begin with HANDOFF, OWNER-PRINCIPLES and AI-CONTINUITY; keep this summary and HANDOFF top synchronized continuously.

## Source and publication

Repo `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`. Audit through `bf4a1b78`; source commit `d349bf41` fixes per-visit Compare viewports. This documentation checkpoint accompanies that source on the same branch; verify local/remote HEAD and exact check state before continuing. Other checkout `/Users/roywe/Berean-native` untouched.

Draft24 remains OPEN/draft/base `native/m6-navigation`. At published bf4a1b78, CI45239374357 has legacy in progress, native queued, security passed. Earlier ce013c65 run45237638956 was superseded/cancelled before native assignment; legacy passed. Never report old checks as new-source green. Publish github only, origin owner-local; no merge/ready/retarget/force. Owner merge order22→23 after correct retarget/green→24 remains.

## Latest implementation and evidence

- `d349bf41`: immutable passage-scoped Compare viewport per in-tab visit; same-mounted history revision; ready-layout restoration and stale/early callback gates; native independent visibility records scrollbar moves. No persisted/synced fields or schema changes.
- Both app builds PASS in Nov23 `mac-compare-visit-build.log`, `ios-compare-visit-build.log`. Extracted actual snapshot probe passes immutable capture, exact scope isolation, empty visits and Back/Forward. Package source unchanged; previous372-test pass belongs to audit source, not a fresh app-change test run.
- Actual pre-fix Mac Exodus32 independent KJVA/LXX at different positions → CmdL G5485 → Back reset both to top. Rebuilt app now returns to logical rows8/16. Exodus32→33→32 with different reading positions, Back twice and Forward twice preserves distinct visits. **Independent restores verse at top; exact intra-row pixels remain open.** Details: [Compare evidence](COMPARE-VIEWPORT-2026-11-21.md).
- iPhone final context build installed on owned D0CC, inline Matthew5G5457 opens/expands Lexicon. AX excerpts retain context, but sheet touch/wheel automation did not reach occurrence rows; visual scrolling/highlight remains inconclusive. Closed panel and restored Strong’s off. Per-visit iPhone build passes but is NOT installed/tested yet.
- Audit fixes remain delivered: KJVA BOOKS + OT/NT/Apoc/current highlight, direct StudyTrail/Messages both apps, better lexicon context, Notes atomic slash/Board selection/content-preserving wide-table wrap, Trail/PDF integrity/error handling, Chat read/accessibility and Spotlight title refresh. See [full audit](CLAUDE-AUDIT-2026-11-23.md). Full horizontal editable table grid and listed runtime checks remain open.

## Runtime/data ownership

Mac QA final per-visit app launched with `--qa-library --qa-profile codex-controls-20261119`, log `mac-compare-visit-runtime.log`, handle27342 (verify before assuming live). Mac restored original Genesis1selected1, Notes inspector, scroll .07135575942915393, seven Study tabs. Existing Exodus32 Compare restored both panes0. iPhone owned D0CC remains Matthew5selected12/nine workspace tabs; E8B Claude device and physical phone untouched. Other checkout native process untouched.

Read-only `compare-visit-data-check.json`: every watched original notes/settings/messages/tags/trail/PDF row unchanged; exact active tab IDs retained (37Mac/47iPhone). QA global navigation history has added test visits, view state may change. No production/sync/schema/identity/signing writes, Apple voices or resets. Dev-iCloud deferred; Presenter stash preserved. Source delegate completed/frozen; no live source worker/build remains after terminal checks.

## Next executable work

1. Verify this source/documentation packet is published and inspect exact current-head checks; queued hosted runner does not block local progress.
2. Exercise iPhone per-visit fix, aligned/stacked histories, same-passage explicit jumps and rapid/selection/resize precedence. Keep failure evidence and original fixtures.
3. Implement durable Compare restart positions and precise independent intra-row anchors using [next packet](COMPARE-PERSISTENCE-NEXT-2026-11-23.md). Index-based nested local merge is unsafe; review stable identity and both allowlists before writing storage. This remains required work, not completion of the broader feature.
4. Continue Notes slashUndo/Board/PDF-label runtime, reader scroll/foreground, full Presenter/read-aloud, typed splits and original-app parity. Technical queue is not all owner-gated.
