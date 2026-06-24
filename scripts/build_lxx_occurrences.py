#!/usr/bin/env python3
"""
scripts/build_lxx_occurrences.py

Extends strongs_greek.db.occurrences to include LXX (Brenton) occurrences:

1. Adds text_id column to occurrences (existing rows get text_id='kjva' default)
2. Parses lxx_brenton.db text_tagged to collect G-numbers per verse
3. Inserts LXX occurrence rows (text_id='lxx')
4. Refreshes occurrence_count to reflect KJVA + LXX combined
"""

import sqlite3
import re
from pathlib import Path

STRONGS_DB  = Path('data/strongs_greek.db')
BRENTON_DB  = Path('data/lxx_brenton.db')

def main() -> None:
    greek_db  = sqlite3.connect(str(STRONGS_DB))
    brenton   = sqlite3.connect(str(BRENTON_DB))

    # ── 1. Add text_id column if missing ─────────────────────────────────────
    cols = {r[1] for r in greek_db.execute("PRAGMA table_info(occurrences)")}
    if 'text_id' not in cols:
        # DEFAULT 'kjva' fills all existing rows automatically in SQLite
        greek_db.execute("ALTER TABLE occurrences ADD COLUMN text_id TEXT NOT NULL DEFAULT 'kjva'")
        greek_db.commit()
        print("Added text_id column (existing rows set to 'kjva')")
    else:
        print("text_id column already present")

    # ── 2. Remove any stale LXX rows so this script is idempotent ────────────
    greek_db.execute("DELETE FROM occurrences WHERE text_id = 'lxx'")
    greek_db.commit()

    # ── 3. Build book_id → rowid map from lxx_brenton.db ─────────────────────
    book_rowid: dict[str, int] = {
        bid: rid for rid, bid in brenton.execute(
            "SELECT rowid, id FROM books ORDER BY rowid"
        )
    }

    # ── 4. Parse text_tagged and collect G-number occurrences ────────────────
    print("Scanning LXX text_tagged for G-number occurrences …")
    TAG_RE = re.compile(r'\{(G\d+)\}')

    lxx_occs: list[tuple[str, str, int, int, int]] = []  # (strongs_id, text_id, book_num, ch, vs)

    rows = brenton.execute(
        "SELECT book_id, chapter, verse_num, text_tagged "
        "FROM verses WHERE text_tagged IS NOT NULL AND text_tagged != ''"
    ).fetchall()

    for book_id, chapter, verse_num, text_tagged in rows:
        book_num = book_rowid.get(book_id, 0)
        if not book_num:
            continue
        seen: set[str] = set()
        for m in TAG_RE.finditer(text_tagged):
            g = m.group(1)
            if g and g not in seen:
                seen.add(g)
                lxx_occs.append((g, 'lxx', book_num, chapter, verse_num))

    unique_g = len({r[0] for r in lxx_occs})
    print(f"  {len(lxx_occs):,} LXX occurrence rows ({unique_g:,} unique G-numbers)")

    # ── 5. Insert LXX occurrences ─────────────────────────────────────────────
    greek_db.executemany(
        "INSERT INTO occurrences (strongs_id, text_id, book_num, chapter, verse) "
        "VALUES (?, ?, ?, ?, ?)",
        lxx_occs
    )
    greek_db.commit()

    # ── 6. Refresh occurrence_count (KJVA + LXX combined) ────────────────────
    print("Refreshing occurrence_count …")
    greek_db.execute("""
        UPDATE entries SET occurrence_count = (
            SELECT COUNT(*) FROM occurrences
            WHERE occurrences.strongs_id = entries.strongs_id
        )
    """)
    greek_db.commit()

    # ── 7. Add index on (strongs_id, text_id) if not present ─────────────────
    idxs = {r[1] for r in greek_db.execute("SELECT type, name FROM sqlite_master WHERE type='index'")}
    if 'idx_occ_strong_text' not in idxs:
        greek_db.execute("CREATE INDEX idx_occ_strong_text ON occurrences(strongs_id, text_id)")
        greek_db.commit()
        print("Added index idx_occ_strong_text")

    total = greek_db.execute("SELECT COUNT(*) FROM occurrences").fetchone()[0]
    print(f"\nDone — {total:,} total occurrence rows (KJVA + LXX)")

    # Spot-check
    for g in ('G2316', 'G1722', 'G746'):
        kjva_n = greek_db.execute("SELECT COUNT(*) FROM occurrences WHERE strongs_id=? AND text_id='kjva'", (g,)).fetchone()[0]
        lxx_n  = greek_db.execute("SELECT COUNT(*) FROM occurrences WHERE strongs_id=? AND text_id='lxx'",  (g,)).fetchone()[0]
        print(f"  {g}: KJVA={kjva_n}  LXX={lxx_n}")

    brenton.close()
    greek_db.close()

if __name__ == '__main__':
    main()
