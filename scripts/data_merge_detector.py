"""Reusable, read-only detector for "merged verse row" data corruption in the
pseudepigrapha/apocrypha SQLite DBs under data/*.db (schema: verses(book_id,
chapter, verse_num, text), see scripts/DATA_BUG_long_verse_rows.md).

The corruption signature: a row's `text` contains more than one verse's
content concatenated together, usually with the original editor's verse-break
markers still embedded literally in the string (e.g. "6a.", "7c.", "9.",
lone continuation letters like "i.", "j."), and/or leftover non-text
editorial/markup symbols ("||", "{|", "|}" from a flattened wikitable,
or a Roman-numeral section heading like "LIV. 7.-LV. 2. Noachic Fragment...").

This module only *detects* — it never mutates a database. It is used by
fix_enoch_merged_verses.py (to decide which rows need attention and to
verify the fix leaves no residue) and, read-only, for the broader audit of
the other texts (lxx, lxx_brenton, apoc_abraham, hermas_taylor, jubilees,
ep_barnabas, 1clement, asc_isaiah, recog_clement, t12p, kjva).
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field

# A verse marker embedded mid-string: "6a.", "14.", "106." etc., followed by
# a capital letter / opening bracket / dagger (i.e. the start of a new
# clause), so we don't false-positive on things like "at 3. o'clock" (not
# that this corpus has any) or ordinary sentence-internal numerals.
INLINE_MARKER_RE = re.compile(r"(?:^|[.’”]\s|\s)(\d{1,3})([a-z])?\.\s+(?=[A-Z†\[\(‘])")

# A lone continuation letter marker: "b.", "c.", "i.", "j." etc. — only
# meaningful directly after another marker's segment, so callers should pair
# this with INLINE_MARKER_RE rather than use it alone for detection.
CONTINUATION_LETTER_RE = re.compile(r"(?:^|\s)([a-z])\.\s+(?=[A-Z†\[\(‘])")

# Flattened-wikitable / editorial-apparatus leftovers.
WIKITABLE_RE = re.compile(r"\{\||\|\}|\|-|!!\s*\w+\s*!!\s*\w+")
DOUBLE_PIPE_RE = re.compile(r"\|\|")

# Section/heading leaks: Roman numeral + verse range + a title-cased
# "Fragment"/"Judgement"/"Vision" style heading, e.g.
# "LIV. 7.-LV. 2. Noachic Fragment on the first World Judgement."
HEADING_LEAK_RE = re.compile(
    r"\b[IVXLCDM]{2,7}\.\s*\d+.{0,40}?\b(Fragment|Judgement|Judgment|Vision|Parable|Apocalypse)\b"
)


@dataclass
class Anomaly:
    book_id: str
    chapter: int
    verse_num: int
    length: int
    reasons: list = field(default_factory=list)
    sample: str = ""

    def __str__(self) -> str:
        return (
            f"{self.book_id} {self.chapter}:{self.verse_num} (len={self.length}) "
            f"[{', '.join(self.reasons)}] :: {self.sample}"
        )


def classify_text(text: str) -> list:
    """Return a list of short reason-codes for why `text` looks like a
    merged/corrupted row. Empty list == looks clean."""
    reasons = []
    if DOUBLE_PIPE_RE.search(text):
        reasons.append("double-pipe")
    if WIKITABLE_RE.search(text):
        reasons.append("wikitable-markup")
    if HEADING_LEAK_RE.search(text):
        reasons.append("heading-leak")
    if INLINE_MARKER_RE.search(text):
        reasons.append("inline-verse-marker")
    return reasons


def scan_book(conn: sqlite3.Connection, book_id: str, length_outlier_factor: float = 6.0):
    """Read-only scan of one book's verses. Yields Anomaly for every row that
    either matches a textual red flag (classify_text) or is a length outlier
    vs. its immediate chapter neighbors (informational only — length
    outliers without a textual red flag are still reported, but calling
    code should treat them as *candidates to inspect*, not confirmed bugs:
    some verses in these texts are legitimately much longer than their
    neighbors)."""
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT chapter, verse_num, text FROM verses WHERE book_id=? ORDER BY chapter, verse_num",
        (book_id,),
    ).fetchall()

    by_chapter: dict[int, list[tuple[int, str]]] = {}
    for chapter, verse_num, text in rows:
        by_chapter.setdefault(chapter, []).append((verse_num, text))

    for chapter, verses in by_chapter.items():
        lengths = [len(t) for _, t in verses]
        avg = sum(lengths) / len(lengths) if lengths else 0
        for verse_num, text in verses:
            reasons = classify_text(text)
            is_outlier = avg > 0 and len(text) > avg * length_outlier_factor and len(text) > 800
            if is_outlier and "length-outlier" not in reasons:
                reasons = reasons + ["length-outlier"]
            if reasons:
                yield Anomaly(
                    book_id=book_id,
                    chapter=chapter,
                    verse_num=verse_num,
                    length=len(text),
                    reasons=reasons,
                    sample=(text[:140] + "...") if len(text) > 140 else text,
                )


def scan_all_books(conn: sqlite3.Connection):
    cur = conn.cursor()
    book_ids = [r[0] for r in cur.execute("SELECT id FROM books ORDER BY id").fetchall()]
    for book_id in book_ids:
        yield from scan_book(conn, book_id)
