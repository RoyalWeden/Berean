"""
Merge Shepherd of Hermas (Roberts-Donaldson) Mandate 3 back into a single chapter.

Root cause: the RD source text has a `CHAP. II` marker inserted mid-paragraph
inside Mandate 3 (the sentence "...rob Him, not giving back to Him the deposit
which..." at HER_MAN 3:2 continues directly into "wept most violently..." at
HER_MAN 4:1). seed_hermas.py treats every `CHAP.` marker as a hard chapter
break, so it wrongly split one unit into two db chapters (3 and 4).

This migration:
  1. Backs up data/hermas.db to data/hermas.db.bak
  2. Appends HER_MAN chapter 4's verses onto the end of chapter 3 (renumbered
     to continue chapter 3's verse sequence)
  3. Shifts every HER_MAN chapter >= 5 down by 1 (5->4, 6->5, ... 25->24),
     preserving the existing gap at the old chapter 9 (moves to new chapter 8)
  4. Updates books.chapters_count for HER_MAN (25 -> 24)
  5. Rebuilds the FTS index

Run once: python3 scripts/fix_hermas_mandate3.py
"""
import sqlite3, os, shutil

DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'hermas.db')
BACKUP = DB + '.bak'

shutil.copyfile(DB, BACKUP)
print(f'Backed up {DB} -> {BACKUP}')

conn = sqlite3.connect(DB)
conn.execute('PRAGMA journal_mode=DELETE')
cur = conn.cursor()

# 1. Merge chapter 4 into chapter 3
ch3_max = cur.execute(
    "SELECT MAX(verse_num) FROM verses WHERE book_id='HER_MAN' AND chapter=3"
).fetchone()[0]
ch4_rows = cur.execute(
    "SELECT verse_num, text FROM verses WHERE book_id='HER_MAN' AND chapter=4 ORDER BY verse_num"
).fetchall()
if not ch4_rows:
    raise SystemExit('HER_MAN chapter 4 has no rows — migration already applied?')

for i, (old_verse_num, text) in enumerate(ch4_rows, start=1):
    cur.execute(
        "UPDATE verses SET chapter=3, verse_num=? WHERE book_id='HER_MAN' AND chapter=4 AND verse_num=?",
        (ch3_max + i, old_verse_num)
    )
print(f'Merged {len(ch4_rows)} verses from HER_MAN ch4 into ch3 (now {ch3_max + len(ch4_rows)} verses)')

# 2. Shift every chapter >= 5 down by 1 (must go lowest-first: each target slot was just
#    vacated by the previous iteration, since chapter 4 is empty after the merge above)
chapters_to_shift = [row[0] for row in cur.execute(
    "SELECT DISTINCT chapter FROM verses WHERE book_id='HER_MAN' AND chapter >= 5 ORDER BY chapter ASC"
).fetchall()]
for ch in chapters_to_shift:
    cur.execute(
        "UPDATE verses SET chapter=? WHERE book_id='HER_MAN' AND chapter=?",
        (ch - 1, ch)
    )
print(f'Shifted {len(chapters_to_shift)} chapters (>=5) down by 1')

# 3. Update chapters_count (max chapter number, preserving the gap convention)
new_max = cur.execute(
    "SELECT MAX(chapter) FROM verses WHERE book_id='HER_MAN'"
).fetchone()[0]
cur.execute("UPDATE books SET chapters_count=? WHERE id='HER_MAN'", (new_max,))
print(f'Updated HER_MAN chapters_count -> {new_max}')

# 4. Rebuild FTS index
cur.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")

conn.commit()
conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
conn.close()
print('Done.')
