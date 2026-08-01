"""
Correct HER_MAN highlights (in the app's berean.db, not data/hermas.db) that were created
against the OLD chapter numbering before fix_hermas_mandate3.py's chapter-4-into-3 merge and
chapter>=5 shift-down-by-1 ran.

Root cause: fix_hermas_mandate3.py rewrote data/hermas.db's own verses.chapter/verse_num for
HER_MAN, but highlights (and verse notes) live in a completely separate database (berean.db),
keyed by plain (book_id, chapter, verse_num) with no link back to the verses table or to any
migration history. Any HER_MAN highlight created before that migration ran now resolves against
a (chapter, verse_num) slot occupied by different verse content.

Confirmed against production data (~/Library/Application Support/berean/berean.db): two
highlights on HER_MAN chapter 22 (verses 4 and 5), created 2026-06-15 — well before the
2026-07-03 migration — whose stored char ranges (0-323, 0-212) match HER_MAN chapter 21's
verses 4/5 text lengths (323, 213) almost exactly, but do NOT match current chapter 22's
verses 4/5 (185, 231). No HER_MAN chapter-4 (pre-merge) highlights or affected verse notes
were found in production data, so the "merge chapter 4 into 3" half of the original migration
has nothing to do there today — but it's included anyway so this script stays correct if run
against a different machine's local data that does have such rows.

Usage: python3 scripts/fix_hermas_highlights.py <path-to-berean.db>
Always makes a `<db>.bak-hermas-highlights-fix` copy before writing.
"""
import sqlite3, os, shutil, sys

if len(sys.argv) != 2:
    raise SystemExit(f'Usage: python3 {sys.argv[0]} <path-to-berean.db>')

DB = sys.argv[1]
if not os.path.exists(DB):
    raise SystemExit(f'No such file: {DB}')

BACKUP = DB + '.bak-hermas-highlights-fix'
if os.path.exists(BACKUP):
    raise SystemExit(f'Backup already exists ({BACKUP}) — this script has likely already run against this file. Remove the backup first if you really want to re-run.')
shutil.copyfile(DB, BACKUP)
print(f'Backed up {DB} -> {BACKUP}')

# fix_hermas_mandate3.py was committed 2026-07-03 08:38:27 -0700 (epoch ms below). Any HER_MAN
# highlight/note created before this used the OLD (pre-merge, pre-shift) chapter numbering;
# anything created at/after it already used the new numbering and must be left alone.
CUTOFF_MS = 1783093107000

conn = sqlite3.connect(DB)
cur = conn.cursor()

# 1. Chapter 4 (pre-merge) → merged into chapter 3. Mirrors fix_hermas_mandate3.py's own merge:
#    each old verse_num in chapter 4 is appended after chapter 3's CURRENT max verse_num, in
#    verse_num order. Chapter 3 itself never moves.
ch3_max = cur.execute(
    "SELECT MAX(verse_num) FROM highlights WHERE book_id='HER_MAN' AND chapter=3"
).fetchone()[0] or 0
ch4_rows = cur.execute(
    "SELECT id, verse_num FROM highlights WHERE book_id='HER_MAN' AND chapter=4 AND created_at < ? ORDER BY verse_num",
    (CUTOFF_MS,)
).fetchall()
for i, (row_id, old_verse_num) in enumerate(ch4_rows, start=1):
    new_verse_num = ch3_max + i
    cur.execute("UPDATE highlights SET chapter=3, verse_num=? WHERE id=?", (new_verse_num, row_id))
    print(f'  highlight {row_id}: HER_MAN 4:{old_verse_num} -> 3:{new_verse_num}')
if ch4_rows:
    print(f'Merged {len(ch4_rows)} pre-cutoff highlight row(s) from HER_MAN ch4 into ch3')

# 2. Chapters >= 5 (pre-shift numbering) shift down by 1, matching fix_hermas_mandate3.py.
#    Highest-first so no in-flight collision with a not-yet-shifted row at the target chapter.
shift_rows = cur.execute(
    "SELECT id, chapter FROM highlights WHERE book_id='HER_MAN' AND chapter >= 5 AND created_at < ? ORDER BY chapter DESC",
    (CUTOFF_MS,)
).fetchall()
for row_id, old_chapter in shift_rows:
    cur.execute("UPDATE highlights SET chapter=? WHERE id=?", (old_chapter - 1, row_id))
    print(f'  highlight {row_id}: HER_MAN chapter {old_chapter} -> {old_chapter - 1}')
print(f'Shifted {len(shift_rows)} pre-cutoff highlight row(s) (chapter >= 5) down by 1')

# 3. Same chapter>=5 shift for verse notes, addressed via verse_ref = "HER_MAN.<chapter>.<verse>".
note_rows = cur.execute(
    "SELECT id, verse_ref, created_at FROM notes WHERE verse_ref LIKE 'HER_MAN.%'"
).fetchall()
shifted_notes = 0
for row_id, verse_ref, created_at in note_rows:
    if created_at is None or created_at >= CUTOFF_MS:
        continue
    parts = verse_ref.split('.')
    if len(parts) != 3:
        continue
    _, chapter_str, verse_str = parts
    chapter = int(chapter_str)
    if chapter == 4:
        raise SystemExit(
            f'note {row_id} references HER_MAN.4.{verse_str} pre-cutoff — this script does not '
            'handle the chapter-4-merge case for notes (verse_ref has no analogous verse_num '
            'renumbering rule coded here); handle it manually before re-running.'
        )
    if chapter >= 5:
        new_ref = f'HER_MAN.{chapter - 1}.{verse_str}'
        cur.execute("UPDATE notes SET verse_ref=? WHERE id=?", (new_ref, row_id))
        print(f'  note {row_id}: {verse_ref} -> {new_ref}')
        shifted_notes += 1
print(f'Shifted {shifted_notes} pre-cutoff note(s) (chapter >= 5) down by 1')

conn.commit()
conn.close()
print('Done.')
