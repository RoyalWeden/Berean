#!/usr/bin/env python3
"""
seed_t12p.py — Populate t12p.db from /tmp/t12p_raw.txt

R.H. Charles 1917 SPCK edition. The PDF scan has severe OCR damage:
- Roman numeral chapter markers often have "I." OCR'd as "L":
    II. → IL,  III. → IIL,  VI. → VL,  VII. → VIL,  VIII. → VIIL
    XI. → XL,  XII. → XIL,  etc.
- Chapter+text sometimes appear on the same line: "V. For evil are women..."
- Section labels like "IL i-IIL 8. Title" must be skipped (not content)
- Verse numbers appear as "1.", "2.", etc. inline in the text
"""

import os
import re
import sqlite3

RAW_PATH = "/tmp/t12p_raw.txt"
DB_PATH  = "/Users/roywe/Berean/data/t12p.db"
BAK_PATH = "/Users/roywe/Berean/data/t12p.db.bak"

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


def decode_chapter_token(token):
    """
    Return chapter number (int) or None.
    Handles valid Roman numerals AND extensive OCR damage from the 1917 scan:
      - Trailing 'I.' read as 'L': IL=2, VL=6, XIL=12, VIIL=8, etc.
      - 'H'/'h' OCR'd as 'II'/'ii' (two I's look like H)
      - 'N'/'n' OCR'd as 'II'/'ii' (two i's look like n in old fonts)
      - 'Y'/'y' OCR'd as 'V'/'v'
      - lowercase 'l' treated as 'i' (not L=50)
    Only accepts chapter numbers 1..30.
    """
    t = token.strip().rstrip('.')
    if not t:
        return None
    # Per-character OCR substitutions before uppercasing
    ocr = {'l': 'i', 'H': 'II', 'h': 'ii', 'N': 'II', 'n': 'ii', 'Y': 'V', 'y': 'v'}
    corrected = ''
    for ch in t:
        corrected += ocr.get(ch, ch)
    # Try corrected version first, then original
    candidates = [corrected] if corrected != t else []
    candidates.append(t)
    for cand in candidates:
        u = cand.upper()
        v = roman_to_int(u)
        if v and 1 <= v <= 30:
            return v
        # Also try trailing L → I on this candidate
        if u.endswith('L'):
            v = roman_to_int(u[:-1] + 'I')
            if v and 1 <= v <= 30:
                return v
    return None


# ── Line classification ────────────────────────────────────────────────────────

# Matches section-label lines like "IL i-IIL 8.", "IV. 1-3.", "VII. 1-2."
_SECTION_LABEL = re.compile(
    r'^([IVXLCDM]+\.?)\s+'
    r'(?:[ivxIVXLCDM\d][-\.ivxIVXLCDMlHhYy\d\s]+\d\.?\s*$)',
    re.IGNORECASE
)

# Char class for standalone Roman tokens — includes n/N (OCR of ii/II) since
# false-positive risk is low when the ENTIRE line is just the token.
_ROMAN_CHARS_ONLY = r'IVXLCDMivxlcdmHhNnYy'

# Char class for inline tokens (followed by prose) — excludes n/N to prevent
# false positives on common English words like "in", "In", "no".
_ROMAN_CHARS_INLINE = r'IVXLCDMivxlcdmHhYy'

# A line that is ONLY a Roman-numeral chapter token (with optional period)
_ROMAN_ONLY = re.compile(r'^([' + _ROMAN_CHARS_ONLY + r']+)\.?\s*$')

# A line starting with a chapter token then prose text.
# Period OR comma (comma = OCR of period, e.g. "V, Keep..." = "V. Keep...")
# Comma variant requires uppercase next word to reduce false positives.
_ROMAN_INLINE = re.compile(r'^([' + _ROMAN_CHARS_INLINE + r']+)\.?\s+(.+)', re.DOTALL)
_ROMAN_INLINE_COMMA = re.compile(r'^([' + _ROMAN_CHARS_INLINE + r']+),\s+([A-Z].+)', re.DOTALL)

# Standalone verse-range lines: "i-io.", "i-VL 6. Title", "i-II. 5."
_VERSE_RANGE = re.compile(r'^[ivxIVX\d][-][IVXLCDMivxlcdmHhNnYyo\d]', re.IGNORECASE)

# Specific OCR tokens that contain 'n' (OCR of 'ii') and appear inline.
# These are handled explicitly because 'n' is excluded from _ROMAN_CHARS_INLINE.
# Key: token string (case-sensitive, without trailing period), Value: chapter number.
_OCR_N_TOKENS = {
    'n':  2,   # 'n' = OCR of 'II'
    'ni': 3,   # 'ni' = OCR of 'III'
    'Vn': 7,   # 'Vn' = OCR of 'VII'
    'Xn': 12,  # 'Xn' = OCR of 'XII'
}

def classify_line(line):
    """
    Returns one of:
      ('chapter', chapter_num, inline_text_or_None)
      ('section_label', chapter_num)
      ('text', line)
      ('noise', None)
    """
    s = line.strip()
    if not s:
        return ('noise', None)

    # Noise: page numbers, form feeds, running titles
    if re.fullmatch(r'\d{1,4}', s):
        return ('noise', None)
    if '\x0c' in s:
        return ('noise', None)
    if re.match(r'^THE TESTAMENTS OF', s, re.I):
        return ('noise', None)
    if re.match(r'^THE T[A-Z\\ ]{3,}PATRIARCHS', s, re.I):
        return ('noise', None)
    # Testament title lines: "THE TESTAMENT OF SIMEON, THE SECOND"
    if re.match(r'^THE TESTAMENT OF [A-Z]', s):
        return ('noise', None)
    if re.fullmatch(r'[A-Z\s]{1,5}', s) and len(s) <= 5:
        # Don't filter if it decodes as a valid chapter token (e.g. 'XL'=11, 'XVL'=16)
        if not decode_chapter_token(s):
            return ('noise', None)
    # Lines with only punctuation/symbols (OCR artifacts like ">", "^", etc.)
    if re.fullmatch(r'[^a-zA-Z0-9]+', s) and len(s) <= 4:
        return ('noise', None)
    # Testament subtitle lines: "SON OF JACOB AND LEAH", "OF JACOB AND ZILPAH"
    if re.match(r'^(SON\s+OF|OF)\s+JACOB\s+AND\s+\w', s, re.I):
        return ('noise', None)
    if re.match(r'^THE\s+(FIRSTBORN|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|'
                r'NINTH|TENTH|ELEVENTH|TWELFTH)\s+SON', s, re.I):
        return ('noise', None)
    # Editorial section headers
    if re.fullmatch(r'Introduction\.?', s, re.I):
        return ('noise', None)
    # Possessive section headings: "Reuben's Confession", "Judah's Mighty Deeds"
    if re.match(r"^[A-Z][a-z]+'s\s+[A-Z]", s):
        return ('noise', None)
    # "A Warning against Sin" / "Reuben's Death and Burial" style headers
    if re.match(r"^[A-Z][a-z]+'s\s+\w|^A [A-Z][a-z]+ (against|of|and|for)\b", s, re.I):
        return ('noise', None)
    # Section heading continuation fragments (second halves of split headings)
    if re.match(r'^and [A-Z][a-z]', s):      # "and Repentance", "and Burial"
        return ('noise', None)
    if re.match(r'^of the [A-Z\-]', s):       # "of the Selling-", "of the Words"
        return ('noise', None)
    if re.match(r'^between [A-Z]', s):         # "between Rachel and Leah"
        return ('noise', None)
    if re.match(r'^The\s+(Dissension|Confession|Selling|Story)\b', s):
        return ('noise', None)
    if re.match(r'^[A-Z][a-z]+ aforetime\b', s):  # "Joseph aforetime"
        return ('noise', None)
    if re.match(r'^words of [A-Z]', s):            # "words of Simeon, the things"
        return ('noise', None)
    if re.match(r'^the [A-Z][a-z]+ and\b', s):    # "the Good and the Evil Tendency"
        return ('noise', None)
    # Standalone single capitalized word (no punctuation) — heading fragment like "Joseph"
    if re.fullmatch(r'[A-Z][a-z]{3,}', s):
        return ('noise', None)
    # Standalone verse-range lines: "i-io.", "i-VL 6. Title" — not chapter markers
    if _VERSE_RANGE.match(s):
        return ('noise', None)

    # Printer boilerplate / appendix listings at end of file
    if re.match(r'^Printed in\b', s, re.I):
        return ('noise', None)
    if re.match(r'^brunswick st\b', s, re.I):
        return ('noise', None)
    if re.match(r'^TRANSLATIONS OF\b', s, re.I):
        return ('noise', None)
    if re.match(r'^EARLY DOCUMENTS\b', s, re.I):
        return ('noise', None)
    # Series listing lines: "The Assumption of Moses.", "SECOND SERIES", "Hellenistic-Jewish Texts"
    if re.match(r'^(FIRST|SECOND|THIRD) SERIES\b', s, re.I):
        return ('noise', None)
    if re.match(r'^[Hh]ellenistic[-\s]Jewish\b', s):
        return ('noise', None)

    # Editorial section labels ending in a digit (e.g. "IL i-IIL 8.")
    if _SECTION_LABEL.match(s):
        m = _SECTION_LABEL.match(s)
        ch = decode_chapter_token(m.group(1))
        if ch:
            return ('section_label', ch)

    # Special case: 'in.' = OCR of 'III.' — only period form to avoid false positives on "in the..."
    m = re.match(r'^in\.\s+(.*)', s)
    if m:
        rest = m.group(1).strip()
        if not rest:
            return ('chapter', 3, None)
        # Section-label rest (verse range like "g-15." or "9-15.")
        if re.match(r'^[g9\d][-\.ivxIVX\d\s]+\d', rest) or re.match(r'^[-]?[ivxIVX\d][-\.]', rest):
            return ('section_label', 3)
        return ('chapter', 3, rest)

    # Explicit handling of OCR tokens containing 'n' (excluded from _ROMAN_CHARS_INLINE)
    # e.g. "n." = II, "ni. text" = III, "Vn. text" = VII, "Xn. text" = XII
    for ocr_tok, ch in _OCR_N_TOKENS.items():
        if s == ocr_tok or s == ocr_tok + '.':
            return ('chapter', ch, None)
        if s.startswith(ocr_tok + '.') or s.startswith(ocr_tok + ' '):
            rest = s[len(ocr_tok) + 1:].strip()
            if not rest:
                return ('chapter', ch, None)
            if re.match(r'^[-]?[ivxIVX\d][-\.][ivxIVXLCDMlHhYyo\d\.]+', rest):
                return ('section_label', ch)
            return ('chapter', ch, rest)

    # Standalone Roman numeral (possibly OCR-damaged, including n/N forms)
    m = _ROMAN_ONLY.match(s)
    if m:
        ch = decode_chapter_token(m.group(1))
        if ch:
            return ('chapter', ch, None)

    # Roman numeral followed by prose text (period separator)
    for pattern in (_ROMAN_INLINE, _ROMAN_INLINE_COMMA):
        m = pattern.match(s)
        if m:
            ch = decode_chapter_token(m.group(1))
            rest = m.group(2).strip()
            if ch and rest:
                # Detect section labels: verse range at start of rest
                if re.match(r'^[-]?[ivxIVX\d][-\.][ivxIVXLCDMlHhYyo\d\.]+', rest):
                    return ('section_label', ch)
                # Only treat as chapter marker if rest looks like actual prose
                if not re.match(r'^[ivxIVX\d][-\.ivxIVX\d\s]+\d\.?\s*$', rest):
                    return ('chapter', ch, rest)
            break

    return ('text', s)


# ── Verse extraction ───────────────────────────────────────────────────────────

def fix_ocr_artifacts(text: str) -> str:
    """
    Fix systematic OCR corruption in the R.H. Charles 1908 T12P scan.

    Dominant error classes:
      }'  or }-  or }^  = y   (OCR reads y as closing curly brace)
      \'  before vowel  = v   (lo\'ing → loving)
      \'  at word end   = y   (awa\' → away)
      \-               = y   (m\- → my)
      3'  at word start = y   (3'e → ye)
      j   at word end   = y   (twentj → twenty, holj → holy)
      jou               = you
      stray apostrophes in mid-word positions
      footnote/variant letters inline (g., h. etc.)
      word splits (begin neth → beginneth)
    """
    # --- } substitutions (y) ---
    text = re.sub(r"}'", 'y', text)
    text = re.sub(r'}\^', 'y', text)
    text = re.sub(r'}-', 'y', text)
    text = re.sub(r'}', 'y', text)   # bare } in word context

    # --- Specific known broken tokens ---
    text = re.sub(r"\\'0u\b", 'you', text)           # \'0u → you
    text = re.sub(r'\bm\\-\b', 'my', text)           # m\- → my
    text = re.sub(r'\bni}\b', 'my', text)            # ni} → my
    text = re.sub(r'\bni\^]\b', 'my', text)          # variant
    text = re.sub(r'\bYov\b', 'you', text)           # Yov → you (capitalised OCR read of "you")
    text = re.sub(r'\bcontinuaP\b', 'continual', text)  # continuaP → continual
    text = re.sub(r'\bihave\b', 'have', text)        # ihave → have (I/l merged)
    text = re.sub(r'\blier\b', 'her', text)          # lier → her (l=h)

    # --- Specific corruption sequences found in scan ---
    # "dethis '"too"' fraudeth" is OCR of "defraudeth" — the raw spans two lines
    # and the scan inserted quote noise between the syllables.
    # Match flexibly across the various intermediate quote artifacts.
    text = re.sub(r"\bdethis\b['\"\s]*too['\"\s]*fraudeth\b", 'defraudeth', text, flags=re.IGNORECASE)
    text = re.sub(r'\bdethis\b', 'defraudeth', text, flags=re.IGNORECASE)

    # --- \' substitutions (context-sensitive: v before vowel, y at word end) ---
    text = re.sub(r"([a-zA-Z])\\'([aeiouAEIOU])", r'\1v\2', text)
    text = re.sub(r"([a-z])\\'(?=[\s,.;:!?()\"]|$)", r'\1y', text)
    text = re.sub(r"\\'", 'v', text)

    # --- \- = y (m\- → my) ---
    text = re.sub(r'([a-z])\\-', r'\1y', text)

    # --- Stray backslash before letter: \w → w ---
    text = re.sub(r'\\([a-zA-Z])', r'\1', text)
    # Backslash at word end = y
    text = re.sub(r'([a-z])\\(?=[\s,;:.!?]|$)', r'\1y', text)

    # --- 3' / 3- at start of syllable = y ---
    text = re.sub(r"(?<![0-9])3'([a-z])", r'y\1', text)
    text = re.sub(r'(?<![0-9])3-([a-z])', r'y\1', text)

    # --- j → y substitutions ---
    # Word-initial: jou / j'ou → you
    text = re.sub(r"\bj'?ou\b", 'you', text)
    # Before hyphen in compound words: twentj-fifth → twenty-fifth
    text = re.sub(r'([a-z])j-', r'\1y-', text)
    # Word-final j after vowel or common consonants: holj→holy, everj→every, bodj→body
    # Safe: no English word ends in j after these letters
    text = re.sub(r'([aeiouymnlrst])j\b', lambda m: m.group(1) + 'y', text)

    # --- -Y (hyphen + capital Y) after lowercase letter → y ---
    text = re.sub(r'([a-z])-Y\b', lambda m: m.group(1) + 'y', text)
    # General: letter + hyphen + single capital at word boundary → letter + lowercase
    text = re.sub(r'([a-z])-([A-Z])\b', lambda m: m.group(1) + m.group(2).lower(), text)

    # --- 5ou = you (OCR reads y as 5) ---
    text = re.sub(r'\b5ou\b', 'you', text)

    # --- Stray apostrophes ---
    # Consonant + ' + vowel mid-word (NOT a standard contraction): w'ords → words
    text = re.sub(r"([bcdfghjklmnpqrstvwxyz])'([aeiouAEIOU])", r'\1\2', text)
    # Leading apostrophe before a word: 'envy → envy
    text = re.sub(r"(?<=\s)'([a-z]{2,})\b", r'\1', text)
    # Trailing apostrophe before space or punctuation: even' → even, For' → For
    text = re.sub(r"([a-zA-Z])'(?=[\s,;:.!?])", r'\1', text)
    text = re.sub(r"([a-zA-Z])'$", r'\1', text)

    # --- Double-quote artifacts and multiple quote runs ---
    text = re.sub(r"''([^']+)''", r'\1', text)
    text = re.sub(r'"\'([^"\']+)\'"', r'\1', text)
    # Isolated "! → ! and "? → ?  (stray opening quote before punctuation)
    text = re.sub(r'"([!?.,;])', r'\1', text)
    # Lone closing quote at end of word followed by space: word" word → word word
    text = re.sub(r'([a-z])"(?=[\s])', r'\1', text)
    text = re.sub(r'["\']{2,}', '', text)

    # --- Word splits (OCR line-wrap artifacts) ---
    text = re.sub(r'\bbegin\s+neth\b', 'beginneth', text)
    text = re.sub(r'\bcli+l?dren\b', 'children', text)   # cliildren, clildren → children
    text = re.sub(r'\butterh\b', 'utterly', text)
    text = re.sub(r'\blament(?:i|a)oms\b', 'lamentations', text)
    text = re.sub(r'\bhumble\s*brother\b', 'humble brother', text)  # humblebrother → two words

    # --- Inline footnote / variant-reading markers (single lowercase letter + period) ---
    # These are R.H. Charles editorial markers (superscript letters in the original)
    # that the OCR reads as inline text. Remove them.
    # Pattern: space + single letter [b-hk-z] (not 'a') + period + space (before capital)
    # 'a.' excluded to avoid stripping "a. " at legitimate sentence positions
    text = re.sub(r'(?<=\s)[b-hk-np-z]\.(?=\s+[A-Z])', '', text)
    # Same pattern followed by a lowercase word (more aggressive — verified safe)
    text = re.sub(r'(?<=\s)[c-hk-np-z]\.(?=\s+[a-z])', '', text)
    # Strip trailing lone letter-period at end of text
    text = re.sub(r'\s+[b-z]\.\s*$', '', text)

    # --- Inline number noise (sub-chapter labels stuck in verse text) ---
    # e.g. "he it 4. refresheth" → "he refresheth"
    # In the FINAL verse strings (after verse splitting) stray mid-sentence "N."
    # where N is 2-9 occur because the OCR mixed sub-verse label numbers inline.
    # Remove them: a digit + period BETWEEN two lowercase/punct words
    text = re.sub(r'(?<=\w)\s+\d{1,2}\.\s+(?=[a-z])', ' ', text)
    text = re.sub(r'\s+\d{1,2}\.\s*$', '', text)   # trailing digit+period

    # --- OCR merges 'li' strokes into 'h' or 'hv' ---
    text = re.sub(r'\b[Hh]fe\b', lambda m: 'Life' if m.group(0)[0].isupper() else 'life', text)
    text = re.sub(r'\bhves\b', 'lives', text)
    text = re.sub(r'\bdehvered\b', 'delivered', text)
    text = re.sub(r'\bdehvers\b', 'delivers', text)
    text = re.sub(r'\bdehver\b', 'deliver', text)
    text = re.sub(r'\bchvided\b', 'divided', text)

    # --- Stray mid-word capital (OCR noise) ---
    text = re.sub(r'\b([a-z]+)([A-Z])([a-z]+)\b', lambda m: m.group(1) + m.group(2).lower() + m.group(3), text)

    # --- -word at start of word where hyphen = y ---
    text = re.sub(r'(?<=\s)-([a-z]{3,})', lambda m: 'y' + m.group(1), text)

    # --- mid-word OCR noise: letter + " glued to end of a word ---
    text = re.sub(r'([a-z])"[a-z](?=\s)', r'\1', text)

    # --- "the." artifact ---
    text = re.sub(r'\bthe\.\s', 'the ', text)

    # --- Normalise whitespace ---
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def extract_verses(raw_text):
    """
    Split chapter text into (verse_num, text) pairs.
    Verse markers: "1.", "2.", "3." etc. embedded in running text.
    Falls back to the whole chapter as verse 1 if no markers found.
    """
    # Clean OCR artifacts
    text = raw_text
    text = re.sub(r'\^', '', text)
    text = re.sub(r'["""]', '"', text)
    text = re.sub(r"['''`]", "'", text)
    text = text.replace('\x0c', '')
    # Apply systematic T12P OCR corrections
    text = fix_ocr_artifacts(text)
    # Remove section-label prefixes that slip through: "i-io.", "i-IIL 8.", etc.
    text = re.sub(r'^\s*[ivxIVX\d][-\.][ivxIVX\d\.ivxIVXlHhYy ]+\d\.?\s*', '', text)
    # Remove possessive headings stuck to verse text
    text = re.sub(r"^[A-Z][a-z]+'s [A-Z][a-zA-Z ]+ ", '', text)
    # Strip brackets that appear immediately before verse numbers: "[6. text" → "6. text"
    text = re.sub(r'\[(\d{1,3})\.\s', r'\1. ', text)
    text = re.sub(r'\s+', ' ', text).strip()

    if not text:
        return []

    # Normalize "I. " (Roman I as first verse marker) → "1. "
    text = re.sub(r'(?:(?<=\s)|^)I\.(?=\s+[A-Za-z\["])', '1.', text)

    # Normalize OCR'd verse numbers that the scanner mis-read:
    #   'g.' is OCR of '9.' (digit 9 looks like lowercase g in old typefaces)
    #   'lo.' is OCR of '10.' (digit 1 + 0 looks like 'lo')
    #   'li.' is OCR of '11.'
    text = re.sub(r'(?:(?<=\s)|^)g\.(?=\s)', '9.', text)
    text = re.sub(r'(?:(?<=\s)|^)lo\.(?=\s)', '10.', text)
    text = re.sub(r'(?:(?<=\s)|^)li\.(?=\s)', '11.', text)

    # Find verse number markers: digit(s) + period + space
    pat = re.compile(r'(?:(?<=\s)|^)(\d{1,3})\.(?=\s)')
    matches = list(pat.finditer(text))

    if not matches:
        return [(1, text)]

    # Build monotonically increasing sequence.
    # Allow gaps up to MAX_GAP — handles OCR-damaged verse numbers that were
    # missed, preventing the rest of the chapter from being swallowed into one verse.
    MAX_GAP = 4
    chosen = []
    expected = None
    for m in matches:
        v = int(m.group(1))
        if expected is None:
            expected = v
        if v == expected:
            chosen.append(m)
            expected += 1
        elif v == expected - 1:
            pass  # exact duplicate, skip
        elif expected < v <= expected + MAX_GAP:
            # Verse number jumped ahead: missing verses in OCR, accept with gap
            chosen.append(m)
            expected = v + 1

    if not chosen:
        return [(1, text)]

    intro = text[:chosen[0].start()].strip()
    verses = []
    first_v = int(chosen[0].group(1))

    if first_v > 1 and intro:
        verses.append((1, intro))
    intro = ''  # always clear — don't prepend section-title noise to verse 1

    for i, m in enumerate(chosen):
        start = m.end()
        while start < len(text) and text[start] == ' ':
            start += 1
        end = chosen[i+1].start() if i+1 < len(chosen) else len(text)
        vt = text[start:end]
        if i == 0 and intro:
            vt = intro + ' ' + vt
        vt = re.sub(r'\s+', ' ', vt).strip()
        if vt:
            verses.append((int(m.group(1)), vt))

    return verses


# ── Parser ────────────────────────────────────────────────────────────────────

def find_testament_spans(lines):
    """Return list of (name_upper, start_line, end_line)."""
    markers = []
    for i, ln in enumerate(lines):
        if i < 1380:
            continue
        s = ln.strip()
        if s.startswith("THE TESTAMENT OF"):
            m = re.search(r"THE TESTAMENT OF (\w+)", s)
            if m:
                name = m.group(1).upper()
                # Avoid duplicates (some headers appear twice in OCR scan)
                if not markers or markers[-1][0] != name:
                    markers.append((name, i))

    # Find the hard end: the printer colophon / appendix listing that appears
    # after the last testament. Search only after the last testament marker to
    # avoid false-positives from front-matter colophons.
    last_start = markers[-1][1] if markers else 0
    file_end = len(lines)
    for i in range(last_start, len(lines)):
        s = lines[i].strip()
        if re.match(r'^Printed in\b', s, re.I):
            file_end = i
            break
        if re.match(r'^TRANSLATIONS OF\b', s, re.I):
            file_end = i
            break

    spans = []
    for idx, (name, start) in enumerate(markers):
        natural_end = markers[idx+1][1] if idx+1 < len(markers) else file_end
        end = min(natural_end, file_end)
        spans.append((name, start, end))
    return spans


def parse_testament(lines, start, end):
    """
    Parse lines[start+1 : end] into a list of chapter verse-lists.
    Each chapter is [(verse_num, text), ...].
    """
    chapters = []
    current_parts = []
    current_chapter_num = 0
    pending_inline = None  # inline text from a chapter-marker line

    def flush(ch_num):
        nonlocal current_parts, pending_inline
        parts = current_parts[:]
        current_parts = []
        # Prepend any inline text that came with the chapter marker
        if pending_inline:
            parts.insert(0, pending_inline)
            pending_inline = None
        raw = ' '.join(p for p in parts if p.strip())
        raw = re.sub(r'\s+', ' ', raw).strip()
        verses = extract_verses(raw) if raw else []
        chapters.append(verses)

    for i in range(start + 1, end):
        ln = lines[i]
        kind, *args = classify_line(ln)

        if kind == 'noise':
            continue
        elif kind == 'section_label':
            sl_ch = args[0]
            # Advance chapter when section label introduces a chapter > current
            if sl_ch > current_chapter_num:
                if current_chapter_num > 0:
                    flush(current_chapter_num)
                current_chapter_num = sl_ch
                current_parts = []
                pending_inline = None
        elif kind == 'chapter':
            ch_num = args[0]
            inline_text = args[1] if len(args) > 1 else None
            if ch_num > current_chapter_num:
                if current_chapter_num > 0:
                    flush(current_chapter_num)
                current_chapter_num = ch_num
                current_parts = []
                pending_inline = inline_text
            elif ch_num == current_chapter_num and inline_text:
                # Same chapter repeated with inline text — the text is real content
                # (OCR repeated the chapter marker; capture the prose that follows it)
                current_parts.append(inline_text)
            # else: out-of-order → ignore
        elif kind == 'text':
            current_parts.append(args[0])

    # Flush final chapter
    if current_chapter_num > 0 or current_parts or pending_inline:
        flush(current_chapter_num)

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
    print(f"Reading {RAW_PATH} …")
    with open(RAW_PATH, encoding='utf-8', errors='replace') as f:
        lines = [ln.rstrip() for ln in f]
    print(f"  {len(lines)} lines")

    spans = find_testament_spans(lines)
    name_map = {name: (s, e) for name, s, e in spans}
    print(f"  Found {len(spans)} testament markers: {[n for n,s,e in spans]}")

    conn = create_db()

    for tname, book_id, display_name in TESTAMENTS:
        if tname not in name_map:
            print(f"  WARNING: {tname} not found — skipping")
            continue
        start, end = name_map[tname]
        chapters = parse_testament(lines, start, end)

        # ── TJUD: hardcoded ch11 split ─────────────────────────────────────────
        # The OCR has no ch11 marker; ch11 content ("And I knew that the race of
        # the Canaanites was wicked...") got merged into the last verse of ch10.
        # Detect the anchor and split, then renumber ch11-ch25 → ch12-ch26.
        if book_id == 'TJUD' and len(chapters) == 25:
            anchor = 'And I knew that the race of the Canaanites was wicked'
            ch10 = chapters[9]   # 0-indexed: chapter 10 = index 9
            split_verse = None
            for i, (vnum, vtext) in enumerate(ch10):
                if anchor in vtext:
                    split_verse = i
                    break
            if split_verse is not None:
                # Split the verse text at the anchor
                v_pre, v_post_full = ch10[split_verse]
                anchor_pos = v_post_full.index(anchor)
                pre_text = v_post_full[:anchor_pos].strip()
                post_text = v_post_full[anchor_pos:].strip()
                # Re-parse post_text as ch11 verses
                ch11_verses = extract_verses(post_text) if post_text else []
                if not ch11_verses:
                    ch11_verses = [(1, post_text)]
                # Rebuild ch10 without the split verse + keep earlier verses
                new_ch10 = ch10[:split_verse]
                if pre_text:
                    new_ch10.append((v_pre, pre_text))
                # Insert ch11 between old ch10 and old ch11 (which was really ch12)
                chapters = chapters[:9] + [new_ch10] + [ch11_verses] + chapters[10:]
                print(f"    TJUD: injected ch11 ({len(ch11_verses)} verses) from ch10 v{v_pre} split")

        total = insert_testament(conn, book_id, display_name, chapters)
        print(f"  {book_id}: {len(chapters)} chapters, {total} verses")
        if chapters and chapters[0]:
            print(f"    Ch1 v1: {chapters[0][0][1][:80]!r}")

    conn.commit()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
