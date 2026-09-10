"""
Fix 1 Clement chapter alignment (data/1clement.db).

Problem: the seed placed the letter's opening salutation ("The Church of God
which sojourneth in Rome...") as chapter 1. Lightfoot's translation treats that
salutation as an *unnumbered prologue*, followed by 65 numbered chapters. The DB
therefore had 66 chapters and every chapter from 2 on was off by one (DB 42 =
Lightfoot 41, etc.).

Fix: shift every chapter down by one, so the salutation becomes chapter 0
(the unnumbered-prologue convention already used for Sirach -- see
src/lib/prologueBooks.ts) and the 65 real chapters become 1..65. Update
books.chapters_count 66 -> 65.

The verses_fts index only covers `text` (not chapter/verse_num) and there are no
sync triggers, so renumbering needs no FTS rebuild.

Idempotent: refuses to run twice (checks for an existing chapter 0).
"""
import sqlite3
import sys

DB = '/Users/roywe/Berean/data/1clement.db'

conn = sqlite3.connect(DB)
try:
    cur = conn.cursor()

    minc, maxc = cur.execute("SELECT MIN(chapter), MAX(chapter) FROM verses WHERE book_id='1CL'").fetchone()
    if minc == 0:
        print(f'Already fixed (chapter 0 present). min/max = {minc}/{maxc}. Nothing to do.')
        sys.exit(0)
    if (minc, maxc) != (1, 66):
        print(f'Unexpected chapter range {minc}..{maxc} (expected 1..66). Aborting.')
        sys.exit(1)

    salutation = cur.execute(
        "SELECT text FROM verses WHERE book_id='1CL' AND chapter=1 AND verse_num=1"
    ).fetchone()[0]
    assert 'sojourneth in Rome' in salutation, f'chapter 1 is not the salutation: {salutation[:80]!r}'

    cur.execute("UPDATE verses SET chapter = chapter - 1 WHERE book_id='1CL'")
    cur.execute("UPDATE books SET chapters_count = 65 WHERE id='1CL'")
    conn.commit()

    minc, maxc = cur.execute("SELECT MIN(chapter), MAX(chapter) FROM verses WHERE book_id='1CL'").fetchone()
    cc = cur.execute("SELECT chapters_count FROM books WHERE id='1CL'").fetchone()[0]
    n0 = cur.execute("SELECT COUNT(*) FROM verses WHERE book_id='1CL' AND chapter=0").fetchone()[0]
    ok = cur.execute("PRAGMA integrity_check").fetchone()[0]
    print(f'Done. chapter range {minc}..{maxc}, chapters_count={cc}, prologue verses={n0}, integrity={ok}')
    print('Spot check:')
    for ch in (0, 1, 40, 41, 42, 65):
        row = cur.execute(
            "SELECT text FROM verses WHERE book_id='1CL' AND chapter=? AND verse_num=1", (ch,)
        ).fetchone()
        label = 'prologue' if ch == 0 else f'ch {ch}'
        print(f'  {label}: {row[0][:90]}')
finally:
    conn.close()
