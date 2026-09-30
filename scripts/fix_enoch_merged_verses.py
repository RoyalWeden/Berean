#!/usr/bin/env python3
"""
Repair merged/corrupted verse rows in data/enoch.db (book ENO, R.H. Charles's
1 Enoch translation).

Background: chapter 90 (verse 15) was already repaired by
scripts/fix_enoch_ch90.py. This script fixes the remaining known cases,
documented in scripts/DATA_BUG_long_verse_rows.md, where a row's `text`
column contains more than one verse's content concatenated together — with
Charles's own verse-break markers (e.g. "6a.", "7c.", "9.", lone
continuation letters "i.", "j.") and/or flattened-wikitable / footnote
leftovers ("||", "{|", "|}") still embedded in the string — instead of each
verse living in its own row.

Every fix below is DERIVED from text already present in the row (split at
the literal marker boundaries that are already in the data) — no verse text
is invented. Sub-verse letters (6a, 6b, ...) are combined onto their integer
verse, preserving the order the fragments appear in the source row. Where a
"||" introduces a flattened-wikitable alternate-column reading or a
footnote-quoted fragment in another language (Latin/Greek), that tail is
editorial apparatus, not narrative text belonging to any verse, and is
dropped entirely — never appended to a verse.

Usage:
    python3 scripts/fix_enoch_merged_verses.py /path/to/enoch.db

Refuses to run against anything that isn't a plain file path you pass
explicitly (no default path) — NEVER point this at data/enoch.db in a
worktree where data/*.db are symlinks into the shared main checkout; copy
it out first. Idempotent: safe to run twice — the second run makes zero
changes because the corrupted long rows it looks for no longer match after
the first run.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from data_merge_detector import scan_book  # noqa: E402

BOOK = "ENO"


def cut(text: str, marker: str) -> tuple[str, str]:
    """Split `text` at the first literal occurrence of `marker`, returning
    (before, after). Raises if marker isn't found — fixes fail loudly rather
    than silently producing wrong output if the source row ever changes."""
    idx = text.index(marker)
    return text[:idx].strip(), text[idx + len(marker):].strip()


def truncate_at(text: str, *seps: str) -> str:
    """Truncate `text` at the first occurrence of whichever of `seps`
    appears earliest. Used to drop flattened-wikitable / footnote tails."""
    cut_idx = None
    for sep in seps:
        i = text.find(sep)
        if i != -1 and (cut_idx is None or i < cut_idx):
            cut_idx = i
    return text[:cut_idx].strip() if cut_idx is not None else text.strip()


def strip_label(text: str, label: str) -> str:
    return text.replace(f" {label} ", " ").replace(f"{label} ", "").strip()


# ---------------------------------------------------------------------------
# Per-chapter fixers. Each takes the current {verse_num: text} for the whole
# chapter and returns a dict of {verse_num: new_text} for every verse_num it
# touches (existing rows whose text shrinks, and brand-new verse_nums to
# insert). Returning {} means "nothing to do" (already fixed / idempotent).
# ---------------------------------------------------------------------------

def fix_ch5(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(5, "")
    if "6a." not in text:
        return {}
    v5, rest = cut(text, "6a.")
    seg_6a, rest = cut(rest, "b.")
    seg_6b, rest = cut(rest, "7c.")
    seg_7c, rest = cut(rest, "6d.")
    seg_6d, rest = cut(rest, "e.")
    seg_6e, rest = cut(rest, "f.")
    seg_6f, rest = cut(rest, "g.")
    seg_6g, rest = cut(rest, "i.")
    seg_6i, rest = cut(rest, "j.")
    seg_6j, rest = cut(rest, "7a.")
    seg_7a, rest = cut(rest, "b.")
    seg_7b, rest = cut(rest, "8.")
    seg_8, rest = cut(rest, "9.")
    seg_9 = rest.strip()
    # 6c is mislabeled "7c." in the source (Charles apparatus quirk) but its
    # content is plainly verse 6's third line, sandwiched between 6b and 6d.
    v6 = " ".join([seg_6a, seg_6b, seg_7c, seg_6d, seg_6e, seg_6f, seg_6g, seg_6i, seg_6j])
    v7 = " ".join([seg_7a, seg_7b])
    return {5: v5, 6: v6, 7: v7, 8: seg_8, 9: seg_9}


def fix_ch39(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(5, "")
    if "6a." not in text:
        return {}
    v5, rest = cut(text, "6a.")
    seg_6a, rest = cut(rest, "7a.")
    seg_7a, rest = cut(rest, "6b.")
    seg_6b, rest = cut(rest, "7b.")
    seg_7b, rest = cut(rest, "8.")
    seg_8, rest = cut(rest, "9.")
    seg_9, rest = cut(rest, "10.")
    seg_10, rest = cut(rest, "11.")
    seg_11, rest = cut(rest, "12.")
    seg_12, rest = cut(rest, "13.")
    seg_13, rest = cut(rest, "14.")
    seg_14 = rest.strip()
    return {
        5: v5,
        6: " ".join([seg_6a, seg_6b]),
        7: " ".join([seg_7a, seg_7b]),
        8: seg_8, 9: seg_9, 10: seg_10, 11: seg_11, 12: seg_12, 13: seg_13, 14: seg_14,
    }


def fix_ch91(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(13, "")
    if "14d." not in text:
        return {}
    v13, rest = cut(text, "14d.")
    seg_14d, rest = cut(rest, "14a.")
    seg_14a, rest = cut(rest, "b.")
    seg_14b, rest = cut(rest, "c.")
    seg_14c, rest = cut(rest, "15.")
    seg_15, rest = cut(rest, "16.")
    seg_16, rest = cut(rest, "17.")
    seg_17, rest = cut(rest, "18.")
    seg_18, rest = cut(rest, "19.")
    seg_19 = rest.strip()
    # Order preserved exactly as it appears in the source row (14d precedes
    # 14a-c there — a Charles critical-apparatus ordering, not a mistake to
    # "correct" by re-sorting the letters).
    v14 = " ".join([seg_14d, seg_14a, seg_14b, seg_14c])
    return {13: v13, 14: v14, 15: seg_15, 16: seg_16, 17: seg_17, 18: seg_18, 19: seg_19}


def fix_ch106(verses: dict[int, str]) -> dict[int, str]:
    out = {}
    t14 = verses.get(14, "")
    if "17." in t14:
        v14, seg_17 = cut(t14, "17.")
        out[14] = v14
        out[17] = seg_17
    t16 = verses.get(16, "")
    if "18." in t16:
        v16, rest = cut(t16, "18.")
        seg_18, seg_19 = cut(rest, "19.")
        # Everything after "||" in seg_19 is an untranslated Latin fragment
        # quoted as a footnote (a variant/lost recension) — editorial
        # apparatus, not part of the English verse text.
        seg_19 = truncate_at(seg_19, "||")
        out[16] = v16
        out[18] = seg_18
        out[19] = seg_19
    return out


def fix_ch51(verses: dict[int, str]) -> dict[int, str]:
    t1 = verses.get(1, "")
    t4 = verses.get(4, "")
    if "5a." not in t1:
        return {}
    v1, seg_5a = cut(t1, "5a.")
    v4, rest = cut(t4, "5b.")
    seg_5b, rest = cut(rest, "c.")
    seg_5c, seg_5d = cut(rest, "d.")
    v5 = " ".join([seg_5a, seg_5b, seg_5c, seg_5d])
    return {1: v1, 4: v4, 5: v5}


def fix_ch97(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(9, "")
    if "9c." not in text:
        return {}
    # These sub-letters all belong to verse 9 itself (no 9a/9b labels were
    # ever present — the row's own leading text is the unlabelled 9a/9b) —
    # strip the redundant inline labels only, do not split into new rows.
    before, rest = cut(text, "9c.")
    seg_c, seg_d = cut(rest, "9d.")
    return {9: " ".join([before, seg_c, seg_d])}


def fix_ch54(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(6, "")
    marker = "LIV."
    if marker not in text:
        return {}
    v6, _heading = cut(text, marker)
    return {6: v6}


def fix_ch55(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(2, "")
    marker = "LV."
    if marker not in text:
        return {}
    v2, _heading = cut(text, marker)
    return {2: v2}


def fix_ch79(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(1, "")
    marker = "CHAPTER LXXIX. 1."
    if marker not in text:
        return {}
    # "Recapitulation of several of the Laws. CHAPTER LXXIX." is a
    # section/chapter title leaked ahead of verse 1's real text — every
    # other chapter's verse 1 in this book starts directly with narrative
    # text (spot-checked chapters 6, 12, 17, 37, 58, 72, 80, 81, 91, 100,
    # 108), so this is isolated editorial-heading contamination, not a
    # book-wide convention to preserve.
    _heading, v1 = cut(text, marker)
    return {1: v1}


def fix_ch60(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(6, "")
    if "25." not in text:
        return {}
    v6, seg_25 = cut(text, "25.")
    return {6: v6, 25: seg_25}


def fix_ch89(verses: dict[int, str]) -> dict[int, str]:
    t49 = verses.get(49, "")
    if "48b." not in t49:
        return {}
    v49, rest = cut(t49, "48b.")
    seg_48b = truncate_at(rest, "||")
    t48 = verses.get(48, "")
    v48 = (t48.rstrip(".") + "; " + seg_48b[0].lower() + seg_48b[1:]).strip()
    if not v48.endswith("."):
        v48 += "."
    return {48: v48, 49: v49}


def fix_ch90(verses: dict[int, str]) -> dict[int, str]:
    text = verses.get(13, "")
    if "||" not in text:
        return {}
    v13 = truncate_at(text, "||")
    return {13: v13}


def fix_wikitable_chapter(verses: dict[int, str]) -> dict[int, str]:
    """Generic fix for chapters (22, 32) built from a flattened
    Ethiopic/Greek parallel-column wikitable: every row keeps only its
    primary (Ethiopic) column text, truncated at the first "{|" (table
    start) or "||" (alternate-column variant reading) leftover."""
    out = {}
    for vnum, text in verses.items():
        if "{|" in text or "||" in text:
            new_text = truncate_at(text, "{|", "||")
            if new_text != text:
                out[vnum] = new_text
    return out


CHAPTER_FIXERS = {
    5: fix_ch5,
    39: fix_ch39,
    51: fix_ch51,
    54: fix_ch54,
    55: fix_ch55,
    60: fix_ch60,
    79: fix_ch79,
    89: fix_ch89,
    90: fix_ch90,
    91: fix_ch91,
    97: fix_ch97,
    106: fix_ch106,
}


def load_chapter(cur: sqlite3.Cursor, chapter: int) -> dict[int, str]:
    rows = cur.execute(
        "SELECT verse_num, text FROM verses WHERE book_id=? AND chapter=?",
        (BOOK, chapter),
    ).fetchall()
    return {vnum: text for vnum, text in rows}


def all_chapters(cur: sqlite3.Cursor) -> list[int]:
    return [r[0] for r in cur.execute(
        "SELECT DISTINCT chapter FROM verses WHERE book_id=? ORDER BY chapter", (BOOK,)
    ).fetchall()]


def upsert_verse(cur: sqlite3.Cursor, chapter: int, verse_num: int, text: str) -> str:
    existing = cur.execute(
        "SELECT id, text FROM verses WHERE book_id=? AND chapter=? AND verse_num=?",
        (BOOK, chapter, verse_num),
    ).fetchone()
    if existing is None:
        cur.execute(
            "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?,?,?,?)",
            (BOOK, chapter, verse_num, text),
        )
        return "inserted"
    row_id, old_text = existing
    if old_text == text:
        return "unchanged"
    # No AFTER UPDATE trigger exists on `verses` for this external-content
    # FTS5 table (only AFTER INSERT) — so an UPDATE must be told to FTS as an
    # explicit delete-old + reflect-new, the same pattern fix_enoch_ch90.py
    # uses for its delete+reinsert.
    cur.execute(
        "INSERT INTO verses_fts(verses_fts, rowid, text, book_id, chapter, verse_num) "
        "VALUES ('delete', ?, ?, ?, ?, ?)",
        (row_id, old_text, BOOK, chapter, verse_num),
    )
    cur.execute("UPDATE verses SET text=? WHERE id=?", (text, row_id))
    cur.execute(
        "INSERT INTO verses_fts(rowid, text, book_id, chapter, verse_num) VALUES (?,?,?,?,?)",
        (row_id, text, BOOK, chapter, verse_num),
    )
    return "updated"


def run(db_path: str) -> int:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    print(f"=== fix_enoch_merged_verses.py on {db_path} ===")
    before_anomalies = list(scan_book(conn, BOOK))
    print(f"before: {len(before_anomalies)} anomalous rows detected in {BOOK}")

    summary = []
    try:
        cur.execute("BEGIN")
        for chapter, fixer in sorted(CHAPTER_FIXERS.items()):
            verses = load_chapter(cur, chapter)
            if not verses:
                continue
            changes = fixer(verses)
            for vnum, text in sorted(changes.items()):
                action = upsert_verse(cur, chapter, vnum, text)
                if action != "unchanged":
                    summary.append(f"  ch{chapter}:{vnum} -> {action} ({len(text)} chars)")

        # Second phase: a chapter-agnostic catch-all for flattened-wikitable
        # leftovers ("{|" parallel-column table syntax, "||" alternate-
        # reading/footnote tails) anywhere in the book, including chapters
        # not named above. Safe to run after the phase-1 splits: none of
        # their newly-written text contains "{|"/"||", so this never
        # conflicts with a specific fixer — it only mops up chapters like
        # 22, 27, 32, 89, 90 that were never given their own numbered-marker
        # split.
        for chapter in all_chapters(cur):
            verses = load_chapter(cur, chapter)
            changes = fix_wikitable_chapter(verses)
            for vnum, text in sorted(changes.items()):
                action = upsert_verse(cur, chapter, vnum, text)
                if action != "unchanged":
                    summary.append(f"  ch{chapter}:{vnum} -> {action} ({len(text)} chars) [wikitable-cleanup]")

        conn.commit()
    except Exception:
        conn.rollback()
        raise

    if summary:
        print(f"applied {len(summary)} row changes:")
        for line in summary:
            print(line)
    else:
        print("no changes needed (already fixed — idempotent no-op)")

    after_anomalies = list(scan_book(conn, BOOK))
    print(f"after: {len(after_anomalies)} anomalous rows detected in {BOOK}")
    for a in after_anomalies:
        print(f"  UNRESOLVED: {a}")

    conn.close()
    return 0 if not after_anomalies else 1


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python3 fix_enoch_merged_verses.py /path/to/enoch.db")
        sys.exit(2)
    db_path = sys.argv[1]
    if not Path(db_path).is_file():
        print(f"refusing: {db_path} is not a file")
        sys.exit(2)
    sys.exit(run(db_path))


if __name__ == "__main__":
    main()
