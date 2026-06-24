#!/usr/bin/env python3
# type: ignore
"""
augment_nt_articles.py — Post-process kjva.db text_tagged to add Greek Strong's
numbers that bbli leaves untagged, using TGNT cross-reference data.

Two augmentation passes per verse:

  Pass A — Multi-word glosses: when TGNT gives one Greek word a multi-word English
    gloss (e.g. G3439 "only begotten", G749 "high priest"), tag ALL the English
    words that match the gloss, not just the primary word bbli picked.

  Pass B — Article/pronoun cross-references: TGNT encodes each article's
    relationship to its head noun via a '»' forward reference in col[10]
    (e.g. #09»10:G4334 means "this G3588 article belongs to the G4334 at
    position 10"). We walk backward from the head-noun anchor and assign the
    article's G-number to KJV words that match the article's gloss, using
    direct string matching plus a pronoun-equivalence table so that TGNT "those"
    matches KJV "them", TGNT "one" matches KJV "he"/"that", etc.

This script NEVER modifies already-tagged {Gxxx} words from bbli. It only
assigns Strong's numbers to currently-empty {} slots.

Run after reseed_tagged_from_bbli.py:
    python3 scripts/augment_nt_articles.py
"""

import os
import re
import sqlite3
import sys

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT      = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR  = os.path.join(ROOT, 'data')
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')

KJVA_DB = os.path.join(DATA_DIR, 'kjva.db')
GRK_DB  = os.path.join(DATA_DIR, 'strongs_greek.db')

TAGNT_FILES = [
    'TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
    'TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
]

# ── NT book map: STEPBible abbr → kjva.db book_id ────────────────────────────

BOOK_MAP: dict[str, str] = {
    'Mat': 'MAT', 'Mrk': 'MRK', 'Luk': 'LUK', 'Jhn': 'JHN', 'Act': 'ACT',
    'Rom': 'ROM', '1Co': '1CO', '2Co': '2CO', 'Gal': 'GAL', 'Eph': 'EPH',
    'Php': 'PHI', 'Phi': 'PHI', 'Col': 'COL', '1Th': '1TH', '2Th': '2TH',
    '1Ti': '1TI', '2Ti': '2TI', 'Tit': 'TIT', 'Phm': 'PHM', 'Heb': 'HEB',
    'Jas': 'JAM', 'Jam': 'JAM', '1Pe': '1PE', '2Pe': '2PE', '1Jn': '1JN',
    '2Jn': '2JN', '3Jn': '3JN', 'Jud': 'JUD', 'Rev': 'REV',
}

NT_BOOK_IDS: frozenset[str] = frozenset(BOOK_MAP.values())

# ── Regexes ───────────────────────────────────────────────────────────────────

_WORD_ROW  = re.compile(r'^([A-Z][a-z0-9]+\.\d+\.\d+)#(\d+)=[A-Z]')
_VERSE_REF = re.compile(r'^([A-Z][a-z0-9]+)\.(\d+)\.(\d+)$')
_STRONGS   = re.compile(r'^([HG])(\d+)[A-Za-z]?$')
_XREF_FWD  = re.compile(r'»\d+:(G\d+)')      # forward reference »MM:Gxxxx
_TOKEN_RE  = re.compile(r'^([!*~]?)(.*?)\{([^}]*)\}$')
_GTAG_RE   = re.compile(r'\{(G\d+)\}')        # for occurrence scanning

# ── String helpers ────────────────────────────────────────────────────────────

def normalize_word(w: str) -> str:
    return re.sub(r'[^a-z]', '', w.lower())


def is_match(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    shorter = min(len(a), len(b))
    if shorter >= 3 and (a.startswith(b) or b.startswith(a)):
        return 0.85
    if len(a) >= 3 and len(b) >= 3 and (a in b or b in a):
        return 0.7
    return 0.0


def normalize_strongs(raw: str) -> str | None:
    s = raw.strip().split('\\')[0]
    s = re.sub(r'_[A-Z]$', '', s)
    s = s.lstrip('{').rstrip('}')
    m = _STRONGS.match(s)
    if not m:
        return None
    prefix, digits = m.groups()
    num = int(digits)
    if prefix == 'H' and num >= 9000:
        return None
    return f'{prefix}{num}'


# ── Pronoun/article equivalence table ────────────────────────────────────────
# Maps KJV word (normalized) → set of TGNT gloss words that linguistically
# correspond, allowing G3588 articles to be found even when TGNT says "those"
# and KJV says "them", or TGNT says "one" and KJV says "he"/"that".

PRONOUN_EQ: dict[str, set[str]] = {
    'he':    {'one', 'who', 'whoever', 'whoso'},
    'she':   {'one', 'who', 'whoever'},
    'it':    {'this', 'which'},
    'they':  {'those', 'these'},
    'them':  {'those', 'these'},
    'him':   {'one'},
    'her':   {'one'},
    'that':  {'which', 'one'},   # relative-pronoun "that"
    'which': {'who'},
    'who':   {'which', 'one'},
    'whom':  {'who'},
}


def can_match(kjv_norm: str, gloss_norm: str) -> bool:
    """True if kjv_norm and gloss_norm are considered the same word."""
    if is_match(kjv_norm, gloss_norm) > 0:
        return True
    return gloss_norm in PRONOUN_EQ.get(kjv_norm, set())


# ── TGNT parser ───────────────────────────────────────────────────────────────

class TgntToken:
    __slots__ = ('strong', 'gloss_words', 'xref_strong')

    def __init__(self, strong: str | None, gloss_words: list[str], xref_strong: str | None):
        self.strong      = strong       # G-number for this Greek word
        self.gloss_words = gloss_words  # normalized English gloss words
        self.xref_strong = xref_strong  # G-number of the head noun (from » ref), or None


# Subject pronouns that are implicit in Greek verb forms — never standalone
# Greek words, so never tag adjacent KJV slots with the verb's G-number
_IMPLICIT_PRONOUNS = frozenset({'he', 'she', 'they', 'i', 'we', 'it', 'thou', 'ye', 'you'})

# Greek has no indefinite article — "a/an" in TGNT glosses is always English-added
# English indefinite articles and case-marker prepositions that appear in TGNT
# phrase glosses but never represent standalone Greek words in Pass A context:
#   "a/an"   — Greek has no indefinite article
#   "by"     — English expression of dative/instrumental (e.g. "by grace" for χάριτί)
#   "from"   — English expression of ablative/separation (e.g. "from thence" for ἐκεῖθεν)
_NEVER_TAG_WORDS = frozenset({'a', 'an', 'by', 'from'})


def _extract_gloss_words(gloss_raw: str) -> list[str]:
    """
    Extract normalized words from a TGNT English gloss.

    Removes before splitting:
      - [bracket] groups entirely — these are translator-supplied words with no
        direct Greek word behind them (e.g. "In [the]" → "In", "to please [Him]" → "to please")
      - <angle> groups entirely — untranslated Greek words (<the>, <obj.>)

    Filters after normalizing:
      - implicit subject pronouns (he/she/they/i/we/it/thou/ye/you) — these appear
        in verb glosses as implicit subjects, but are never standalone Greek words
        that need a separate English slot tagged (e.g. "He gave" → ["gave"])
      - indefinite articles a/an — Greek has no indefinite article; any "a/an" in
        TGNT glosses is English grammar, not a Greek word
      - leading "to" in multi-word glosses — English infinitive marker ("to please",
        "To believe") or dative expression ("to God"); actual G1519/G4314 preposition
        tokens handle the standalone "to" word separately
    """
    # Remove entire bracket groups first (handles multi-word groups like "[it is]")
    cleaned = re.sub(r'\[[^\]]*\]', '', gloss_raw)
    # Remove angle-bracket groups (<the>, <obj.> etc.)
    cleaned = re.sub(r'<[^>]*>', '', cleaned)

    words: list[str] = []
    for w in cleaned.split():
        w = w.strip('.,;:!?¶;')
        n = normalize_word(w)
        if not n:
            continue
        if n in _NEVER_TAG_WORDS:
            continue
        if n in _IMPLICIT_PRONOUNS:
            continue
        words.append(n)

    # Strip English infinitive "to" when it leads a multi-word gloss.
    # Actual Greek preposition tokens (G1519, G4314) have their own TGNT rows.
    if len(words) >= 2 and words[0] == 'to':
        words = words[1:]

    return words


def parse_nt_with_xrefs(content: str) -> dict[tuple[str, int, int], list[TgntToken]]:
    """
    Parse a TAGNT cache file and return per-verse TgntToken lists.
    Columns (tab-separated):
      col[0]  = ref (Heb.11.6#09=NKO)
      col[2]  = English gloss
      col[3]  = dStrong=Grammar
      col[10] = cross-reference (#09»10:G4334)
      col[11] = sStrong (preferred) — may have instance suffix _A/_B
    """
    result: dict[tuple[str, int, int], list[TgntToken]] = {}

    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue

        cols = line.split('\t')
        if len(cols) < 12:
            continue

        ref_col = cols[0].strip()
        if not _WORD_ROW.match(ref_col):
            continue

        verse_part = ref_col.split('#')[0]
        vm = _VERSE_REF.match(verse_part)
        if not vm:
            continue

        step_book = vm.group(1)
        chapter   = int(vm.group(2))
        verse_num = int(vm.group(3))
        book_id   = BOOK_MAP.get(step_book)
        if not book_id:
            continue

        # sStrong (col 11) preferred; fallback to dStrong prefix
        sraw = cols[11].strip() if cols[11].strip() else cols[3].split('=')[0].strip()
        strong = normalize_strongs(sraw)
        if not strong or not strong.startswith('G'):
            continue   # grammar entry or Hebrew — skip

        gloss_words = _extract_gloss_words(cols[2].strip())

        # Forward cross-reference from col[10], e.g. '#09»10:G4334'
        xref_strong: str | None = None
        if len(cols) > 10:
            m = _XREF_FWD.search(cols[10])
            if m:
                xref_strong = normalize_strongs(m.group(1))

        key = (book_id, chapter, verse_num)
        result.setdefault(key, []).append(TgntToken(strong, gloss_words, xref_strong))

    return result


# ── text_tagged parse / build ─────────────────────────────────────────────────

def parse_text_tagged(text_tagged: str) -> list[dict]:
    """
    Split text_tagged into a list of token dicts:
      {'word': str, 'strong': str|None, 'is_italic': bool,
       'is_red': bool, 'is_skip': bool}

    Token types:
      word{Gxxx}   → word, strong=Gxxx, is_italic=False
      *word{}      → word, strong=None, is_italic=True
      !word{Gxxx}  → word, strong=Gxxx, is_red=True   (red-letter)
      ~{Hxxx}      → skip-token (parenthetical particle, no English word)
    """
    tokens: list[dict] = []
    for raw in text_tagged.split():
        m = _TOKEN_RE.match(raw)
        if not m:
            continue
        prefix, word, strong_raw = m.group(1), m.group(2), m.group(3)
        strong = strong_raw.strip() or None
        if prefix == '~':
            tokens.append({'word': '', 'strong': strong, 'is_italic': False,
                           'is_red': False, 'is_skip': True})
        else:
            tokens.append({'word': word, 'strong': strong,
                           'is_italic': prefix == '*', 'is_red': prefix == '!',
                           'is_skip': False})
    return tokens


def build_text_tagged(tokens: list[dict]) -> str:
    parts: list[str] = []
    for t in tokens:
        s = t['strong'] or ''
        if t['is_skip']:
            parts.append(f'~{{{s}}}')
        else:
            prefix = '!' if t['is_red'] else ('*' if t['is_italic'] else '')
            parts.append(f"{prefix}{t['word']}{{{s}}}")
    return ' '.join(parts)


# ── Core augmentation ─────────────────────────────────────────────────────────

def augment_verse(bbli: list[dict], tgnt_tokens: list[TgntToken]) -> bool:
    """
    Mutate bbli token list in-place, adding Strong's numbers to empty {} slots.
    Returns True if any change was made.

    For each TGNT token T:
      Pass A — multi-word gloss: if T.strong already appears in bbli (primary
        match), look for the other gloss words in adjacent untagged slots.
      Pass B — article cross-ref: if T has a xref_strong that already appears
        in bbli, walk backward from that anchor to find untagged words matching
        T's gloss via is_match or PRONOUN_EQ, and assign T.strong to them.
    """
    changed = False

    for T in tgnt_tokens:
        if not T.strong:
            continue

        # ── Pass A: multi-word gloss ──────────────────────────────────────────
        primary_positions = [i for i, t in enumerate(bbli) if t['strong'] == T.strong]

        for pri in primary_positions:
            pri_norm = normalize_word(bbli[pri]['word'])
            for gw in T.gloss_words:
                if can_match(pri_norm, gw):
                    continue   # primary word already covers this gloss word
                # Search within ±2 positions for an untagged slot matching gw
                for offset in range(-2, 3):
                    if offset == 0:
                        continue
                    j = pri + offset
                    if j < 0 or j >= len(bbli):
                        continue
                    t = bbli[j]
                    if t['strong'] is not None or t['is_italic'] or t['is_skip']:
                        continue
                    wn = normalize_word(t['word'])
                    # Skip very short KJV words (len ≤ 2: "in", "of", "on", "at"…)
                    # in Pass A — these function words expressing Greek case should only
                    # be tagged via Pass B cross-references, not content-word glosses.
                    if len(wn) <= 2:
                        continue
                    if can_match(wn, gw):
                        bbli[j] = dict(t, strong=T.strong)
                        changed = True
                        break   # one slot per gloss word

        # ── Pass B: article/pronoun via » cross-reference ─────────────────────
        if not T.xref_strong or not T.gloss_words:
            continue   # no forward ref, or no gloss words to match against

        anchor_positions = [i for i, t in enumerate(bbli) if t['strong'] == T.xref_strong]

        for anchor in anchor_positions:
            # Walk backward from anchor looking for matching untagged words.
            # Stop immediately at a translator-supplied (italic) word or at the
            # previous content word (already tagged) — those are hard boundaries.
            # Skip over non-matching untagged words (gap between article and anchor).
            for dist in range(1, 5):
                j = anchor - dist
                if j < 0:
                    break
                t = bbli[j]
                if t['is_italic'] or t['is_skip']:
                    break   # translator-supplied boundary
                if t['strong'] is not None:
                    break   # previous content word boundary
                # Untagged non-italic: try to match any of T's gloss words
                wn = normalize_word(t['word'])
                for gw in T.gloss_words:
                    if can_match(wn, gw):
                        bbli[j] = dict(t, strong=T.strong)
                        changed = True
                        break   # matched; keep scanning backward for more

    return changed


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print('=' * 60)
    print('NT article augmentation — TGNT post-processing')
    print('=' * 60)

    # ── 1. Load TGNT data from cache ─────────────────────────────────────────
    print('\n[1/4] Loading TGNT from cache…')
    all_tgnt: dict[tuple[str, int, int], list[TgntToken]] = {}
    for fname in TAGNT_FILES:
        cache_path = os.path.join(CACHE_DIR, fname)
        if not os.path.exists(cache_path):
            print(f'  ERROR: cache file missing: {fname}')
            print('  Run seed_strongs.py first to populate the cache.')
            sys.exit(1)
        with open(cache_path, encoding='utf-8-sig') as f:
            content = f.read()
        tokens = parse_nt_with_xrefs(content)
        for k, v in tokens.items():
            all_tgnt.setdefault(k, []).extend(v)
        print(f'  → {len(tokens):,} verses parsed from {os.path.basename(fname)[:60]}')
    print(f'  Total: {len(all_tgnt):,} NT verses with TGNT data')

    # ── 2. Augment kjva.db text_tagged ───────────────────────────────────────
    print('\n[2/4] Augmenting text_tagged in kjva.db…')
    kjva = sqlite3.connect(KJVA_DB)

    rows = kjva.execute(
        'SELECT book_id, chapter, verse_num, text_tagged FROM verses '
        'WHERE text_tagged IS NOT NULL ORDER BY book_id, chapter, verse_num'
    ).fetchall()

    updated = skipped = no_data = 0

    for (book_id, chapter, verse_num, text_tagged) in rows:
        tgnt_tokens = all_tgnt.get((book_id, chapter, verse_num))
        if not tgnt_tokens:
            no_data += 1
            continue

        bbli = parse_text_tagged(text_tagged)
        if not bbli:
            skipped += 1
            continue

        changed = augment_verse(bbli, tgnt_tokens)

        if changed:
            kjva.execute(
                'UPDATE verses SET text_tagged = ? '
                'WHERE book_id = ? AND chapter = ? AND verse_num = ?',
                (build_text_tagged(bbli), book_id, chapter, verse_num),
            )
            updated += 1
        else:
            skipped += 1

        if (updated + skipped) % 2000 == 0:
            kjva.commit()
            print(f'  … {updated:,} updated, {skipped:,} unchanged')

    kjva.commit()
    print(f'  Done — {updated:,} verses updated  |  {skipped:,} unchanged  |  {no_data:,} OT/no-data')

    # ── 3. Rebuild KJVA occurrence rows in strongs_greek.db ──────────────────
    print('\n[3/4] Rebuilding KJVA occurrence rows in strongs_greek.db…')
    grk = sqlite3.connect(GRK_DB)

    # Check whether text_id column exists (added by build_lxx_occurrences.py)
    occ_cols = {r[1] for r in grk.execute('PRAGMA table_info(occurrences)')}
    has_text_id = 'text_id' in occ_cols

    # Build book_id → rowid map
    book_rowid: dict[str, int] = {}
    for row in kjva.execute('SELECT rowid, id FROM books ORDER BY rowid'):
        book_rowid[row[1]] = row[0]

    # Collect G-number occurrences from augmented NT text_tagged
    nt_ids_param = ','.join('?' * len(NT_BOOK_IDS))
    nt_rows = kjva.execute(
        f'SELECT book_id, chapter, verse_num, text_tagged FROM verses '
        f'WHERE book_id IN ({nt_ids_param}) AND text_tagged IS NOT NULL',
        tuple(NT_BOOK_IDS),
    ).fetchall()

    kjva_occs: list[tuple] = []
    for (book_id, chapter, verse_num, text_tagged) in nt_rows:
        book_num = book_rowid.get(book_id, 0)
        if not book_num:
            continue
        seen: set[str] = set()
        for m in _GTAG_RE.finditer(text_tagged):
            g = m.group(1)
            if g not in seen:
                seen.add(g)
                if has_text_id:
                    kjva_occs.append((g, 'kjva', book_num, chapter, verse_num))
                else:
                    kjva_occs.append((g, book_num, chapter, verse_num))

    if has_text_id:
        grk.execute("DELETE FROM occurrences WHERE text_id = 'kjva'")
        grk.executemany(
            'INSERT INTO occurrences (strongs_id, text_id, book_num, chapter, verse) '
            'VALUES (?,?,?,?,?)',
            kjva_occs,
        )
    else:
        grk.execute('DELETE FROM occurrences')
        grk.executemany(
            'INSERT INTO occurrences (strongs_id, book_num, chapter, verse) VALUES (?,?,?,?)',
            kjva_occs,
        )

    grk.commit()
    unique_g = len({r[0] for r in kjva_occs})
    print(f'  Inserted {len(kjva_occs):,} KJVA occurrence rows ({unique_g:,} unique G-numbers)')

    # ── 4. Refresh occurrence_count (KJVA + LXX) ─────────────────────────────
    print('\n[4/4] Refreshing occurrence_count…')
    grk.execute("""
        UPDATE entries SET occurrence_count = (
            SELECT COUNT(*) FROM occurrences WHERE occurrences.strongs_id = entries.strongs_id
        )
    """)
    grk.commit()

    total   = grk.execute('SELECT COUNT(*) FROM occurrences').fetchone()[0]
    kjva_ct = grk.execute(
        "SELECT COUNT(*) FROM occurrences WHERE text_id = 'kjva'" if has_text_id
        else "SELECT COUNT(*) FROM occurrences"
    ).fetchone()[0]

    if has_text_id:
        lxx_ct = grk.execute("SELECT COUNT(*) FROM occurrences WHERE text_id = 'lxx'").fetchone()[0]
        print(f'  Total: {total:,}  (KJVA={kjva_ct:,}  LXX={lxx_ct:,})')
    else:
        print(f'  Total: {total:,}')

    grk.close()
    kjva.close()
    print('\n✓ Done.')


if __name__ == '__main__':
    main()
