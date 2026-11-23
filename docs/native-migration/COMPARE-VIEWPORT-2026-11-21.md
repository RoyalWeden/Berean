# Compare layout transition positions — 2026-11-21

Broad goal ACTIVE. Prior turn made progress: per-visit selection history50f00c76 verified on both apps and published with354e5d90. Verify live exact-head CI44945186621; do not use old e39 green for new source. Review/data/identity/merge guards unchanged; no usage resets.

## Reproduction fixture and current UI

Only Codex iPhoneD0CC simulator/source50f00c76, tabdb988d51-7bde-49c8-8749-7f2fa0ba734b, nineworkspace tabs. StartedPSA3LXXunselected. More → ReadingOptions → Compare; Manage → SyncScrollingoff while two panes fit. AddAnotherPassage → Psalmschapter3 appends pinned duplicateLXX; ColumnNavigation → FollowMainPassage for third. Rawcolumns nowLXX/KJVA/LXX, all followPSA3, Syncfalse. At402-point width, three cannot fit independent, so actualrender isalignedstacked, althoughpreserveReadingPositions testsallFollows&&syncScrolling and misses thatmode. This fixture is supported: onlytwo user-selectablePsalm editions exist; adding pinnedduplicate and unpinning is intentional app behavior with distinctcolumnIDs.

Headercontrols live at top of scroll content and disappear while reading. GlobalManage previously offered noClose, requiring a move back to the header to remove a column; that would destroy the very viewport under test. Adding a globalCloseColumn submenu is a separate legitimate usability fix, not viewport instrumentation.

## Dirty global-close slice

Delegate changedCompareView.swift only: Manage → CloseColumn (3+) / CloseColumnandExitCompare (1–2) → ColumnN · Passage · Text. All configured columns listed, including unavailable ones. Header and globalactions use shared closeColumn helper, validate liveactiveBible/Compare/fullorderedpassage/id+historyKey, and preserve remainingfullconfiguredcolumns. Existing one-column legacyfallback and two→oneexit retained. This also avoids a headerreceivingfilteredvisiblecolumns accidentallydropping unavailableothers. No viewportpreservation change yet.

Parse/diff-check passed; Macbuildsession (see current tools/log mac-compare-global-close-build.log) running. Next buildiOSsequentially, installCodexdevice/requerycontainer, retain3-columnfixture. Scrolltoaboutdisplayverse3/4, screenshotbefore; useglobalCloseColumn originalLXXcolumn1 so survivorsKJVA/LXXare distinct and newlyindependent. Observe existing jump before authorizingcorefix. No notes/annotations/tabscreated; finalrestorePSA3LXXunselected and originalrecord/IDcheck required.

## Separate core fix plan, not implemented

Use actualcomparisonLayout(available columns,width) and readingAnchor per survivor. Store rawverse only when its actualchapter matches targetindependentcolumn, avoiding adjacentJonah/Malachiversemismatch. For aligned→aligned cardinalitychange carry a passage-scoped source-gridrow bookmark after newrowsload; retainpixeloffsetonlyforcompatiblepure-reorder. Use currentmode to avoid stale stackedvisible sets winning over actualindependent observations. Keep per-visit selectionhistory50f00c76 intact and testmappedchapter behavior. Full persistedCompareviewport, resize/rapid/accessibility/drag matrix remains open.

MacQA mainGEN1selected1/Notes/446/sidebar239/right1660/current2000-wide, Presenterclosed160%, untouchedduringfixtureprep. Owner app/library untouched. CurrentiPhone has3-columnfixture/no selection; do notmistake it for finalrestoredstate. Parentownsbuilds/UI/docs/Git; CompareView dirtyslice is Codex-owned.


## Baseline confirmed and core implementation underway

Global close is commit e31b8d87, both builds pass (mac/ios-compare-global-close-build.log). Installed Codex simulator PID43695. Actual PSA3 all-following three columns, Syncoff: touch scroll showed verses7–8; Manage→CloseColumn→Column1LXX closed without returning to the headers. Both remaining KJVA/LXX independent panes reset to verse1, screenshot-confirmed. Global menu removes only selected configured column and retains9tabs. This is the exact failed layout transfer, not an inferred scroll bug.

Prepared a longer fixture via primary picker: PSA118LXX with following KJVA119/LXX118, added another pinnedLXX118 then FollowMain. Current iPhone is three columns KJVA119/LXX118/LXX118, allfollowing/Syncfalse/no selection. It is not the final starting reader yet. Pointer-wheel requests did not move the simulator reliably; raising the DeviceHub window then touch-drag works but can fling to chapter ends. Do not classify those tool-input failures as product scrolling regressions.

Core dirty CompareView now captures one pending destination-passage value with actual per-survivor same-chapter raw rows, aligned source-grid row, old stacked preferred survivor and compatible pure-reorder offset. After destination rows load, actual available columns/common layout choose the matching one-shot marker; irrelevant markers clear on later layout changes. Early independent first-row callbacks cannot replace the transfer marker, and queued/visibility callbacks validate active/current/loaded scope. Explicit matching verse jumps win. Adjacent-chapter raw IDs are never written into another independent chapter. No persistent/sync/history-snapshot format change.

Parent found ChooseColumnChapter used an oversized clipped iPhone sheet title in the real fixture setup; final source sets its iOS navigation title inline, leaving Mac unchanged. This is a small related usability refinement. Parent owns final review/build/UI; delegate completed source. Final Macbuild session25003/logmac-compare-viewport-final-build.log running. Prior prototype build passed before the actual-availability refinement and is not final-source evidence. Then iOS build sequentially/install/requery; test longer SyncOff3→2 and SyncOn3→2 plus ordinarySwap/history/explicit jump. Keep all failed evidence and natural end-clamping distinction.


## Continued runtime checks: layout toggles still open

Final dirty viewport candidate built successfully for both apps (`mac-compare-viewport-final-build.log`, `ios-compare-viewport-final-build.log`) and was installed only on Codex D0CC. Actual iPhone long Psalm fixture: Sync off, three following columns KJVA Psalm 119 / LXX Psalm 118 / LXX Psalm 118; after scrolling to verse 5, global Close Column 2 retained verse 5 in both surviving independent panes. This verifies the three-to-two independent transfer within this scope.

Additional actual failures: enabling Sync Scrolling in those two panes reset the aligned view to verse 1. Adding pinned LXX Psalm 118 then scrolling the stacked chapter to around verse 37 and choosing Follow Main Passage restored stale aligned viewport around verse 5–7 instead of current stacked location. Inertia meant the initial AX snapshot lagged the settled screenshot; do not use its verse 28 as exact settled anchor. These are open layout-transition defects, not completed parity. A bounded CompareView-only correction is underway; parent owns builds/UI/publication.

The iPhone Choose Column Chapter inline heading is verified visually: title and Cancel fit cleanly, search and current-text row remain accessible, selected Psalm 118 is visible. Desktop title styling was unchanged. Current simulator remains three all-following columns, Sync on, near verse 5–7, no selection, nine workspace tabs. Restore baseline reader after testing.

## Read-only legacy comparison and next slices

Original Electron persists verse-relative column scroll (`src/components/bible/CompareView.tsx`, scroll callbacks) into nested compareColumns.scrollPos. Native currently reads that legacy fallback but writes new offsets/column verses only to AppModel in-memory maps. `TabFields.nestedLocal` already isolates legacy scrollPos from sync. Cold/restart Compare position persistence remains a real gap; plan compatible local persistence and tests before changing it. Do not put new positions in synchronized fields or confuse in-memory history fixes with durability.

Other separate gaps: synced chapter picker/step should move matching peers as appropriate (Electron canonical chapter groups), while native currently changes/pins only the chosen column. Native already supports live verse-mapped independent scroll; do not report all Sync missing. Selection is currently one scoped column, whereas Electron stores edition-qualified additive refs; cross-column additive selection requires an explicit safe action/target design. Arbitrary typed-tab split preview/hosts and full multi-column Presenter remain open, not solved by Compare.

Mid-fixture original-data check (`compare-viewport-mid-data-check.json`) passes all original note/settings/chat/tag row hashes and exact active IDs: Mac37/22notes, iPhone47/26notes. This does not restore current reading fixture; final restoration and check still required. GitHub draft24 live head354e5d90 remains open on native/m6-navigation with all three checks successful. Local e31/core not covered by that CI.

## Owner correction: columns on iPhone

Owner explicitly requested side-by-side iPhone Compare, instead of vertically stacked texts. Next rendering change will retain synchronized verse-aligned columns and independent pinned columns on iPhone. Additional columns overflow horizontally with readable cell widths, rather than falling back to stacked passages. Compact headers and a number/actions row above verse text avoid squeezing text between two 44-point controls. Mac layout remains unchanged. This supersedes the previous narrow iPhone stacked rendering; keep transition fixes for Mac narrow/pinned cases as well. Actual runtime verification required after new builds.


## 2026-11-21 — Paused Compare columns checkpoint

Local source6fbba670 keeps iPhone Compare side by side with horizontal overflow, compact matching headers/cells, tighter inline verse numbers, no per-verse ellipsis, and complete compact-row selection bounds. Global Close Column is e31b8d87. Shared layout arrivals preserve verified raw verse/source-grid identity instead of stale incompatible offsets. Final Mac+iOS builds pass. Actual iPhone horizontal/vertical scrolling, Sync off/on near10, close3→2, survivor retention and joined text-tap selection verified in bounded scope; final compact selection includes its first number. Mac final runtime, pinned→following and explicit-jump/rapid/accessibility checks remain open. Owner requested pause; not pushed. Next design request is Compare grouped naturally with passage picker. [Precise checkpoint](COMPARE-VIEWPORT-2026-11-21.md).

Final compact row uses inline number/body and whole-row preference bounds, removes the redundant per-verse menu (long-press and selection actions remain), and replaces an inferred Divider overlay with an explicit vertical separator. This also applies to the existing compact independent Mac rendering; desktop main Scripture margins are untouched. Last iPhone source installed PID46466. Tip was manually dismissed during QA; no TipKit code changed. Final safe state is ordinary PSA118LXX/no selection/noCompare/nine tabs, retained configured KJVA119/LXX118/LXX118 pinned, Synctrue. Original PSA3 baseline not restored; leave this clear for successor. Mac remains old runtime50f00c76; final source only build-verified there.

Final both build logs: mac/ios-compare-compact-final-build.log. Original rows/IDs pass compare-columns-final-data-check.json. No private note contents were added to docs. Latest direct owner request: pause within a few minutes, continue later on Compare aesthetics, smaller gaps/noellipsis, include first number in selection, integrate Compare near passage picker. That integration is queued, not done. No source worker/build remains live; no background continuation claimed.

## Nov23 actual Compare history regression (pre-fix runtime)

Source runtime bf4a1b78, isolated Mac controls profile. Existing tab `78014c72-c288-4426-82d8-b8b3adf99cf1` Exodus32, following KJVA/LXX columns, Sync off/right panel closed. Original config saved read-only to `qa-evidence/20261123/compare-history-fixture-baseline.json`. Set left/right native scrollbar .30/.60: settled values .3115599484314568/.6436950146627566, screenshot first complete verses KJVA9/LXX17. CmdL G5485 replaces same tab, then Cmd[ returns Compare with both scrollbars0, still0 on a settled fresh AX observation. This is an actual return-position failure, preceding even the two-visit ambiguity matrix. Returned both panes to original0 and selected original Genesis1 tab; its selected1 and scroll.07135575942915393 retained. No newtabs or content edits; QA global navigation history can contain additional visits.

Dirty per-visit source is under review in AppModel.swift/CompareView.swift (owned design agent); no new native build or pass claimed yet. Restart persistence remains separately OPEN.

## Nov23 implemented and verified per-visit restoration

Source `d349bf41` captures immutable passage-scoped offset/column-verse maps with each in-tab history location. Restoring a visit replaces only its matching map keys, including intentionally empty visits; other destinations remain cached. The history revision reruns restoration in mounted Compare hosts. Shared/independent restoration waits for a ready loaded layout, ignores stale callbacks, and gates early first-row binding writes. Independent visibility callbacks also record native scrollbar movement.

Both native builds passed: `mac-compare-visit-build.log`, `ios-compare-visit-build.log`. Actual extracted snapshot probe and passing log are `compare-visit-snapshot-probe.swift/.log` under qa-evidence/20261123; command: `swift -module-cache-path /tmp/berean-compare-history-swift-cache build/apple/qa-evidence/20261123/compare-visit-snapshot-probe.swift`. Covers immutable capture, exact passage-prefix isolation, Back/Forward and deliberately empty snapshots. No package source changed, so previous372package pass is historical unchanged-package evidence, not a new run for app-only changes.

Actual rebuilt Mac: same Exodus32 KJVA/LXX scrollbar .30/.60 → CmdL G5485 → Back now retains logical first-visible rows8/16 rather than top. Settled restored fractions .2764069264069264/.6312316715542522. Independent restoration aligns the saved verse at top; **exact within-row pixel offset is still OPEN**, not an exact fraction pass. Then Next→Exodus33, read at .2059800664451827/.4275862068965517, Previous→Exodus32, read at .7441325356649793/.85. Back→33 restored .1748135874067937/.4030172413793103; Back→older32 restored original .2764069264069264/.6312316715542522; Forward twice restored the newer32 visit .7204325816843075/.8467741935483871. Thus two distinct visits to the same destination do not share latest scroll.

Restored Exodus32 both panes0 and selected original Genesis1selected1/Notes inspector/.07135575942915393. All original watched row hashes and exact active IDs unchanged (37Mac/47iPhone): compare-visit-data-check.json. Navigation history contains QA visits. No content edits, production/phone/sync/schema/identity writes.

Remaining runtime: iPhone history fix build only (not yet installed), aligned/stacked histories, same-passage explicit jump, rapid reversal/resize and selection precedence. Restart persistence and exact independent intra-row anchors remain required next slices; use [next implementation packet](COMPARE-PERSISTENCE-NEXT-2026-11-23.md).
