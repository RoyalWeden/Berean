# Data bug: some pseudepigrapha rows contain multiple verses' text concatenated into one row

Found while root-causing the AI Lookup retrieval scoring bug (Team B, Round 12). Not fixed —
`data/*.db` are symlinks into a shared directory the user's main checkout and installed app both
use; this repo's agents are not to write to them. Documenting here per team-lead's request so it
isn't lost, for Michael/a future data re-ingest pass.

## Confirmed case: `data/enoch.db`, book `ENO`, chapter 90, verse 15

```sql
sqlite3 data/enoch.db "SELECT verse_num, length(text) FROM verses WHERE book_id='ENO' AND chapter=90 ORDER BY verse_num;"
```

```
1|267
2|240
3|167
4|239
5|203
6|120
7|149
8|139
9|175
10|114
11|222
12|229
13|696
14|216
15|5176   <-- outlier, ~25x its neighbors
```

Verse 90:15's `text` column is **5176 characters** — actually the concatenated text of verses
15 through (at least) 42 of that chapter, run together as one string, including embedded verse
numbers and section headings that leaked into the text itself (e.g. `"...XC. 20-27. Judgement of
the Fallen Angels..."`, `"21. And the Lord called those men..."`). Rows for verse_num 16 through
42 of `ENO` chapter 90 **do not exist separately** in the table — they were never split out.

### Why this matters for retrieval

A verse row this large has enormously more surface area than a normal verse, so it coincidentally
contains many unrelated words. In `electron/ipc/aiLookup.ts`'s keyword scoring
(`keywordOverlapScore`), which does bag-of-words substring matching, this row become a magnet for
false-positive matches on almost any multi-keyword query, because the words just need to appear
*somewhere* in the (huge) text, not as a real phrase. Concretely: it was the sole (wrong) result
returned for a `"the fear of the Lord is the beginning [of wisdom]"` query, beating two genuinely
exact Proverbs matches, purely because "fear"/"lord"/"beginning" all happen to appear somewhere
in its 5176 characters of unrelated Animal-Apocalypse narrative.

## How to verify/find the same pattern elsewhere

Run this per text DB to surface outlier rows (a verse whose length is wildly out of proportion to
its immediate chapter neighbors is the signature):

```sql
SELECT book_id, chapter, verse_num, length(text) AS len FROM verses ORDER BY len DESC LIMIT 5;
```

Spot-checked every pseudepigrapha DB in `data/` (Aug 2026) — top-5-longest-row scan only, not
exhaustive:

| DB | worst row | length | neighbors' typical length | verdict |
|---|---|---|---|---|
| `enoch.db` | ENO 90:15 | 5176 | 100-700 | **confirmed concatenation bug** (verses 16-42 missing as separate rows) |
| `hermas_taylor.db` | HER_MAN 24:32 | 3374 | 8-640 (rest of ch. 24) | **suspected same pattern**, not confirmed — worth checking whether HER_MAN 24 really only has 32 verses or whether later content got folded into verse 32 |
| jubilees, t12p, hermas, 1clement, ep_barnabas, recog_clement, asc_isaiah, 2baruch, apoc_abraham, apoc_elijah, didache_hoole, gad, t_jacob, t_job | — | all under ~1600 chars at their longest | **look normal** — long individual verses (Barnabas 3:1 at 1516, Hermas Taylor 18:6 at 3164, Recognitions 9:36:1 at 1132) but proportionate to real verse-length variance in these texts, no 10x+ outlier vs immediate neighbors the way ENO 90:15 has |

`hermas_taylor.db`'s `HER_MAN 18:6` (3164 chars) is also worth a second look — flagged here but
not diagnosed to the same depth as the confirmed Enoch case.

## Suggested fix (for whoever re-ingests)

Re-run the enoch.db (and hermas_taylor.db, pending confirmation) ingestion for the affected
chapters against the source translation, verifying verse counts against a reference edition
(R.H. Charles for Enoch) so verses 16-42 of ENO 90 get their own rows again instead of living
inside verse 15's `text` column.

## Retrieval-side mitigation already in place

Independent of the data fix: Team B's item 2e ("length normalization" — `mergeAdjacent` /
ad-hoc verse-count caps replaced with per-length scoring) would reduce this row's ability to win
purely on surface area even before the data itself is corrected. Not yet implemented as of this
writing — see the Team B mission brief.
