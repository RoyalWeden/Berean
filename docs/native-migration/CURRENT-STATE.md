# Current native migration checkpoint

2026-11-22, Codex. **Broad goal ACTIVE.** Read [HANDOFF](HANDOFF.md), [OWNER-PRINCIPLES](OWNER-PRINCIPLES.md), [AI-CONTINUITY](AI-CONTINUITY.md). Stay-within-limits disabled; no resets. Earlier checkpoint text is historical, not current runtime authority.

## Source and publication

- Checkout `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`. Latest app source **ef9beb91**, saved Compare followers during normal reading; copy fix **d86f69b5** on both platforms. Earlier source0819f846, phone margins3bb05740, Compare6fbba670/global-closee31b8d87 retained.
- Source d86f69b5 + docs2d2a2fb2 published normally to github; clean immediately after push. Exact-head CI45054330257 now running/queued; no new-head green claim. Later dormant-follow source ef9beb91 locally committed; final docs/publication pending. Published **fe00494e**: CI44975267718 completed SUCCESS for native and legacy; security previously passed. Native CI Mac app-build step was skipped, so local Mac final build remains relevant. Old-head CI does not cover copy source. Normal publication remains `github` only; inspect exact-head checks.
- Draft24 verified OPEN/draft/base`native/m6-navigation`/head2d2a2fb2. `origin` is owner-local. Owner-only merge22→23 after retarget/green→24. No merge/ready/retarget/force.

## Copy fix and verification

- Single whole verse now reference+body on one line; multiple selected verses header then numbered lines, preserving gaps. Shared formatter routes reader, Compare, search, lexicon occurrences, LXX cross-reference ranges, chapter/share and highlight-copy callbacks. Non-LXX cross-reference Copy stays reference-only; native partial Copy Text stays literal. Authentic attached LXX Psalm title remains part of displayed verse; synthesized missing-verse notices excluded. [Detailed scope](VERSE-COPY-PARITY-2026-11-21.md).
- Final Mac+iOS builds PASS: `mac-verse-copy-parity-final-build.log`, `ios-verse-copy-parity-final-build.log`. Six focused package cases PASS `verse-copy-conformance.log`; prior349 full-suite pass is earlier scope. Source review and diff check pass.
- Actual clipboard checked both native readers: single, consecutive and gapped selection. Mac Compare single/range and Scripture search Copy Verse passed. iPhone Psalm3 title+body single and range passed. All11 after artifacts under `build/apple/qa-evidence/20261121`. Remaining individual contextual menus, partial-text drag gestures, physical device and accessibility coverage explicitly OPEN.

## Other current implementation and open issues

- iPhone direct Strong’s # left of picker, Compare/Manage in same row, both chapter arrows always visible, two-line full title with LXX on edition-switch button. Wider verse text phone-only6/10/22; desktop caps920/760/600 and inset formula unchanged. [Controls evidence](IOS-READER-CONTROLS-2026-11-21.md).
- Compare stays side-by-side on iPhone with horizontal overflow, compact inline rows, no per-verse ellipsis, selected first number enclosed. Mac Sync off/on/off, global close and Back passed recorded case. [Compare evidence](COMPARE-VIEWPORT-2026-11-21.md).
- OPEN: ordinary changing iPhone foreground gap (measured AEL case stable); Mac unexplained cold446→414 drift (same-run tab return stable); dormant Compare retains old PSA columns after main reader moves. No speculative inset/viewport or saved-column rebasing fix.
- Physical watchdog cause, durable Compare/per-visit viewport, synced chapter navigation, cross-column additive selection, generic tab splits, full Presenter mirror/read-aloud and broader parity remain open.
- Presenter/Messages access audit only: Mac Window shortcuts and both palettes expose Berean Chat, iPhone More has it; messages aliases currently missing. iPhone Presenter not implemented; avoid a dead entry. No source change made for exploratory access question.

## Runtime and data ownership

- Mac QA exact app path `build/apple/DerivedData-codex-20261121/Build/Products/Debug/BereanMac.app`, launched with `--qa-library --qa-profile codex-controls-20261119`, final copy source. Current Genesis1 selected1/Notes/offset0 after explicit Cmd-L fixture restoration; **not old414/446**. EXO32 Compare selection cleared; existing two columns retained. Seven workspace tabs,37global active IDs.
- Only owned iPhone simulator **D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D**, dev`com.berean.native.ios.dev`. Final copy source installed. Current Psalm3LXX/Strongsoff/no selection/Compare/sheet,nine workspace tabs;47global active IDs. Dormant three PSA columns/thirdpinned/Synctrue retained. Container path in `build/apple/qa-evidence/20261121/ios-container.txt`, suffix`Library/Application Support/BereanNative/berean.db`; requery after reinstall.
- `verse-copy-final-data-check.json`: all original note/settings/chat/tag hashes retained; exact37/47IDs and22/26notes. No notes/tabs created for this copy pass. Production/sync/schema/identities/signing untouched. Other checkout, owner app and Claude simulator untouched. Preserve Presenter stash; never blindly pop.
- PIDs are advisory and must be reverified before lifecycle actions. Default process listing denied this checkpoint; no guessed termination. All copy build/test handles finished. Builds sharing DerivedData must stay sequential.

## Next executable work

1. Commit/publish documentation with copy source normally to github; check exact-head CI. Keep draft/review guards.
2. Continue remaining copy UI entrypoint coverage and compatible dormant Compare reentry design, preserving pinned/independent legacy columns.
3. Diagnose viewport/history/scrolling with measured geometry rather than timing hacks. Continue phone narrow/large-type/rotation/accessibility matrix.
4. Keep implementing broader original parity and UX queue with continuous precise handoff notes. Do not mark the broad goal complete for this checkpoint.

## Earlier in-progress notes, 10:20 PST — superseded by final checks below

Source review found CompareColumn.followPassageChange requires both old/new Compare mode, so dormant matching followers miss reader navigation. Removing only that mode guard lets existing AppModel.update unchanged-column-array normalization run for actual anchor changes while Compare off. Pinned records remain byte-identical, legacy independent records become pinned, explicit column edits and history restores retain their own behavior. Cannot safely repair already-stale records with no recorded anchor; preserve rather than guess. Bounded agent owns CompareView-only guard and focused isolated regression probe; parent owns builds/UI/docs/publication. Mac final build session27119/logmac-compare-dormant-follow-build.log running, iOS sequential next.

Additional actual final-copy-source iPhone Compare KJVA Psalm119 single1 and range1–2 pass exact one/three-line contract (`verse-copy-ios-compare-{single,multiple}-after.txt`). Returned to PSA3LXX ordinary reader/no selection/nine tabs; dormant three columns retained. Existing stale-Compare fixture must not be silently rewritten for QA; use UI history-reversible aligned fixture for new navigation test.

## Completed dormant-follow checks, 10:26 PST

Shared two-line guard fix committed **ef9beb91**. Both final Mac/iOS builds pass. Actual Mac EXO32Compare→off→Cmd-L33→on both33; Back/Forward three steps each restore reader/configuration states; returned Compare32. Actual iPhone explicit FollowMain first column3→Exit→main4→Compare first4, two independent LXX118 remain. Five Back restore exact original readerPSA3 and configured KJVA119/LXX118/LXX118thirdpinned. See [reentry evidence](COMPARE-REENTRY-2026-11-22.md). Mac owned process refreshed after exact argv verification; owner728 remains separate/untouched. iPhone final installed70014 advisory; container refreshed. Simulator terminate after install returned nothing-to-terminate (install already stopped it); launch succeeded, not app-crash evidence. Isolated state probe red-before/green-after; full GUI/physical/relaunch matrix not claimed. Final Mac returned GEN1selected1/Notes/offset0; iPhone clean originalPSA3. `compare-dormant-follow-final-data-check.json` retains all original rows, exact37/47IDs and22/26notes. No new notes/tabs.
