#!/usr/bin/env python3
# type: ignore
"""
seed_strongs.py — Populate text_tagged in kjva.db and occurrences tables
in strongs_hebrew.db / strongs_greek.db using STEPBible-Data (CC BY 4.0).

Source:  github.com/STEPBible/STEPBible-Data  (Translators Amalgamated OT+NT)
License: CC BY 4.0 — free to use in software without requesting permission.

Run from the project root:
    python3 scripts/seed_strongs.py

text_tagged format (space-separated tokens):
    word{H7225}   — word tagged with Strong's H7225
    word{}        — word with no Strong's (grammar function word or unmatched)
    *word{}       — italic/translator-supplied word, no Strong's
    *word{H430}   — italic word that still has a Strong's (rare)
"""

import re, os, sys, sqlite3, urllib.request
from urllib.parse import quote

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT      = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR  = os.path.join(ROOT, 'data')
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')

KJVA_DB   = os.path.join(DATA_DIR, 'kjva.db')
HEB_DB    = os.path.join(DATA_DIR, 'strongs_hebrew.db')
GRK_DB    = os.path.join(DATA_DIR, 'strongs_greek.db')

# ── STEPBible download targets ───────────────────────────────────────────────

BASE_URL = ('https://raw.githubusercontent.com/STEPBible/'
            'STEPBible-Data/master/Translators%20Amalgamated%20OT%2BNT/')

TAHOT_FILES = [
    'TAHOT Gen-Deu - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
    'TAHOT Jos-Est - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
    'TAHOT Job-Sng - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
    'TAHOT Isa-Mal - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt',
]

TAGNT_FILES = [
    'TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
    'TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
]

# ── Book abbreviation map: STEPBible → kjva.db book_id ───────────────────────

BOOK_MAP = {
    # OT
    'Gen':'GEN','Exo':'EXO','Lev':'LEV','Num':'NUM','Deu':'DEU',
    'Jos':'JOS','Jdg':'JDG','Rut':'RUT','1Sa':'1SA','2Sa':'2SA',
    '1Ki':'1KI','2Ki':'2KI','1Ch':'1CH','2Ch':'2CH','Ezr':'EZR',
    'Neh':'NEH','Est':'EST','Job':'JOB','Psa':'PSA','Pro':'PRO',
    'Ecc':'ECC','Sng':'SNG','Isa':'ISA','Jer':'JER','Lam':'LAM',
    'Eze':'EZE','Dan':'DAN','Hos':'HOS','Joe':'JOE','Amo':'AMO',
    'Oba':'OBA','Jon':'JON','Mic':'MIC','Nah':'NAH','Hab':'HAB',
    'Zep':'ZEP','Hag':'HAG','Zec':'ZEC','Mal':'MAL',
    # NT
    'Mat':'MAT','Mrk':'MRK','Luk':'LUK','Jhn':'JHN','Act':'ACT',
    'Rom':'ROM','1Co':'1CO','2Co':'2CO','Gal':'GAL','Eph':'EPH',
    'Php':'PHI','Phi':'PHI','Col':'COL','1Th':'1TH','2Th':'2TH',
    '1Ti':'1TI','2Ti':'2TI','Tit':'TIT','Phm':'PHM','Heb':'HEB',
    'Jas':'JAM','Jam':'JAM','1Pe':'1PE','2Pe':'2PE','1Jn':'1JN',
    '2Jn':'2JN','3Jn':'3JN','Jud':'JUD','Rev':'REV',
}

# ── Helpers ───────────────────────────────────────────────────────────────────

_WORD_ROW  = re.compile(r'^([A-Z][a-z0-9]+\.\d+\.\d+)#(\d+)=[A-Z]+')
_VERSE_REF = re.compile(r'^([A-Z][a-z0-9]+)\.(\d+)\.(\d+)$')
_STRONGS   = re.compile(r'^([HG])(\d+)[A-Za-z]?$')


def normalize_strongs(raw):  # str -> Optional[str]
    """H0430G → H430, H1254A → H1254, G0976 → G976, H9003 → None (grammar)."""
    s = raw.strip().split('\\')[0]       # strip trailing \H9016 etc.
    s = re.sub(r'_[A-Z]$', '', s)       # strip instance markers _A _B
    s = s.lstrip('{').rstrip('}')
    m = _STRONGS.match(s)
    if not m:
        return None
    prefix, digits = m.groups()
    num = int(digits)
    if prefix == 'H' and num >= 9000:   # grammar/prefix pseudo-strongs
        return None
    return f'{prefix}{num}'             # H430, G976 (no leading zeros)


def normalize_word(w: str) -> str:
    """Lowercase, strip punctuation for matching."""
    return re.sub(r'[^a-z]', '', w.lower())


def is_match(a: str, b: str) -> float:
    """Return similarity score 0-1 between two normalised words."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # Prefix/suffix match covers plurals, tense endings (heaven/heavens, create/created).
    # Require minimum length of 3 for the shorter word to prevent false positives like
    # "he" matching "the", "a" matching "an", "I" matching "in", etc.
    shorter = min(len(a), len(b))
    if shorter >= 3 and (a.startswith(b) or b.startswith(a)):
        return 0.85
    # Substring match: require both words to be at least 3 chars to prevent
    # short pronoun/article fragments matching unrelated longer words.
    if len(a) >= 3 and len(b) >= 3 and (a in b or b in a):
        return 0.7
    return 0.0


# Implicit-subject pronouns embedded in Hebrew/Greek verb forms — these appear in
# STEPBible English glosses (e.g. "he created", "they said") but are NOT separate KJV
# words. Skipping them prevents mismatches like "he" → "the" or "we" → "were".
_IMPLICIT_VERB_PRONOUNS = frozenset({
    'he', 'she', 'they', 'i', 'we', 'it', 'thou', 'ye', 'you',
    'his', 'her', 'their', 'our', 'my',
})


def expand_token(translation, dstrongs, is_nt):  # -> list of (str, Optional[str], bool)
    """
    Expand one STEPBible source-word row into (english_word, strong, italic) triples.

    translation — e.g. 'in/ beginning', '[The] book', '<obj.>'
    dstrongs    — e.g. 'H9003/{H7225G}' (TAHOT) or 'G0976' (TAGNT, already simple)
    is_nt       — True for NT (simpler: one Strong's per token)

    Rules:
      <word>  → skip (Hebrew/Greek particle not translated in KJV)
      [word]  → italic translated word (Strong's = None)
      word    → content word with Strong's from corresponding dStrongs segment
    """
    # For TAHOT, split dStrongs by '/' parallel to translation '/' splits
    if is_nt:
        strong_parts = [normalize_strongs(dstrongs)]
        trans_parts  = [translation]
    else:
        raw_d_parts  = dstrongs.split('/')
        strong_parts = [normalize_strongs(p.strip().lstrip('{').rstrip('}').split('\\')[0])
                        for p in raw_d_parts]
        trans_parts  = translation.split('/')

    tokens: list[tuple[str,str|None,bool]] = []

    for i, tp in enumerate(trans_parts):
        strong = strong_parts[i] if i < len(strong_parts) else strong_parts[-1]
        words  = tp.split()
        for w in words:
            w = w.strip()
            if not w:
                continue
            # Completely skip untranslated markers like <obj.>
            if re.fullmatch(r'<[^>]+>', w):
                continue
            # Italic markers [word]
            if re.fullmatch(r'\[[^\]]+\]', w):
                tokens.append((w[1:-1], None, True))
                continue
            if w.startswith('['):
                tokens.append((w[1:], None, True))
                continue
            if w.endswith(']'):
                tokens.append((w[:-1], None, True))
                continue
            # Skip implicit-subject pronouns embedded in verb glosses (e.g. "he created",
            # "they said"). These are not separate KJV words and cause false alignments.
            # Only skip when the trans_part contains MORE than one word AND the strong
            # is shared across all words (i.e. the pronoun is part of a verb gloss).
            w_bare = re.sub(r'[^a-z]', '', w.lower())
            if w_bare in _IMPLICIT_VERB_PRONOUNS and len(words) > 1:
                continue
            tokens.append((w, strong, False))

    return tokens


def align_verse(kjv_words, step_tokens):  # -> list of (str, Optional[str], bool)
    """
    Align KJV word list with ordered STEPBible tokens.
    Returns [(kjv_word, strong_or_none, is_italic)] for every KJV word.

    Uses greedy best-match assignment with position-proximity weighting so
    Hebrew VSO and English SVO word-order differences are handled gracefully.
    """
    n = len(kjv_words)
    m = len(step_tokens)
    if n == 0 or m == 0:
        return [(w, None, True) for w in kjv_words]

    # Build candidate list: (score, kjv_idx, step_idx)
    candidates = []
    for i, kw in enumerate(kjv_words):
        kn = normalize_word(kw)
        for j, (sw, _strong, _italic) in enumerate(step_tokens):
            sn = normalize_word(sw)
            sim = is_match(kn, sn)
            if sim > 0:
                # Small penalty for positional distance (prefer in-order matches)
                pos_penalty = abs(i / n - j / m) * 0.15
                candidates.append((sim - pos_penalty, i, j))

    candidates.sort(reverse=True)

    matched_kjv  = [False] * n
    matched_step = [False] * m
    assignments = [None] * n   # list of (strong, italic) or None

    for _score, i, j in candidates:
        if not matched_kjv[i] and not matched_step[j]:
            _sw, strong, italic = step_tokens[j]
            assignments[i] = (strong, italic)
            matched_kjv[i]  = True
            matched_step[j] = True

    result = []
    for i, kw in enumerate(kjv_words):
        if assignments[i] is not None:
            strong, italic = assignments[i]
            result.append((kw, strong, italic))
        else:
            result.append((kw, None, True))   # not found → treat as supplied word
    return result


def build_tagged(kjv_text, step_tokens):  # -> str
    """
    Full pipeline: align + format as 'word{H7225} *word{} word{}' string.
    Punctuation remains attached to the word in the output.
    """
    kjv_words = kjv_text.split()
    if not kjv_words:
        return ''

    aligned = align_verse(kjv_words, step_tokens)

    parts = []
    for (kw, strong, italic) in aligned:
        prefix = '*' if italic else ''
        tag    = strong if strong else ''
        parts.append(f'{prefix}{kw}{{{tag}}}')

    return ' '.join(parts)


# ── Fetch / cache STEPBible files ─────────────────────────────────────────────

def fetch_file(filename: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = os.path.join(CACHE_DIR, filename)
    if os.path.exists(cache):
        print(f'  cache hit : {filename[:70]}')
        with open(cache, encoding='utf-8-sig') as f:
            return f.read()
    url = BASE_URL + quote(filename)
    print(f'  download  : {filename[:70]}')
    req = urllib.request.Request(url, headers={'User-Agent': 'berean-seeder/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read().decode('utf-8-sig')
    with open(cache, 'w', encoding='utf-8') as f:
        f.write(data)
    return data


# ── Parse STEPBible individual word rows ─────────────────────────────────────

def parse_file(content, is_nt):  # -> dict mapping (book_id, chapter, verse) -> token list
    """
    Returns {(book_abbr, chapter, verse): [(word, strong, italic), ...]}
    Only individual word rows (e.g. 'Gen.1.1#01=L') are parsed.
    """
    verse_tokens: dict[tuple[str,int,int], list] = {}

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue

        cols = line.split('\t')
        if len(cols) < 5:
            continue

        ref_col = cols[0].strip()
        if not _WORD_ROW.match(ref_col):
            continue

        # Extract verse reference (before '#')
        verse_part = ref_col.split('#')[0]
        vm = _VERSE_REF.match(verse_part)
        if not vm:
            continue

        step_book = vm.group(1)
        chapter   = int(vm.group(2))
        verse     = int(vm.group(3))
        book_id   = BOOK_MAP.get(step_book)
        if not book_id:
            continue

        if is_nt:
            # TAGNT: col2=English, col3=dStrong=Grammar, col11=sStrong
            if len(cols) < 12:
                continue
            translation = cols[2].strip()
            # prefer sStrong column (col 11); fallback to dStrong before '='
            sstrong = cols[11].strip() if cols[11].strip() else ''
            if not sstrong:
                sstrong = cols[3].split('=')[0].strip()
            dstrongs = sstrong
        else:
            # TAHOT: col3=Translation, col4=dStrongs, col8=RootStrong
            translation = cols[3].strip()
            dstrongs    = cols[4].strip()

        if not translation:
            continue

        tokens = expand_token(translation, dstrongs, is_nt)
        if not tokens:
            continue

        key = (book_id, chapter, verse)
        verse_tokens.setdefault(key, []).extend(tokens)

    return verse_tokens


# ── Database helpers ──────────────────────────────────────────────────────────

def add_text_tagged_column(kjva: sqlite3.Connection) -> None:
    cols = {r[1] for r in kjva.execute("PRAGMA table_info(verses)")}
    if 'text_tagged' not in cols:
        kjva.execute("ALTER TABLE verses ADD COLUMN text_tagged TEXT")
        kjva.commit()
        print("  Added text_tagged column to verses table.")
    else:
        print("  text_tagged column already exists.")


def add_occurrences_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS occurrences (
            strongs_id TEXT NOT NULL,
            book_num   INTEGER NOT NULL,
            chapter    INTEGER NOT NULL,
            verse      INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_occ_strong ON occurrences(strongs_id)")
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("Berean Strong's seeder — using STEPBible-Data CC BY 4.0")
    print("=" * 60)

    # ── Step 1: collect all STEPBible verse tokens ───────────────────────────
    all_tokens: dict[tuple[str,int,int], list] = {}

    print("\n[1/4] Parsing TAHOT (Hebrew OT)…")
    for fname in TAHOT_FILES:
        content = fetch_file(fname)
        tokens  = parse_file(content, is_nt=False)
        for k, v in tokens.items():
            all_tokens.setdefault(k, []).extend(v)
        print(f"       → {len(tokens):,} verses parsed")

    print("\n[2/4] Parsing TAGNT (Greek NT)…")
    for fname in TAGNT_FILES:
        content = fetch_file(fname)
        tokens  = parse_file(content, is_nt=True)
        for k, v in tokens.items():
            all_tokens.setdefault(k, []).extend(v)
        print(f"       → {len(tokens):,} verses parsed")

    print(f"\n       Total verses with alignment data: {len(all_tokens):,}")

    # ── Step 2: open kjva.db and update text_tagged ──────────────────────────
    print("\n[3/4] Writing text_tagged to kjva.db…")
    kjva = sqlite3.connect(KJVA_DB)
    add_text_tagged_column(kjva)

    # Build book_id → rowid map for occurrences table
    book_rowid = {}
    for row in kjva.execute("SELECT rowid, id FROM books ORDER BY rowid"):
        book_rowid[row[1]] = row[0]

    # Accumulate occurrences per language
    heb_occs: list[tuple[str,int,int,int]] = []   # (strongs_id, book_num, ch, v)
    grk_occs: list[tuple[str,int,int,int]] = []

    rows = kjva.execute(
        "SELECT book_id, chapter, verse_num, text FROM verses ORDER BY book_id, chapter, verse_num"
    ).fetchall()

    updated = 0
    no_data = 0

    for (book_id, chapter, verse_num, kjv_text) in rows:
        key = (book_id, chapter, verse_num)
        step = all_tokens.get(key)

        if not step:
            no_data += 1
            continue

        tagged = build_tagged(kjv_text, step)
        kjva.execute(
            "UPDATE verses SET text_tagged = ? WHERE book_id = ? AND chapter = ? AND verse_num = ?",
            (tagged, book_id, chapter, verse_num)
        )
        updated += 1

        # Collect occurrences
        book_num = book_rowid.get(book_id, 0)
        seen_strongs: set[str] = set()
        for (_w, strong, _italic) in step:
            if strong and strong not in seen_strongs:
                seen_strongs.add(strong)
                if strong.startswith('H'):
                    heb_occs.append((strong, book_num, chapter, verse_num))
                else:
                    grk_occs.append((strong, book_num, chapter, verse_num))

        if updated % 5000 == 0:
            kjva.commit()
            print(f"       … {updated:,} verses tagged")

    kjva.commit()
    kjva.close()
    print(f"  Tagged: {updated:,} verses  |  No alignment data: {no_data:,} verses")

    # ── Step 4: populate occurrences tables ──────────────────────────────────
    print("\n[4/4] Writing occurrences tables…")

    for db_path, occs, lang in [(HEB_DB, heb_occs, 'Hebrew'), (GRK_DB, grk_occs, 'Greek')]:
        conn = sqlite3.connect(db_path)
        add_occurrences_table(conn)
        conn.execute("DELETE FROM occurrences")
        conn.executemany(
            "INSERT INTO occurrences (strongs_id, book_num, chapter, verse) VALUES (?,?,?,?)",
            occs
        )
        conn.commit()

        # Count occurrences per entry for easy retrieval
        # Also add an 'occurrence_count' column to entries if missing
        cols = {r[1] for r in conn.execute("PRAGMA table_info(entries)")}
        if 'occurrence_count' not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN occurrence_count INTEGER DEFAULT 0")
        conn.execute("""
            UPDATE entries SET occurrence_count = (
                SELECT COUNT(*) FROM occurrences WHERE occurrences.strongs_id = entries.strongs_id
            )
        """)
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM occurrences").fetchone()
        conn.close()
        print(f"  {lang}: {count[0]:,} occurrence rows written ({len(set(r[0] for r in occs)):,} unique Strong's IDs)")

    print("\n✓ Done. Run the app to see Strong's inline.")


if __name__ == '__main__':
    main()
