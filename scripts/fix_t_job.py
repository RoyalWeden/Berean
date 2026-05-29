"""
Repair Testament of Job verse boundaries.

The original seeder sometimes failed to split on verse-number markers embedded
mid-verse (e.g. "...to the ground. 2. And so I went back...").  This script
finds those markers and re-splits the affected verses, renumbering subsequent
verses within the same chapter.
"""

import sqlite3
import re
import shutil

DB_PATH = '/Users/roywe/Berean/data/t_job.db'

shutil.copy(DB_PATH, DB_PATH + '.bak')
print(f'Backed up to {DB_PATH}.bak')


def split_at_markers(vn: int, text: str) -> list:
    """
    Given verse number vn and its text, split on all embedded verse-number
    markers for vn+1, vn+2, … Return list of (verse_num, text) pairs.

    Handles both '. N. text' and the rarer 'N .text' (space before period).
    """
    result = [(vn, text)]
    changed = True
    while changed:
        changed = False
        new_result = []
        for cur_vn, cur_text in result:
            split_here = False
            for next_n in range(cur_vn + 1, cur_vn + 40):
                # Pattern 1: optional-punct  whitespace? N whitespace? .  whitespace+
                p1 = re.search(rf'[.!?\"\']?\s*\b{next_n}\b\s*\.\s+', cur_text)
                # Pattern 2: whitespace+  N  whitespace+  .  (letter/quote immediately after)
                p2 = re.search(rf'\s+{next_n}\s+\.\s*(?=[A-Z\[\"\'\(])', cur_text)
                m = p1 or p2
                if m:
                    before = cur_text[:m.start()].strip()
                    after  = cur_text[m.end():].strip()
                    if before and after:
                        if before[-1] not in '.!?\"\'' :
                            before += '.'
                        new_result.append((cur_vn, before))
                        new_result.extend(split_at_markers(next_n, after))
                        split_here = True
                        changed = True
                        break
            if not split_here:
                new_result.append((cur_vn, cur_text))
        result = new_result
    return result


# ── load all T. Job verses ─────────────────────────────────────────────────

con = sqlite3.connect(DB_PATH)
con.isolation_level = None          # autocommit off; we manage transactions manually
con.execute('BEGIN')

rows = con.execute(
    'SELECT chapter, verse_num, text FROM verses WHERE book_id="TJOB" ORDER BY chapter, verse_num'
).fetchall()

chapters: dict = {}
for ch, vn, text in rows:
    chapters.setdefault(ch, []).append((vn, text))

changed_chapters = 0

for ch, verse_list in sorted(chapters.items()):
    verse_list = sorted(verse_list)

    # Build the repaired verse list
    new_verses = []
    offset = 0
    for vn, text in verse_list:
        adjusted_vn = vn + offset
        splits = split_at_markers(adjusted_vn, text)
        extra = len(splits) - 1
        new_verses.extend(splits)
        offset += extra

    # Re-number sequentially from 1
    renumbered = [(i + 1, text) for i, (_, text) in enumerate(new_verses)]

    orig_count = len(verse_list)
    new_count  = len(renumbered)

    if new_count != orig_count:
        changed_chapters += 1
        print(f'  Chapter {ch}: {orig_count} → {new_count} verses')

        # Delete old rows for this chapter
        con.execute('DELETE FROM verses WHERE book_id="TJOB" AND chapter=?', (ch,))

        # Get next available id
        max_id = con.execute('SELECT MAX(id) FROM verses').fetchone()[0] or 0
        for vn, text in renumbered:
            max_id += 1
            con.execute(
                'INSERT INTO verses (id, book_id, chapter, verse_num, text) VALUES (?,?,?,?,?)',
                (max_id, 'TJOB', ch, vn, text)
            )

# Commit verse changes BEFORE touching FTS
con.execute('COMMIT')
print('Verse changes committed.')

# ── rebuild FTS index ──────────────────────────────────────────────────────
# FTS5 content tables: use the special 'rebuild' command
con.execute('BEGIN')
try:
    con.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")
    con.execute('COMMIT')
    print('FTS rebuilt OK.')
except Exception as e:
    con.execute('ROLLBACK')
    print(f'FTS rebuild failed (non-fatal): {e}')
    print('You can run: INSERT INTO verses_fts(verses_fts) VALUES(\'rebuild\') in SQLite CLI to fix it.')

con.close()

# ── verify ─────────────────────────────────────────────────────────────────
con2 = sqlite3.connect(DB_PATH)
total = con2.execute('SELECT COUNT(*) FROM verses WHERE book_id="TJOB"').fetchone()[0]
print(f'\nTotal T. Job verses now: {total}  (was 312)')

print('\nSpot-checks on previously broken verses:')
for ch, vn in [(2, 1), (2, 2), (2, 3), (5, 2), (5, 3), (7, 1), (7, 2)]:
    row = con2.execute(
        'SELECT text FROM verses WHERE book_id="TJOB" AND chapter=? AND verse_num=?', (ch, vn)
    ).fetchone()
    if row:
        print(f'  Ch {ch}:v{vn}: {repr(row[0][:90])}')
con2.close()

print(f'\nDone. {changed_chapters} chapters repaired.')
