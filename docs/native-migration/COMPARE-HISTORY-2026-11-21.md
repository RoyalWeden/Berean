# Compare column history and viewport continuity — 2026-11-21

Broad migration ACTIVE. Previous goal turn made concrete progress (publishedc39ca828/d9da6c36 plus actual iPhone/Mac evidence), not a blocker/no-progress turn. Starts at cleane39b48a0. Exact-head CI44943410767 running. Existing owner-only review stack and production/sync/schema/identity guards remain; no quota resets.

## Actual column-change checks on prior source

Existing QA EXO32 KJVA/LXX independent columns, original orderKJVA thenLXX, sevenStudy tabs, Comparetab78014c72-c288-4426-82d8-b8b3adf99cf1. SelectLXX3; Presenter showsLXX at fraction0.08939844040103974. SwapColumns: raw selection followsLXX nowfirst, Presenter retains exactfraction/source. This passes the observed focus-continuity case; a hypothetical focus loss when selected verse and viewport anchor differ remains unverified, not a proven bug.

Close selectedLXXcolumn fromtwo columns: Compare exits, KJVA survives. Presenter nowshowsKJVEXO32, fraction0, no staleLXX. ClosePresenter. Back returns swappedCompare and selectedLXX3. SecondBack returns originalcolumnorder but loses the LXX3 selection that was present beforeSwap. No notes/annotations/newtabs. This is a reproduced per-visit selection-history gap.

## Source cause and active exact fix

Compare keeps one latest snapshot pertab. preserveReadingPositions installs a remapped new-configuration snapshot before app.update records outgoing history; TabHistoryLocation has no Compare selection. Returning to an older configuration cannot restore the original visit, and merely memoizing byconfiguration would alias repeated visits with different selections.

Delegate owns AppModel.swift/CompareView.swift/ReaderVerse.swift for value-copy selection in existing bounded in-memory TabHistoryLocation, defer destination remap until outgoing history captured, replace/evict destination cache onrestore, and reuse matching restoration logic for load/same-passage reader-intent/history revision. Explicit new verse commands must still clear/reseed, never inherit stale selection. No persisted/schema/sync change. Parent owns review/builds/UI/docs/Git. Do not overwrite dirty implementation.

Meaningful acceptance: selectLXX3 → swap → close selected → Back twice andForward twice; revisit same orderedconfiguration with a different selection to prove per-visit values do not alias. Verify selection focus/anchor, survivingreader, noextra tabs and normal explicit jump/clear. Both native builds and relevant native reader harness.

## Separate viewport audit, not implemented yet

preserveReadingPositions uses its own allFollows+sync test and stacked-before-independent observations, unlike actual sharedcomparisonLayout/readingAnchor. Narrow all-following+syncoff can renderaligned;3→2 removal may lose shared position, and stale stacked observations may win after widthchange. Proposed fix separately: use actual renderedmode and readingAnchor per survivor, require matchingchapter before caching rawverse, carry source-grid row keyedtofuturepassage across aligned→aligned removal. Do not apply sourceonly assumptions as runtimeproof. Full persistedCompareviewport parity remains open.

CurrentQA mainEXO32 originalorder/syncfalse/no selection, Presenterclosed160%; originalGENreader shouldremain446selected1/Notes when restored. iPhone untouchedPsalm3LXX/no selection/sheets/nine tabs. Originalrecordhash andactive-ID checks must repeat at publication. Next: finish/review selection-history implementation, builds, exactrepeat of failedsequence, then viewportmatrix. Do not conflate these two fixes or close the broad goal for a batch.


## Selection history implementation and Mac verification — 50f00c76

TabHistoryLocation now copies the matching CompareSelectionSnapshot as a value, inside the existing bounded session-local history stacks. Configuration changes calculate remapped selection without overwriting the outgoing value; install destination after app.update captures history. Restore replaces/evicts the cache before view updates and publishes tab/passage/UUID marker. Shared restoration helper is used by load and active/loaded/current-passage intent observer, covering same-mounted returns. Targets validate column destination, edition/book and actual chapter rows. ReaderVerseSelection gains synthesized Equatable value semantics; no persistence/sync/schema changes. Explicit verse jumps still clear/reseed.

Both builds PASS: mac-compare-history-selection-build.log / ios-compare-history-selection-build.log. Existing actual reader selection harness PASS in reader-taps-compare-history.log (scope, combined rows, additive taps/deselect, filtering, outlines and retained focus/anchor). Shared package remains unchanged since349-test pass; do not count those as tests of app-only history behavior.

Actual Mac final source passes the exact failure sequence: selectLXX3 → swap → close selected column to KJVreader → Back(swappedLXX3) → Back(originalorderLXX3) → Forward(swappedLXX3) → Forward(KJVreader). The formerly lost pre-swap selection now returns. Then Back to swappedvisit, clear/selectLXX5 andswapback: history has originalorder/3 and lateroriginalorder/5. Back twice restores original3; Forward twice restores newer5. This proves distinct visit values rather than a configuration-cache alias. Cmd+L EXO32:10 selectsKJV10; Back within the same chapter restoresLXX5. Cleared temporary selection, restoredGEN1selected1/Notes/exact446fraction0.4402764067127344. Noextra tabs/annotations/notes.

Runtime session79343/log mac-compare-history-selection-runtime.log; process must be revalidated. iPhone finalsource installing in session94652 to CodexD0CC only; container re-queried. Actual iPhone touch/history still pending. Publication and final data checks pending. Prior publishede39b48a0 all3CIchecksPASS in44943410767; this does not cover later50f00c76.


## iPhone verification and final checkpoint

Installed/launched final shared source50f00c76 only on CodexD0CC simulator (PID42858), re-queried container inios-container.txt. StartingPSA3LXX/no selection: More → Reading Options → Compare Texts; select secondaryKJVA3; ManageTranslations → SwapColumns; More → Back restored originalLXX/KJVA order and selectedKJVA3. Forward restored swappedKJVA/LXX order withsame selection. Back twice returned the originalPSA3LXXreader/no selection/noCompare/nineworkspace tabs. No new notes, annotations or tabs. This verifies touch-delivered swap/history on iPhone, not persisted/restarterror/rapid/narrow/removal matrix.

Final compare-history-final-data-check.json: every original row hash retained, exact37Mac/47iPhone active IDs and22/26notes. EXOcomparison originalsyncstate restored exactly. MacGEN1selected1/Notes/446, fraction0.4402764067127344/sidebar239/right1660/current2000-wide; Presenterclosed160%. iPhonePSA3LXX/no selectedverses/no sheets/offset0/CaptureKeyboardOFF. QA navigation history legitimately changed; no production library/sync/schema/identities/other checkout changed.

Code50f00c76 committed. Both final Dev builds and existing reader selection regression pass. Prior publishede39b48a0 all3checksPASS inCI44943410767, not evidence for later50f. Publish this documentation checkpoint and reverify exact latest-head CI; do not mark broad migration complete.

Next bounded code slice is the separate narrow-layout bookmark issue described above. Share the render/readingAnchor mode when preserving survivor positions; do not mix this with value-copy selection history or claim full persisted Compare state. Reproduce an aligned all-following, Sync-off narrow layout with3→2 columns, and a width transition carrying stale stacked observations. Actual raw adjacent-chapter mapping must remain keyed to the right chapter. Also continue first-frame, accessibility and direct pointer/drag tests through CUA; do not guess geometry from stale AX splitter readings.
