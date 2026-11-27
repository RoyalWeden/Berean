# Claude integration and Codex candidate — November 26, 2026

Root revision `90171b62` integrates Claude Search order and collapsible groups, Messages folder actions and reply jumps, and the audit fixes. The original branches and reports retain their own verification receipts. The dirty owner audit correction for A33 was reconciled: the Calendar’s faded dot for an empty daily note is intentional, while keeping an untouched daily row remains an open question. [Full audit](CLAUDE-FULL-AUDIT-2026-11-26.md)

## Verified runtime

- Mac showed the localized Berean Native Dev app menu and collapsed the whole Search group header without changing the 19-result total. Compare Edit opened the native three-column picker with Books 53 and canceled without edits.
- Mac and iPhone rendered the italic supplied word “of” in John 3:5 red. On iPhone the nonbreaking Strong’s marker G2424 remained tappable and opened the correct Lexicon entry.
- iPhone Compare controls used equal spacing. The long Recognitions Book 10, chapter 1 title used two lines with arrows visible. The picker displayed short Book 1–10 labels and retained full accessibility labels. Back restored Matthew 5:12 with nine tabs, Strong’s off and the panel closed.
- iPhone Compare and regular selection bars exposed Copy, Highlight, More and Clear accessibility actions. Compare highlight choices were visibly distinct and Remove Highlights was absent on unmarked selection. Tapping the Lexicon segment center in the half-screen study sheet selected Lexicon without changing the detent.
- iPhone Find “blessed” showed nine matches with the bar visible and closed cleanly. A10 highlighting inactive matches is a separate working change awaiting verification.
- In settled Mac opening tests, panel toggles measured native offsets 0 → 6 → 0 → 6 → 0 while the opening remained below the toolbar. An eight-line opening-classification refinement is pending. A rapid AX scrollbar change to zero before a scheduled restore sometimes reapplied the saved point. This is neither an observed physical wheel interruption nor a pass for that case.

## Checks and pending work

The full suite passed 397 tests across 96 suites at `77ed8cd3`. The prior Messages quality build at `8ead5f23` passed 394 tests. Probe commit `39ce5f65` verified 68 production-tokenizer cases plus 68 fixture cases on Mac and Simulator and rejected a tampered asset by SHA. PCM, audio quality and app integration remain open. Integration build handles 37970, 31718 and 53507 completed successfully. Fresh owner builds remain separate.

A34 Calendar already reuses its tab in source. Repeat navigation has not been verified live. Study Tools History was added in `23db27e6` and still awaits build and UI checks. A10 inactive-match painting and the residual opening classification remain the outstanding working source in this checkpoint. Broader reflow and accessibility remain open. The owner checkout was still at `3cf65558` with its audit edit. The reconciled A33 correction is in the root audit. No production data or physical phone was touched during this slice.

CC-06 Study Trail and CC-07 Trash remain ready for the owner’s 8:00 p.m. PST Claude resumption after the scheduled 7:55 p.m. Codex pause. The separately authorized physical install was planned for 7:50 p.m.; it had not been performed at this checkpoint. [Work queue](AI-WORK-QUEUE.md)

## 7:26pm update

All-visible Find536ed1b9 passed the final Mac and Simulator builds and actual UI cleanup/stepping tests; details are in FIND-MATCHES. History entry and repeated History/Calendar reuse passed on iPhone. Temporary utility tabs closed; original9 Study tabs remain. Read-only receiptpre8-final-data-check.json retains all watched original rows and37Mac/47iPhone IDs. Source staging safely advanced the owner folder to3fd644d8; dirty A33 audit saved in a recovery stash and backup. Final owner builds/install are scheduled next; they have not yet run. Physical phone unavailable7:17pm. No physical or production-library action so far. Source remains536ed1b9; broader matrix/open tasks remain as documented.
