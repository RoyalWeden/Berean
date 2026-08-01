#!/usr/bin/env python3
"""
seed_t12p.py — Populate t12p.db from /tmp/t12p_alt.txt

R.H. Charles' translation, "The Testaments of the Twelve Patriarchs" (APOT vol. II).

This script replaced an earlier version that parsed a badly OCR'd scan
(/tmp/t12p_raw.txt) using Roman-numeral chapter markers and a `MAX_GAP`
tolerance in its verse extractor that silently accepted verse-number jumps
as "OCR missed a verse" and dropped the intervening content. That produced
confirmed structural corruption — e.g. Simeon ch.3 was actually the back
half of ch.2, with the real ch.3 lost entirely; Levi ch.2 verses 1-6 were
missing outright.

The source used here (/tmp/t12p_alt.txt) is an independent OCR scan of the
same Charles translation (different archive.org item, different Tesseract
pipeline) that turned out to be much cleaner: chapters and verses are both
marked with bare Arabic numerals embedded directly in the running text
(no periods), e.g.:

    1 1 The copy of the Testament of Reuben, even the commands which he
    gave his sons before he 2 died in the hundred and twenty-fifth year...

  - The FIRST number of a chapter's opening paragraph is the chapter
    number; it is immediately followed by a verse-1 marker ("1", "1, 2",
    "1,2", or OCR variants "I" / "|" that stand in for a misread "1").
  - Every subsequent bare number inside the chapter's text is a verse
    marker, positioned right before the word where that verse begins.
  - Occasionally two adjacent verse numbers appear back-to-back with no
    text between them (e.g. "5, 6 Because valour...") — the editor
    apparently could not cleanly split verses 5 and 6, so both numbers
    lead into the same following text.

Design goals for this rewrite (per the fix-tasks brief):
  - NO silent gap-tolerance mechanism. A verse or chapter number that does
    not match the expected next value is never blindly accepted as "close
    enough" and used to swallow/discard text. Numbers that don't match are
    treated as plain body text (common OCR noise: "1" misread from a
    capital "I" pronoun, "18" misread from "is", etc.) UNLESS the expected
    number provably never recurs later in the same chapter, in which case
    we treat the mismatch as a genuinely missing OCR digit, renumber
    forward from it, and print a WARNING so the renumbering can be spot
    checked (this always preserves all text — it only affects verse
    *boundaries*, never drops content).
  - Chapter-boundary detection is anchored to blank-line-preceded
    paragraph starts (chapters always open a new paragraph in this scan),
    combined with the "number immediately followed by a verse-1 marker"
    pattern. This is what prevents the old script's structural failure
    mode (misdetecting a chapter boundary mid-chapter, e.g. the Simeon
    ch.2/ch.3 bug) — an in-body verse marker like "8 men, and not only
    so..." is never mistaken for a chapter start because it is not
    followed by a verse-1 marker.
  - Chapters are renumbered sequentially by DETECTION ORDER within each
    testament rather than trusting the literal printed digit. This fixes
    e.g. Judah's chapter 25, which the scan prints as "26" (OCR digit
    swap) immediately followed by the real chapter 26 also printed as
    "26" — both are still detected correctly via the "number + verse-1
    marker at a paragraph start" rule, and are assigned positions 25 and
    26 by order rather than colliding on the literal digit.
"""

import os
import re
import sqlite3

ALT_PATH = "/tmp/t12p_alt.txt"
DB_PATH  = "/Users/roywe/Berean/data/t12p.db"

TESTAMENTS = [
    ("REUBEN",   "TREU", "Testament of Reuben"),
    ("SIMEON",   "TSIM", "Testament of Simeon"),
    ("LEVI",     "TLEV", "Testament of Levi"),
    ("JUDAH",    "TJUD", "Testament of Judah"),
    ("ISSACHAR", "TISS", "Testament of Issachar"),
    ("ZEBULUN",  "TZEB", "Testament of Zebulun"),
    ("DAN",      "TDAN", "Testament of Dan"),
    ("NAPHTALI", "TNAP", "Testament of Naphtali"),
    ("GAD",      "TGAD", "Testament of Gad"),
    ("ASHER",    "TASH", "Testament of Asher"),
    ("JOSEPH",   "TJOS", "Testament of Joseph"),
    ("BENJAMIN", "TBEN", "Testament of Benjamin"),
]

SCHEMA = """
CREATE TABLE books (
    id TEXT PRIMARY KEY, name TEXT, short_name TEXT,
    testament TEXT, chapters_count INTEGER
);
CREATE TABLE verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT, chapter INTEGER, verse_num INTEGER, text TEXT,
    UNIQUE(book_id, chapter, verse_num)
);
CREATE INDEX idx_verses_ref ON verses(book_id, chapter);
CREATE VIRTUAL TABLE verses_fts USING fts5(
    text, book_id UNINDEXED, chapter UNINDEXED, verse_num UNINDEXED,
    content=verses, content_rowid=id
);
CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
    INSERT INTO verses_fts(rowid, text, book_id, chapter, verse_num)
    VALUES (new.id, new.text, new.book_id, new.chapter, new.verse_num);
END;
"""

# ── Homoglyph / light OCR cleanup ───────────────────────────────────────────

# Cyrillic lookalikes that show up scattered through the scan (single
# characters inside otherwise-normal English words). Normalize to Latin.
_HOMOGLYPHS = {
    'І': 'I', 'і': 'i', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
    'х': 'x', 'у': 'y', 'ѕ': 's', 'г': 'r', 'п': 'n', 'в': 'v', 'н': 'H',
    'ш': 'sh', 'й': 'i', 'М': 'M',
}

def normalize_text(s: str) -> str:
    for bad, good in _HOMOGLYPHS.items():
        s = s.replace(bad, good)
    return s


# ── Chapter-start detection ─────────────────────────────────────────────────

# A verse-1 marker: "1", "1,2", "1, 2", or OCR variants "I ", "| " that stand
# in for a misread "1" (only ever seen directly after a chapter number at a
# paragraph start — mid-body "I"/"|" are not treated specially).
_VERSE1_MARKER = re.compile(r'^(1\s*,\s*2|1\s+2|1|I|\|)(?=\s|[A-Z]|$)')

_CHAPTER_START = re.compile(r'^(\d{1,3})\b\s*(.*)$', re.DOTALL)


def find_chapter_starts(lines, start, end):
    """
    Return [(line_index, printed_chapter_num), ...] for every physical line
    in lines[start+1:end] whose first token is a bare number immediately
    followed by a verse-1 marker.

    New chapters in this scan always begin a fresh physical print line (the
    source book indents/breaks a line for each new chapter paragraph), but
    an extra blank line before that isn't reliable — some chapters have one,
    some (and most chapter-1-after-title cases) don't. So detection is
    anchored purely to physical-line-start position, not blank lines.

    The false-positive risk this raises — an in-body verse marker landing at
    a line-start too (OCR line wrap is arbitrary) — is what the verse-1-
    marker requirement guards against: a lone number at line-start followed
    by ordinary prose (e.g. "8 men, and not only so...", a verse-8 marker
    mid-chapter) is rejected because "men" isn't a verse-1 marker. Only a
    line-start number immediately followed by "1" / "1,2" / "1, 2" / the OCR
    variants "I" or "|" standing in for a misread "1" is accepted.
    """
    candidates = []
    for i in range(start + 1, end):
        s = lines[i].strip()
        if not s:
            continue
        m = _CHAPTER_START.match(s)
        if not m:
            continue
        num = int(m.group(1))
        rest = m.group(2).strip()
        if _VERSE1_MARKER.match(rest):
            candidates.append((i, num))
    return candidates


# ── Verse extraction ────────────────────────────────────────────────────────

# A verse-number token: whitespace/start-bounded on the left, and on the
# right either end-of-string, whitespace, common punctuation directly glued
# to the digit (combined markers are frequently printed as "6, 7" with the
# comma attached straight to the first digit, no space), or — rare OCR
# space-drop — an uppercase letter starting the next word directly ("1For").
_NUM_TOKEN = re.compile(r'(?<!\S)(\d{1,3})(?=[\s,;:.!?]|[A-Z]|$)')


def extract_verses(chapter_text, book_id="?", chapter_label="?"):
    """
    Split a chapter's joined raw text into [(verse_num, text), ...].

    Verse markers are bare numbers surrounded by whitespace. A number is
    accepted as a verse marker only if it equals the expected next verse
    number, UNLESS the expected number never occurs anywhere later in the
    chapter — in that case the mismatch is treated as a genuinely missing
    OCR digit: we renumber forward from it (with a warning) rather than
    silently swallowing the intervening text into the previous verse.
    Numbers that don't match and are not "the missing expected value" are
    left in place as ordinary body text (handles OCR noise like a "1"
    misread from a capital "I" pronoun).
    """
    text = re.sub(r'\s+', ' ', chapter_text).strip()
    if not text:
        return []

    matches = list(_NUM_TOKEN.finditer(text))
    if not matches:
        return [(1, text)]

    all_nums = [int(m.group(1)) for m in matches]

    # chosen: list of (verse_num, content_start_offset, group_marker_start)
    # group_marker_start is the .start() of the FIRST marker in this verse's
    # group (itself, or — for the first half of a combined pair — its own
    # marker.start(), which is < the second marker's start). It is used only
    # to detect "same group" membership when computing end boundaries.
    chosen = []
    expected = 1
    i = 0
    n = len(matches)
    while i < n:
        v = all_nums[i]
        if v == expected:
            # Check for an immediately-adjacent combined pair: "N, N+1" or
            # "N N+1" with nothing but a comma/space between them — both
            # verse numbers lead into the same following text.
            if i + 1 < n and all_nums[i + 1] == expected + 1:
                between = text[matches[i].end():matches[i + 1].start()]
                if re.fullmatch(r'\s*,?\s*', between):
                    content_start = matches[i + 1].end()
                    group_id = matches[i].start()
                    chosen.append((expected, content_start, group_id))
                    chosen.append((expected + 1, content_start, group_id))
                    expected += 2
                    i += 2
                    continue
            chosen.append((expected, matches[i].end(), matches[i].start()))
            expected += 1
            i += 1
        elif v > expected and v - expected <= 5 and expected not in all_nums[i:]:
            # The expected verse number never reappears later in this
            # chapter, and this candidate is a plausible near neighbour (not
            # a wild jump) — almost certainly an OCR-dropped digit, not a
            # false positive. Accept it as the continuation of the sequence,
            # renumbered, and flag it for a manual look. The <=5 bound keeps
            # this from being fooled by unrelated OCR garbage that happens to
            # look like a much larger verse number (e.g. "is" misread as
            # "18" mid-sentence) — those are left as plain text instead of
            # being treated as a marker, since accepting them would draw a
            # verse boundary in the wrong place.
            print(f"    WARNING: {book_id} ch.{chapter_label}: expected verse "
                  f"{expected} not found before verse {v} — renumbering "
                  f"{v} -> {expected} (verify)")
            chosen.append((expected, matches[i].end(), matches[i].start()))
            expected += 1
            i += 1
        else:
            # Doesn't match, and the real expected value is still ahead —
            # this is noise (stray digit / OCR misread), not a marker.
            i += 1

    if not chosen:
        return [(1, text)]

    # For each chosen verse, the text end boundary is the marker-start
    # position of the NEXT chosen entry belonging to a different group
    # (i.e. not its combined-pair sibling), or end of text.
    verses = []
    for idx, (vnum, content_start, group_id) in enumerate(chosen):
        end = len(text)
        for j in range(idx + 1, len(chosen)):
            if chosen[j][2] != group_id:
                end = chosen[j][2]  # next verse's marker START, not content start
                break
        vt = text[content_start:end]
        vt = re.sub(r'\s+', ' ', vt).strip()
        if vt:
            verses.append((vnum, vt))

    return verses


# ── Parser ───────────────────────────────────────────────────────────────────

def find_testament_spans(lines):
    markers = []
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s.startswith("THE TESTAMENT OF"):
            m = re.search(r"THE TESTAMENT OF (\w+)", s)
            if m:
                name = m.group(1).upper()
                if not markers or markers[-1][0] != name:
                    markers.append((name, i))
    spans = []
    for idx, (name, start) in enumerate(markers):
        end = markers[idx + 1][1] if idx + 1 < len(markers) else len(lines)
        spans.append((name, start, end))
    return spans


def parse_testament(lines, start, end, book_id):
    """
    Returns a list of chapters, each chapter a list of (verse_num, text).
    """
    starts = find_chapter_starts(lines, start, end)
    if not starts:
        return []

    chapters = []
    expected_chapter = 1
    for idx, (line_i, printed_num) in enumerate(starts):
        if printed_num != expected_chapter:
            print(f"    WARNING: {book_id}: chapter printed as {printed_num} "
                  f"but expected {expected_chapter} — renumbering (verify)")
        chapter_num = expected_chapter
        expected_chapter += 1

        # Chapter body: from just after the leading chapter-number token
        # (on the start line) through to the line before the next chapter
        # start (or the testament end).
        first_line = lines[line_i].strip()
        m = _CHAPTER_START.match(first_line)
        body_first_line = m.group(2)  # strip only the chapter-number token; keep verse-1 marker
        # Normalize OCR variants of the verse-1 marker ("I", "|") to a literal
        # "1" so extract_verses' digit-based tokenizer recognizes it.
        body_first_line = re.sub(r'^(I|\|)(?=\s|$)', '1', body_first_line)

        next_line_i = starts[idx + 1][0] if idx + 1 < len(starts) else end
        body_lines = [body_first_line] + [lines[j] for j in range(line_i + 1, next_line_i)]
        raw = normalize_text(' '.join(body_lines))
        raw = re.sub(r'\s+', ' ', raw).strip()

        verses = extract_verses(raw, book_id, chapter_num)
        chapters.append(verses)

    return chapters


# ── DB helpers ────────────────────────────────────────────────────────────────

def create_db():
    for ext in ('', '-shm', '-wal'):
        p = DB_PATH + ext
        if os.path.exists(p):
            os.remove(p)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def insert_testament(conn, book_id, name, chapters):
    conn.execute(
        "INSERT INTO books VALUES (?,?,?,?,?)",
        (book_id, name, name, "Pseudepigrapha", len(chapters))
    )
    total = 0
    for ch_num, verse_list in enumerate(chapters, 1):
        for v_num, text in verse_list:
            conn.execute(
                "INSERT OR IGNORE INTO verses (book_id,chapter,verse_num,text) VALUES (?,?,?,?)",
                (book_id, ch_num, v_num, text)
            )
            total += 1
    return total


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"Reading {ALT_PATH} …")
    with open(ALT_PATH, encoding='utf-8', errors='replace') as f:
        lines = [ln.rstrip('\n') for ln in f]
    print(f"  {len(lines)} lines")

    spans = find_testament_spans(lines)
    name_map = {name: (s, e) for name, s, e in spans}
    print(f"  Found {len(spans)} testament markers: {[n for n, s, e in spans]}")

    conn = create_db()

    for tname, book_id, display_name in TESTAMENTS:
        if tname not in name_map:
            print(f"  WARNING: {tname} not found — skipping")
            continue
        start, end = name_map[tname]
        chapters = parse_testament(lines, start, end, book_id)

        total = insert_testament(conn, book_id, display_name, chapters)
        print(f"  {book_id}: {len(chapters)} chapters, {total} verses")
        if chapters and chapters[0]:
            print(f"    Ch1 v1: {chapters[0][0][1][:80]!r}")

    conn.commit()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
