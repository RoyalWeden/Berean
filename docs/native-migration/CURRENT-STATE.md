# Current native migration checkpoint

2026-11-23, Codex. **Broad goal ACTIVE.** Claude-change audit source fixes integrated locally; owner adds KJVA BOOKS and excerpt-context refinement. Read HANDOFF, OWNER-PRINCIPLES, AI-CONTINUITY and [current audit](CLAUDE-AUDIT-2026-11-23.md).

## Source and review

- Repo `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch native/reader-notes. Baseline clean1b58c644 safely fast-forwarded to Claude50732392 (34commits/30files). Audit source is committed locally through `6fc04d7e`; documentation remains dirty until the next documentation commit. Publication and exact-head checks pending. Othercheckout `/Users/roywe/Berean-native` read-only/untouched.
- Draft24 OPEN/draft/base native/m6-navigation at50732392; its three green checks45195098164 cover baseline only. Publish github only; origin owner-local. Owner-only merge order22→23 after retarget/green→24; no merge/ready/retarget/force.
- All source workers completed/stopped. Notes/data slices integrated and centrally reviewed; reader delegate returned no evidence and was stopped, primary reviewed that slice. Doc worker only owns dated CHANGELOG/STATUS/TASKS/FULL-FEATURE-PARITY/DECISIONS additions. Preserve all dirty work.

## Implemented and verified scope

- Visible Macsidebar and iPhoneMore StudyTrail/Messages, plus command aliases; opens existing tools without tabs. KJVA picker opens BOOKS with currenthighlight, OT/NT/Apoc sections. Actual Mac+iPhone access and picker checks PASS; iPhone Sirachprologue reachable, sameMatthew5selected12/9tabs returned; Mac7tabs retained.
- Lexicon rendering clips around matchedwords independently of fullverse filtering/copy. Actual MacH776 late“earth” visible and CopyVerse full1Chronicles1:10 verified. Owner then reported insufficient surrounding words: source now keeps up to7precedingwords within56/72characterbudget,2newregressions. Actual rebuilt Mac final context verified: “… he began to be mighty upon the earth.” with earth highlighted; adjacent rows retain context. iPhone snippet runtime remains pending.
- Trail recursive branch/sticky moves, stale no-op, active recording guards, merge tags/manualrecap protection; failure retains selection and reports errors, better folds. Notes slash formatting becomes single validated edit, Boardbulk actions use visible rows, wide-table clipping replaced content-preservingwrap. Full horizontal editable grid OPEN. PDFbookmark label editor retains draft/error. Chat scoped reads preserve content/error+accessibility; Spotlight updates indexed tabtitles.
- Continuity rules now explicitly require BOTH HANDOFFtop and CURRENT-STATE continuously updated, not only historical appends. Full evidence/remainingchecks in audit.

## Tests and runtime ownership

- Both native verified buildsPASS, full-package-verified-tests.log366conformance+4CoreSwiftTesting=370PASS. Notes45focused+7composition, data5focused, fold6+command aliasesPASS. Failed parentNULLanchorfixture was impossible under NOTNULLschema; removed without schema change. Final excerpt adjustment: Mac and iOS builds PASS in mac/ios-lexicon-context-build.log; full-package-context-tests.log PASS368conformance+4Core=372tests. Old370pass is historical.
- QAevidence `build/apple/qa-evidence/20261123`. MacQA exact app in DerivedData-codex-20261121, QA library BereanNativeQA-codex-controls-20261119. OthercheckoutnativePID2506 untouched. Owned iPhoneD0CC only; E8BClaude and physicalphone untouched. Devidentities unchanged. Fresh baselines37/47activeIDs,22/26notes,2/0trails; all watched original-row hashes and tab ID sets rechecked unchanged (original-data-verification.json). No note/chat/trail/PDF mutations during UI checks; only QA presentation/history state may change.
- No production/sync/schema/identity/signing writes, Applevoices or resets. PreservedPresenterstash untouched. Dev-iCloud deferred; historicalstop superseded by latestdirectcontinue.

## Next executable work

1. Source verified and committed: ca7d0a8c Trail/PDF,04febca1 Notes,6fc04d7e navigation/lexicon. Keep documentation/current pair synchronized.
2. Commit focused source/docs, normalgithubpush, inspect exactnewheadCI; synchronize both current summaries before final reply/handover.
3. Runtime Go→StudyTrail/Messages, Notes slashUndo/Board, PDFlabel/failure, iPhonesnippets/accessibility remain pending; do not claim allGUI tested.
4. Continue durableCompare/pervisitviewport, knownscroll/foreground gaps, Presenter/readaloud and broader parity. Technicalqueue is not allowner-gated. SeeTASKS/audit.
