#!/usr/bin/env python3
"""
seed_hermas.py — Populate hermas.db from hermas_raw.txt

Splits the Shepherd of Hermas into 3 books:
  HER_VIS — Visions        (Book First)
  HER_MAN — Mandates       (Book Second / Commandments)
  HER_SIM — Similitudes    (Book Third)

Within each book, chapters are numbered sequentially across all visions /
commandments / similitudes. Each paragraph of prose within a chapter becomes
one verse row.
"""

import os
import re
import sqlite3

RAW_PATH  = "/tmp/hermas_raw.txt"
DB_PATH   = "/Users/roywe/Berean/data/hermas.db"
BAK_PATH  = "/Users/roywe/Berean/data/hermas.db.bak"

# ─── helpers ─────────────────────────────────────────────────────────────────

def clean_line(line: str) -> str:
    """Strip trailing whitespace; keep internal content as-is."""
    return line.rstrip()

def is_blank(line: str) -> bool:
    return line.strip() == ""

# ─── parse ───────────────────────────────────────────────────────────────────

BOOK_MARKERS = {
    "Book First":  "VIS",
    "Book Second": "MAN",
    "Book Third":  "SIM",
}

# section-level markers (vision / commandment / similitude)
SECTION_RE = re.compile(
    r"^(VISION|COMMANDMENT|SIMILITUDE)\s+\w+",
    re.IGNORECASE,
)

CHAP_RE = re.compile(r"^CHAP\.\s+[IVXLC]+\s*$")

# Vision Fifth has no "CHAP." header — it's a single-section, single-chapter block
VISION_FIFTH_RE = re.compile(r"^Vision Fifth", re.IGNORECASE)

# End-of-first-edition sentinel (second edition appendix begins here)
END_OF_CONTENT_RE = re.compile(r"^THE WORKS OF THE$")


def paragraphs_from_lines(lines: list[str]) -> list[str]:
    """Split a list of text lines into paragraphs separated by blank lines."""
    paras = []
    current: list[str] = []
    for ln in lines:
        if is_blank(ln):
            if current:
                text = " ".join(current).strip()
                if text:
                    paras.append(text)
                current = []
        else:
            current.append(ln.strip())
    if current:
        text = " ".join(current).strip()
        if text:
            paras.append(text)
    return paras


TARGET_VERSE_LEN = 400
MIN_VERSE_LEN    = 150

_SENT_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z"\'(])')
_SEMI_SPLIT  = re.compile(r'(?<=;)\s+')


def _split_into_sentences(text: str) -> list[str]:
    sents = _SENT_SPLIT.split(text)
    result = []
    for s in sents:
        if len(s) > TARGET_VERSE_LEN * 1.5:
            result.extend(_SEMI_SPLIT.split(s))
        else:
            result.append(s)
    return [s.strip() for s in result if s.strip()]


def chunk_para(para: str) -> list[str]:
    """Split a long paragraph into verse-sized chunks at sentence boundaries."""
    if len(para) <= TARGET_VERSE_LEN:
        return [para]
    sents = _split_into_sentences(para)
    chunks, chunk = [], ''
    for sent in sents:
        if not chunk:
            chunk = sent
        elif len(chunk) + 1 + len(sent) <= TARGET_VERSE_LEN:
            chunk = chunk + ' ' + sent
        else:
            if len(chunk) >= MIN_VERSE_LEN:
                chunks.append(chunk)
                chunk = sent
            else:
                chunk = chunk + ' ' + sent
    if chunk:
        chunks.append(chunk)
    return chunks or [para]


def load_raw() -> list[str]:
    with open(RAW_PATH, encoding="utf-8", errors="replace") as f:
        return [clean_line(ln) for ln in f]


def find_content_start(lines: list[str]) -> int:
    """
    The actual content begins with the second occurrence of "THE PASTOR OF HERMAS"
    (after line 226 in the file) where real narrative text follows.
    We look for the line 'THE PASTOR OF HERMAS' that is then followed shortly
    by 'Book First' and 'VISION FIRST' + 'CHAP. I' + non-header narrative.
    """
    for i, ln in enumerate(lines):
        if ln.strip() == "THE PASTOR OF HERMAS" and i > 100:
            # verify Book First appears within the next 10 lines
            for j in range(i, min(i + 12, len(lines))):
                if lines[j].strip() == "Book First":
                    return i
    return 227  # fallback


def parse_hermas(lines: list[str]):
    """
    Return a dict:
      {
        'VIS': [(chapter_seq, [para, ...]), ...],
        'MAN': [(chapter_seq, [para, ...]), ...],
        'SIM': [(chapter_seq, [para, ...]), ...],
      }
    """
    start = find_content_start(lines)
    lines = lines[start:]

    current_book = None      # "VIS", "MAN", or "SIM"
    in_section = False       # True when inside a vision/commandment/similitude
    current_chap_lines: list[str] = []
    chapters: dict[str, list[list[str]]] = {"VIS": [], "MAN": [], "SIM": []}

    def flush_chapter():
        if current_book and current_chap_lines:
            chapters[current_book].append(list(current_chap_lines))
            current_chap_lines.clear()

    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        stripped = ln.strip()

        # ── book boundary ──────────────────────────────────────────────────
        for marker, book_code in BOOK_MARKERS.items():
            if stripped == marker:
                flush_chapter()
                current_book = book_code
                in_section = False
                break

        # ── section marker (VISION / COMMANDMENT / SIMILITUDE) ────────────
        if current_book and SECTION_RE.match(stripped):
            flush_chapter()
            in_section = True
            # consume the subtitle line(s) that follow (ALL-CAPS descriptive lines)
            i += 1
            while i < n and lines[i].strip().isupper() and not CHAP_RE.match(lines[i].strip()) \
                    and not SECTION_RE.match(lines[i].strip()) \
                    and not VISION_FIFTH_RE.match(lines[i].strip()):
                i += 1
            continue

        # ── Vision Fifth — no CHAP. marker, treat whole section as one chap ─
        if current_book == "VIS" and VISION_FIFTH_RE.match(stripped):
            flush_chapter()
            in_section = True
            # consume subtitle
            i += 1
            # gather everything until next book marker
            while i < n:
                sl = lines[i].strip()
                if sl in BOOK_MARKERS or SECTION_RE.match(sl):
                    break
                current_chap_lines.append(lines[i])
                i += 1
            continue

        # ── CHAP. marker ──────────────────────────────────────────────────
        if current_book and CHAP_RE.match(stripped):
            flush_chapter()
            in_section = True
            i += 1
            continue

        # ── end-of-first-edition sentinel ─────────────────────────────────
        if END_OF_CONTENT_RE.match(stripped):
            flush_chapter()
            break

        # ── content line ─────────────────────────────────────────────────
        if current_book and in_section:
            current_chap_lines.append(lines[i])

        i += 1

    flush_chapter()
    return chapters


# ─── DB ──────────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE books (
    id TEXT PRIMARY KEY,
    name TEXT,
    short_name TEXT,
    testament TEXT,
    chapters_count INTEGER
);

CREATE TABLE verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT,
    chapter INTEGER,
    verse_num INTEGER,
    text TEXT,
    UNIQUE(book_id, chapter, verse_num)
);

CREATE INDEX idx_verses_ref ON verses(book_id, chapter);

CREATE VIRTUAL TABLE verses_fts USING fts5(
    text,
    book_id UNINDEXED,
    chapter UNINDEXED,
    verse_num UNINDEXED,
    content=verses,
    content_rowid=id
);

CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
    INSERT INTO verses_fts(rowid, text, book_id, chapter, verse_num)
    VALUES (new.id, new.text, new.book_id, new.chapter, new.verse_num);
END;
"""

BOOK_META = {
    "VIS": ("HER_VIS", "Shepherd of Hermas — Visions",   "Hermas: Visions"),
    "MAN": ("HER_MAN", "Shepherd of Hermas — Mandates",  "Hermas: Mandates"),
    "SIM": ("HER_SIM", "Shepherd of Hermas — Similitudes","Hermas: Similitudes"),
}


def create_db():
    # Remove stale DB files (never touch .bak)
    for ext in ("", "-shm", "-wal"):
        p = DB_PATH + ext
        if os.path.exists(p):
            os.remove(p)
            print(f"Removed {p}")

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def insert_data(conn: sqlite3.Connection, chapters: dict):
    for code, (book_id, name, short_name) in BOOK_META.items():
        chapter_list = chapters[code]
        chapters_count = len(chapter_list)

        conn.execute(
            "INSERT INTO books VALUES (?, ?, ?, ?, ?)",
            (book_id, name, short_name, "Pseudepigrapha", chapters_count),
        )

        verse_rows = []
        for chap_seq, raw_lines in enumerate(chapter_list, start=1):
            paras = paragraphs_from_lines(raw_lines)
            v_num = 1
            for para in paras:
                for chunk in chunk_para(para):
                    verse_rows.append((book_id, chap_seq, v_num, chunk))
                    v_num += 1

        conn.executemany(
            "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
            verse_rows,
        )

        total_verses = len(verse_rows)
        print(f"  {book_id}: {chapters_count} chapters, {total_verses} verses")

        # sample
        if chapter_list:
            sample = paragraphs_from_lines(chapter_list[0])
            if sample:
                print(f"    Sample (ch 1, v 1): {sample[0][:100]!r}")

    conn.commit()


# ─── main ────────────────────────────────────────────────────────────────────

def main():
    print("Reading raw text …")
    lines = load_raw()
    print(f"  {len(lines)} lines loaded")

    print("Parsing …")
    chapters = parse_hermas(lines)
    for code in ("VIS", "MAN", "SIM"):
        print(f"  {code}: {len(chapters[code])} chapters found")

    print(f"\nCreating DB at {DB_PATH} …")
    conn = create_db()

    print("Inserting data …")
    insert_data(conn, chapters)

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
