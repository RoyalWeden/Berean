#!/usr/bin/env python3
"""
seed_ep_barnabas.py — Populate ep_barnabas.db from /tmp/ep_barnabas_raw.txt

Samuel Sharpe, 1880 translation from the Sinaitic Manuscript.

Chapter markers in this text use the format  roman.]  or  roman.] text
embedded in the prose (not standalone headings). OCR produced some variants:
  vii.  →  vi1.]   (the second 'i' OCR'd as '1')
  xv.   →  xV.]    (capital V)
  xx.   →  Ix.]    (OCR damage: 'xx' → 'Ix')

Verse numbers appear as isolated digits at the start of a line or inline
before sentence-start text.
"""

import os, re, sqlite3

RAW_PATH = "/tmp/ep_barnabas_raw.txt"
DB_PATH  = "/Users/roywe/Berean/data/ep_barnabas.db"
BAK_PATH = "/Users/roywe/Berean/data/ep_barnabas.db.bak"

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

# ── Roman numeral helpers ──────────────────────────────────────────────────────

_RV = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}

def roman_to_int(s):
    s = s.strip().upper()
    if not s or not re.fullmatch(r'[IVXLCDM]+', s):
        return None
    val, prev = 0, 0
    for ch in reversed(s):
        v = _RV.get(ch, 0)
        if not v:
            return None
        val = val - v if v < prev else val + v
        prev = v
    return val if val > 0 else None


# Canonical chapter-marker patterns (all lowercase in source, but OCR varies)
# Maps OCR token → chapter number
_CHAPTER_TOKEN_MAP = {
    # Standard lowercase roman
    'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7,
    'viii': 8, 'ix': 9, 'x': 10, 'xi': 11, 'xii': 12, 'xiii': 13,
    'xiv': 14, 'xv': 15, 'xvi': 16, 'xvii': 17, 'xviii': 18, 'xix': 19,
    'xx': 20, 'xxi': 21,
    # Known OCR mutations
    'vi1': 7,   # vii → vi1
    'xv': 15,   # already in map (uppercase V handled by lowercasing)
    'ix': 9,    # already
    # OCR: xx → Ix (capital I lowercase x)
    'ix': 9,    # This is ambiguous but handled by position logic below
}

# The raw file uses patterns like: "ii.]", "vi1.]", "xV.]", "Ix.]"
# We scan for these markers anywhere in the text.
# Pattern: word-boundary + roman-like-token + .]
_CHAPTER_MARKER_PAT = re.compile(
    r'(?<!\w)'              # not preceded by word char
    r'([IiVvXxLl][IiVvXxLl0-9]*)'  # roman-like token (allows digit OCR damage)
    r'\.\]'                  # period + right-bracket
)


def decode_chapter_marker(raw_token):
    """
    Convert an OCR'd chapter-marker token to a chapter number (1-21).
    raw_token is the part before '.]' — e.g. 'ii', 'vi1', 'xV', 'Ix'.
    Returns int or None.
    """
    t = raw_token.lower()
    # Direct map first
    if t in _CHAPTER_TOKEN_MAP:
        return _CHAPTER_TOKEN_MAP[t]
    # Handle digit-corrupted numerals: 'vi1' → 'vii' (replace trailing digit with 'i')
    t2 = re.sub(r'(\d+)', lambda m: 'i' * len(m.group()), t)
    if t2 in _CHAPTER_TOKEN_MAP:
        return _CHAPTER_TOKEN_MAP[t2]
    # Try as valid Roman numeral (case-insensitive)
    v = roman_to_int(t.upper())
    if v and 1 <= v <= 21:
        return v
    return None


# ── Verse extraction ───────────────────────────────────────────────────────────

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()
    # Strip common noise artifacts
    text = re.sub(r'[\x0c]', '', text)
    return text


def extract_verses(chapter_text):
    """
    Split chapter text into (verse_num, text) pairs.
    The Sharpe 1880 Sinaitic translation uses '/' as verse separators.
    Each segment separated by '/' becomes one verse with a sequential number.
    Noise lines (page numbers, running titles, bullet markers) are stripped first.
    """
    text = clean_text(chapter_text)
    if not text:
        return []

    # Strip marginal verse number markers and bullet artifacts that
    # appear as embedded digits or '•' followed by a digit:
    # e.g.  "• 2 travelled" → " travelled",  "eful 5 about" → "eful about"
    # We strip ONLY when the digit is surrounded by non-verse-boundary context
    # (i.e. it appears mid-sentence rather than at the start of a segment).
    # Safest: strip all occurrences of  \s+\d{1,2}\s+  that are preceded by a
    # word character and followed by a lowercase letter (mid-sentence numerals).
    text = re.sub(r'(?<=\w)\s+•?\s*\d{1,2}\s+(?=[a-z])', ' ', text)
    # Strip standalone bullet+number patterns at word boundaries
    text = re.sub(r'\s+•\s*\d{1,2}\s+', ' ', text)

    # Split on ' / ' (the Sharpe translation verse separator)
    parts = [p.strip() for p in re.split(r'\s*/\s*', text) if p.strip()]

    if not parts:
        return [(1, text)]

    # Assign sequential verse numbers starting at 1
    verses = []
    for i, part in enumerate(parts, start=1):
        if part:
            verses.append((i, part))
    return verses


# ── Parser ────────────────────────────────────────────────────────────────────

_NOISE_LINES = re.compile(
    r'(?:'
    r'^\s*THE EPISTLE OF BARNABAS\.\s*$'   # running title
    r'|^\s*\[\s*[ivxIVX\.,\s]+\s*\]\s*$'   # bracket notation like "[ii., iii.]"
    r'|^\s*\d{1,4}\s*$'                     # page numbers
    r'|^\s*[Cc]omp\.\s'                     # footnote markers "Comp."
    r'|^\s*\*\s'                             # asterisk footnotes
    r'|^\s*†\s'                              # dagger footnotes
    r'|^\s*\d+\s*$'                          # lone digits (page nums)
    r')',
    re.MULTILINE
)

def is_noise_line(line):
    s = line.strip()
    if not s:
        return True
    # Running title
    if re.fullmatch(r'THE EPISTLE OF BARNABAS\.?', s, re.I):
        return True
    # Bracket-only reference lines: "[ii., iii.]", "[vi., vii.]"
    if re.fullmatch(r'\[[\s\.,ivxIVX]+\]', s):
        return True
    # Footnote markers (asterisk/dagger) and "Comp." citations
    if re.match(r'^\*\s|^†\s|^[Cc]omp\.\s', s):
        return True
    if '\x0c' in s:
        return True
    # NOTE: standalone digits are NOT filtered — they may be verse numbers
    # (e.g. "6" before "These things, therefore, has He abolished...")
    return False


def parse_chapters(lines):
    """
    Scan for chapter markers and split into chapters.
    Returns list of (chapter_num, raw_text).
    """
    # Find the text start: first occurrence of "Hail in peace" or "HaIl in peace"
    text_start = 0
    for i, ln in enumerate(lines):
        if re.search(r'[Hh]a[Ii]l\s+in\s+peace', ln):
            text_start = i
            break

    # Collect all chapter marker positions by scanning full text
    full_text = '\n'.join(lines[text_start:])
    markers = []  # (char_offset, chapter_num)

    for m in _CHAPTER_MARKER_PAT.finditer(full_text):
        ch = decode_chapter_marker(m.group(1))
        if ch:
            markers.append((m.start(), ch, m.end()))

    # Deduplicate: keep first occurrence of each chapter number.
    # Position-aware: if a marker would be a duplicate but appears after all
    # previous markers, try re-interpreting it as a different chapter.
    # Specifically handles 'Ix' which OCR'd 'xx' (20) as 'Ix' (9).
    seen = {}
    clean_markers = []
    for pos, ch, end in sorted(markers):
        if ch not in seen:
            seen[ch] = (pos, end)
            clean_markers.append((pos, ch, end))
        else:
            # Already have this chapter. If this position comes after all current
            # markers, try interpreting as "next expected chapter" to recover
            # OCR-damaged chapter numbers.
            if clean_markers:
                last_ch = max(c for _, c, _ in clean_markers)
                candidate = last_ch + 1
                if candidate not in seen and candidate <= 21:
                    seen[candidate] = (pos, end)
                    clean_markers.append((pos, candidate, end))

    # Sort by position
    clean_markers.sort()

    if not clean_markers:
        return [(1, full_text)]

    chapters = []
    # Chapter 1 is everything before the first detected marker
    first_pos = clean_markers[0][0]
    ch1_text = full_text[:first_pos].strip()
    if ch1_text:
        chapters.append((1, ch1_text))

    for idx, (pos, ch, end) in enumerate(clean_markers):
        # Text starts after the ".]" closer
        text_start_pos = end
        text_end_pos = clean_markers[idx+1][0] if idx+1 < len(clean_markers) else len(full_text)
        ch_text = full_text[text_start_pos:text_end_pos]

        # Clean up noise lines within this chapter's text
        lines_in_ch = ch_text.split('\n')
        clean_lines = [ln for ln in lines_in_ch if not is_noise_line(ln)]
        ch_text = ' '.join(ln.strip() for ln in clean_lines if ln.strip())
        ch_text = re.sub(r'\s+', ' ', ch_text).strip()

        if ch_text:
            chapters.append((ch, ch_text))

    return chapters


# ── DB ────────────────────────────────────────────────────────────────────────

def create_db():
    for ext in ('', '-shm', '-wal'):
        p = DB_PATH + ext
        if os.path.exists(p):
            os.remove(p)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def main():
    print(f"Reading {RAW_PATH} …")
    with open(RAW_PATH, encoding='utf-8', errors='replace') as f:
        lines = [ln.rstrip() for ln in f]
    print(f"  {len(lines)} lines")

    chapters = parse_chapters(lines)
    print(f"  Found {len(chapters)} chapters")
    for ch, text in chapters:
        print(f"    ch{ch}: {len(text)} chars, starts: {text[:60]!r}")

    conn = create_db()

    # Determine total chapters
    ch_nums = sorted(c for c, _ in chapters)
    max_ch = max(ch_nums) if ch_nums else 0

    conn.execute(
        "INSERT INTO books VALUES (?,?,?,?,?)",
        ('EPB', 'Epistle of Barnabas', 'Ep. Barnabas', 'Pseudepigrapha', max_ch)
    )

    total_verses = 0
    for ch_num, ch_text in chapters:
        verses = extract_verses(ch_text)
        if not verses:
            verses = [(1, ch_text.strip())]
        for v_num, text in verses:
            conn.execute(
                "INSERT OR IGNORE INTO verses (book_id,chapter,verse_num,text) VALUES (?,?,?,?)",
                ('EPB', ch_num, v_num, text)
            )
            total_verses += 1

    conn.commit()
    conn.close()

    print(f"\nEPB: {max_ch} chapters, {total_verses} verses total")
    print("Done.")


if __name__ == "__main__":
    main()
