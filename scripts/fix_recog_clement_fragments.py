"""
Clean up stranded chapter-heading fragments and OCR artifacts in
data/recog_clement.db.

The original seed (scripts/seed_recog_clement.py) stripped each ANF chapter
heading with a single-line regex. Where a heading wrapped onto a second line in
the source, that continuation line was left behind as verse_num 1 of the
chapter, pushing the real text to verse 2 — e.g. Book III ch 45 opened with the
lone line "Plagues of Egypt." (the tail of ANF's "Ten Commandments
Corresponding to the Plagues of Egypt"). A few other artifacts slipped through
the same way: three "_" placeholder verses in Book VIII ch 16, two orphaned
closing-quote verses in Book III chs 10/11, and one footnote ("An alteration
intended to improve.") spliced into the body of Book III ch 49.

This does NOT add real chapter titles or re-chapter anything — it only removes
the junk and renumbers the affected chapters' verses so they are contiguous
from 1 again.

Idempotent: each step checks the row still looks like the artifact before
touching it, and re-running is a no-op.
"""
import sqlite3
import sys

DB = '/Users/roywe/Berean/data/recog_clement.db'

# (book_id, chapter): verse 1 is a stranded heading fragment; delete it and
# shift verses 2..N down to 1..N-1. Verified individually against the ANF text.
HEADING_FRAGMENTS = [
    ('RCL1', 12), ('RCL2', 11), ('RCL2', 15), ('RCL2', 25), ('RCL2', 54),
    ('RCL3', 4), ('RCL3', 19), ('RCL3', 28), ('RCL3', 30), ('RCL3', 45),
    ('RCL3', 46), ('RCL3', 56), ('RCL3', 59), ('RCL3', 61),
    ('RCL4', 33), ('RCL6', 15), ('RCL7', 11),
    ('RCL8', 37), ('RCL8', 43), ('RCL8', 46), ('RCL8', 47),
    ('RCL9', 6),
]


def shift_down(cur, book_id, chapter, removed_count):
    """Renumber verse_num so it is contiguous from 1 after `removed_count`
    leading verses were deleted."""
    rows = cur.execute(
        "SELECT id FROM verses WHERE book_id=? AND chapter=? ORDER BY verse_num",
        (book_id, chapter),
    ).fetchall()
    for new_num, (rid,) in enumerate(rows, start=1):
        cur.execute("UPDATE verses SET verse_num=? WHERE id=?", (new_num, rid))


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    changed = 0

    # 1. Stranded single-line heading fragments -----------------------------
    for book_id, chapter in HEADING_FRAGMENTS:
        row = cur.execute(
            "SELECT id, text FROM verses WHERE book_id=? AND chapter=? AND verse_num=1",
            (book_id, chapter),
        ).fetchone()
        if not row:
            continue
        rid, text = row
        v2 = cur.execute(
            "SELECT text FROM verses WHERE book_id=? AND chapter=? AND verse_num=2",
            (book_id, chapter),
        ).fetchone()
        if len(text) >= 60 or not v2 or len(v2[0]) < 60:
            print(f'  SKIP {book_id} {chapter}: v1={text[:50]!r} does not look like a fragment')
            continue
        cur.execute("DELETE FROM verses WHERE id=?", (rid,))
        shift_down(cur, book_id, chapter, 1)
        changed += 1
        print(f'  {book_id} {chapter}: removed fragment {text!r}')

    # 2. Book VIII ch 16 — three "_" placeholder verses -------------------
    rows = cur.execute(
        "SELECT id, verse_num, text FROM verses WHERE book_id='RCL8' AND chapter=16 ORDER BY verse_num"
    ).fetchall()
    junk = [r for r in rows if r[1] <= 3 and r[2].strip(' _-') == '']
    if len(junk) == 3:
        for rid, _, _ in junk:
            cur.execute("DELETE FROM verses WHERE id=?", (rid,))
        shift_down(cur, 'RCL8', 16, 3)
        changed += 1
        print("  RCL8 16: removed 3 '_' placeholder verses")

    # 3. Book III chs 10 & 11 — orphaned closing-quote verses -------------
    for chapter in (10, 11):
        rows = cur.execute(
            "SELECT id, verse_num, text FROM verses WHERE book_id='RCL3' AND chapter=? ORDER BY verse_num",
            (chapter,),
        ).fetchall()
        if rows and rows[-1][2].strip() == '"':
            orphan_id = rows[-1][0]
            prev_id = rows[-2][0]
            prev_text = rows[-2][2]
            if not prev_text.rstrip().endswith('"'):
                cur.execute("UPDATE verses SET text=? WHERE id=?", (prev_text.rstrip() + '"', prev_id))
            cur.execute("DELETE FROM verses WHERE id=?", (orphan_id,))
            shift_down(cur, 'RCL3', chapter, 0)
            changed += 1
            print(f'  RCL3 {chapter}: merged orphan closing-quote into previous verse')

    # 4. Book III ch 49 — footnote spliced into the body ------------------
    BAD = 'he will be drawn to the second by the very An alteration intended to improve.'
    GOOD_V7 = ('But if any one, as being whole and not needing a physician, is not moved to the '
               'first, he will be drawn to the second by the very continuance of the thing, and '
               'will make a distinction of signs and marvels after this fashion;')
    GOOD_V8 = ('-he who is of the evil one, the signs that he works do good to no one; but those '
               'which the good man worketh are profitable to men."')
    v7 = cur.execute("SELECT id, text FROM verses WHERE book_id='RCL3' AND chapter=49 AND verse_num=7").fetchone()
    v8 = cur.execute("SELECT id, text FROM verses WHERE book_id='RCL3' AND chapter=49 AND verse_num=8").fetchone()
    if v7 and BAD in v7[1]:
        cur.execute("UPDATE verses SET text=? WHERE id=?", (GOOD_V7, v7[0]))
        if v8 and v8[1].startswith('Continuance of the thing'):
            cur.execute("UPDATE verses SET text=? WHERE id=?", (GOOD_V8, v8[0]))
        changed += 1
        print('  RCL3 49: repaired footnote splice at v7/v8')

    # verses_fts is external-content with only an AFTER INSERT trigger, so the
    # deletes / text edits above leave it stale — rebuild the whole index.
    if changed:
        cur.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")
    conn.commit()

    # ---- verification -------------------------------------------------------
    ok = cur.execute("PRAGMA integrity_check").fetchone()[0]
    fts_rows = cur.execute("SELECT COUNT(*) FROM verses_fts").fetchone()[0]
    verse_rows = cur.execute("SELECT COUNT(*) FROM verses").fetchone()[0]
    fts_match = cur.execute(
        "SELECT COUNT(*) FROM verses_fts WHERE verses_fts MATCH 'Pharaoh'"
    ).fetchone()[0]
    print(f'fts rows={fts_rows} vs verse rows={verse_rows}; "Pharaoh" matches={fts_match}')
    gaps = cur.execute("""
        SELECT book_id, chapter, MIN(verse_num), MAX(verse_num), COUNT(*)
        FROM verses GROUP BY book_id, chapter
        HAVING MIN(verse_num) <> 1 OR MAX(verse_num) <> COUNT(*)
    """).fetchall()
    print(f'\n{changed} chapters changed. integrity={ok}. non-contiguous chapters: {gaps or "none"}')
    print('\nSpot check (former fragment chapters now open at verse 1):')
    for book_id, chapter in [('RCL3', 45), ('RCL3', 46), ('RCL8', 16), ('RCL9', 6)]:
        t = cur.execute(
            "SELECT text FROM verses WHERE book_id=? AND chapter=? AND verse_num=1", (book_id, chapter)
        ).fetchone()[0]
        print(f'  {book_id} {chapter}:1  {t[:95]}')
    v = cur.execute("SELECT text FROM verses WHERE book_id='RCL3' AND chapter=49 AND verse_num=7").fetchone()[0]
    print(f'  RCL3 49:7  {v[:120]}')
    conn.close()
    if gaps:
        sys.exit('ERROR: left non-contiguous verse numbering')


if __name__ == '__main__':
    main()
