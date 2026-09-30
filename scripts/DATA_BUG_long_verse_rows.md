# Data bug: some pseudepigrapha rows contain multiple verses' text concatenated into one row

Found while root-causing the AI Lookup retrieval scoring bug (Team B, Round 12). Not fixed —
`data/*.db` are symlinks into a shared directory the user's main checkout and installed app both
use; this repo's agents are not to write to them. Documenting here per team-lead's request so it
isn't lost, for Michael/a future data re-ingest pass.

## STATUS UPDATE (DATA lane, feature/post-070-pass): enoch.db fixed, others audited

`scripts/fix_enoch_merged_verses.py` (+ `scripts/data_merge_detector.py`, a reusable, read-only
anomaly scanner) now fixes **every** known-merged row in `data/enoch.db`, not just chapter 90's
verse 15 (already handled by `scripts/fix_enoch_ch90.py`). Verified on a scratch copy — do not run
against the symlinked `data/enoch.db` in a worktree directly; always copy the file out first (see
"Exact commands for Michael" below).

### What was wrong (12 chapters, 28 rows)

All are R.H. Charles's own verse-break markers (`6a.`, `7c.`, `14d.`, lone continuation letters
`b.`/`c.`/…) or flattened-wikitable/footnote leftovers (`||`, `{|`, `|}`, a Roman-numeral section
heading like `LIV. 7.-LV. 2. Noachic Fragment...`) still embedded in the row's `text`, instead of
each verse living in its own row:

| Chapter(s) | Pattern | Fix |
|---|---|---|
| 5 (`5:5`), 39 (`39:5`), 91 (`91:13`), 106 (`106:14`, `106:16`), 60 (`60:6`) | later verse(s)' text + markers appended to an earlier verse's row | split at the literal marker, insert missing verse rows (5:6-9, 39:6-14, 91:14-19, 106:17-19, 60:25) |
| 51 (`51:1`, `51:4`), 97 (`97:9`) | Charles sub-verse letters (`5a`/`5b/c/d`, `9c/9d`) | combine lettered fragments onto their integer verse, in the order they appear in the source |
| 54:6, 55:2, 79:1 | section/heading text leaked into verse (`LIV. 7.-LV. 2. Noachic Fragment…`, `Recapitulation of several of the Laws. CHAPTER LXXIX.`) | stripped; heading text discarded entirely, not moved anywhere |
| 22, 27, 32, 89 (`89:41`), 90 (`90:12`, `90:13`) | flattened Ethiopic/Greek parallel-column wikitable — a second "variant reading" column got appended after `\|\|` or `{\|` | truncate at the first `{\|`/`\|\|`, keep only the primary (Ethiopic) column text |
| 89:49 | `48b.` (a Charles sub-verse of 48) appended to 49, followed by a Greek-fragment footnote after `\|\|` | `48b` text appended to verse 48; the Greek footnote dropped (editorial apparatus, not narrative text) |
| 106:16 | Latin-fragment footnote after `\|\|` | dropped (same reasoning) |

Before/after samples (full chapter/verse text, run against the scratch copy):

```
5:5  (was 1341 chars, contained 6a-9) -> 5:5 "Therefore shall ye execrate your days, ... And ye shall find no mercy."
5:6  (new row)                        -> "In those days ye shall make your names an eternal execration ... But on you all shall abide a curse."
5:7  (new row)                        -> "But for the elect there shall be light and joy and peace, And they shall inherit the earth."
5:8  (new row)                        -> "And then there shall be bestowed upon the elect wisdom, ... But they who are wise shall be humble."
5:9  (new row)                        -> "And they shall not again transgress, ... All the days of their life."

39:5 (was 1969 chars, contained 6a-14) -> split into 39:5..39:14 (10 rows), lengths 297/203/337/186/202/162/140/177/160/54
91:13 (was 1260 chars, contained 14-19) -> split into 91:13..91:19 (7 rows)
106:14 (contained 17) -> 106:14 + 106:17
106:16 (contained 18-19 + Latin footnote) -> 106:16 + 106:18 + 106:19 (footnote dropped)
```

Full re-scan after the fix: **0 anomalous rows** in `ENO` (was 28). Second run of the script: **0
changes** (true no-op — confirmed idempotent). FTS5 (`verses_fts`) stays in sync: row counts match
(1063 = 1063), `INSERT INTO verses_fts(verses_fts) VALUES('integrity-check')` passes, and a
full-text search on newly-split verse 5:6 for "execration" correctly returns both 5:5 and 5:6. No
`books.chapters_count` change needed (ENO stays 108 chapters — no per-chapter verse-count metadata
table exists to update).

### Tests

`scripts/__tests__/test_data_merge_detector.py` (`python3 -m unittest
scripts/__tests__/test_data_merge_detector.py`) — 8 passing cases covering: clean row (no
false positive), inline digit marker detection, sub-verse letters not confusing detection,
`||`/wikitable cleanup detection, heading-leak detection, clean-after-split, and idempotence
(scan-scan-scan on an in-memory DB mirroring the real schema, both corrupted and already-fixed
states).

### Broader read-only audit of the other pseudepigrapha/apocrypha DBs

Ran the same detector (`data_merge_detector.scan_all_books`), read-only (`sqlite3 -readonly` /
Python `file:...?mode=ro` URI — no writes made), over every other listed DB:

| DB | Result | Classification |
|---|---|---|
| `lxx.db` | `1KI 2:35` (×15 rows), `1KI 2:46`, `DAN 4:37` (×4), and other lettered-addition verse numbers repeat the **same** `verse_num` across multiple rows, ordered by `id` | **Legitimate LXX source numbering**, not a bug — these are the well-known Rahlfs/Brenton "additional material" verses (e.g. 3 Reigns 2:35a-o, Daniel 4 OG+Theodotion doublets) that print editions letter (35a, 35b, …) but this DB's `verses` table has **no UNIQUE constraint** on `(book_id, chapter, verse_num)`, so they're stored as repeated rows instead. **However: found a real, separate bug downstream** — `src/components/bible/ChapterView.tsx` uses `key={verse.verse_num}` (not `verse.id`) when mapping verses, so React silently drops all but the last of these same-`verse_num` rows on render (14 of 15 rows for `1KI 2:35` never appear on screen). That's a `src/` fix outside this DATA lane's scope — flagged for whichever agent/pass owns `src/components/bible/ChapterView.tsx` (fix: key by `verse.id`, plus decide a display convention — lettered suffixes vs. concatenation — for repeated `verse_num`s). |
| `lxx_brenton.db` | 12 length-outlier rows (`1KI 2:35`, `2:46`, `10:22`, `12:24`, `16:28`; `ESG 1:1`, `3:13`, `4:17`, `8:12`; `JOS 9:2`; `PRO 24:22`; `SIR 1:1`) | **Legitimate** — none contain embedded verse markers, `\|\|`, or heading leaks; these are genuinely long single verses (Esther's Greek Additions A-F, 3 Reigns 12:24a-z, Sirach's Prologue, Proverbs 24's LXX addition) that this DB *does* keep as one unbroken verse (has a `UNIQUE(book_id,chapter,verse_num)` constraint, unlike `lxx.db`, and no duplicate verse_nums were found). No fix needed. |
| `apoc_abraham.db` | Irregular verse numbering with internal gaps in many chapters (5, 6, 10, 12, 13, 14, 17, 18, 19, 22, 28, 29, 32 — e.g. ch. 22 only has verses 3 and 5, missing 4) | **Legitimate source numbering** — `scripts/seed_apoc_abraham.py` ingests verses directly from the numbered `<A Name="T1_C{ch}_V{v}">` anchors in the pseudepigrapha.com HTML transcription of G.H. Box's translation; gaps mean that anchor simply doesn't exist in the source page for that chapter, not an ingestion bug. Not derivable from existing rows — no fix possible/appropriate without re-fetching and diffing against another edition, which is out of scope here. |
| `hermas_taylor.db` | 1 flagged row: `HER_SIM 29:10` ends with what reads as a leaked footnote/cross-reference fragment (`"...2, 2; Eph. i. 22f. The Church is seen or mentioned in Vis. i.-iv.; Sim. viii. 6, ix. 1, 13,"`) | **Suspected real bug, not fixed** — pattern matches the editorial-footnote-leak class fixed in Enoch (54:6/55:2/79:1), but I don't have a reference edition of Taylor's Hermas on hand in this pass to confirm the exact verse-10/footnote boundary with confidence, so per the "don't guess" instruction this is left unresolved. Also worth a second look (not re-confirmed this pass, carried over from the original finding above): `HER_MAN 24:32`/`18:6`. |
| `jubilees.db`, `ep_barnabas.db`, `1clement.db`, `asc_isaiah.db`, `recog_clement.db`, `t12p.db`, `kjva.db` | 0 anomalies | Clean. |

### Exact commands for Michael at merge time (run from the MAIN checkout, `/Users/roywe/Berean`, never from a worktree whose `data/*.db` are symlinks)

```bash
cd /Users/roywe/Berean
cp data/enoch.db data/enoch.db.bak   # backup first
python3 scripts/fix_enoch_merged_verses.py data/enoch.db
# Re-run once more to confirm idempotence (should print "no changes needed"):
python3 scripts/fix_enoch_merged_verses.py data/enoch.db
npm run data:publish
```

The verified fixed copy used to validate all of the above (safe to diff against, never a symlink)
lives at: `/private/tmp/claude-501/-Users-roywe-Berean/d4e7648c-f454-46c9-92e4-4ae1d7e42852/scratchpad/data-fix/enoch.db`
(scratchpad — will not survive past this session; Michael should run the script fresh on
`data/enoch.db` rather than copying that scratch file in).

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
