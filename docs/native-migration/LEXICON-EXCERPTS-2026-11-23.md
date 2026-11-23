# Lexicon readable excerpt follow-up — Nov23

Owner reported that several excerpts showed barely any words. The previous implementation used both a context-window crop and a three-line visual cutoff. A short late-match verse could lose useful context; narrow panes could also hide part of the chosen range.

Shared Mac/iPhone `LexiconEntryView` now renders a single bounded range (14 display words compact,20 full tab), backfills earlier words when the match is near the verse end, retains full-verse word indices for match styling, and wraps the entire selected phrase. Missing/invalid matches use the beginning. Expanded Find rows still use full text; copy uses full verse unchanged.

Verification:6focused Swift tests with9argument cases PASS; Swift frontend parse and diff check PASS. Restricted SwiftPM manifest attempt failed due environment sandbox; retry stalled before compilation and was interrupted; authorized native-engine run passed. Log: `build/apple/qa-evidence/20261123/lexicon-excerpt-focused-tests.log`.

Actual Mac QA on convergence build: Genesis1selected1→Strong’s→H776 compact sidepanel.1Chronicles1:10 shows all12words “And Cush begat Nimrod: he began to be mighty upon the earth.” with earth highlighted, wrapping across lines.1:19 shows a readable bounded phrase around earth. Full tab/iPhone visual checks pending. No production writes; named controls QA profile only. Strong’s currently ON and Lexicon inspector selected for check; restore original OFF/Notes before handoff.

## Parent runtime follow-through
Both native builds PASS. MacfullH776tab shows complete20word bounded phrases for Genesis1:2 and1:10, highlight retained. Closed only new fulltab (8→7Study tabs), restored originalreader preferences/fraction. Owned iPhoneH776fulltab: actual screenshot of Genesis7:6,7:10,7:12,7:14,7:17,7:18 shows wrapped readable context with yellowhighlight and no second linecutoff. Go reused original9tabs; restoredMatthew5selected12. iPhonecompact specific fixture remains untested; shared row implementation is not a substitute for that visual matrix. Source e61ebfaa.
