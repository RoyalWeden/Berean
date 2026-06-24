#!/usr/bin/env python3
"""
Build data/lxx.db — Greek LXX (Rahlfs 1935) with Strong's G-number tagging.

Source: eliranwong/LXX-Rahlfs-1935 (CC-BY-NC-SA 4.0)
Clone once with:
    git clone --depth=1 https://github.com/eliranwong/LXX-Rahlfs-1935 /tmp/lxx-rahlfs

Then run:
    python3 scripts/build_lxx_greek.py [/tmp/lxx-rahlfs]

The script is idempotent — drops and recreates all tables on each run.
"""

import sys, os, re, sqlite3

REPO = sys.argv[1] if len(sys.argv) > 1 else '/tmp/lxx-rahlfs'
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'lxx.db')

WORDS_CSV   = os.path.join(REPO, '01_wordlist_unicode', 'text_accented.csv')
STRONGS_CSV = os.path.join(REPO, '07_StrongNumber', 'final_Strongs.csv')
EVERSES_CSV = os.path.join(REPO, '08_versification', 'ccat', 'E-verse.csv')

for p in [WORDS_CSV, STRONGS_CSV, EVERSES_CSV]:
    if not os.path.exists(p):
        sys.exit(f'Missing file: {p}\nClone the repo first (see header).')

# ---------------------------------------------------------------------------
# Book metadata: LXX abbreviation → (berean_id, full_name, short_name, testament, sort)
# 59 books in the LXX-Rahlfs-1935 dataset including alternate text versions.
# ---------------------------------------------------------------------------
BOOK_META = {
    'Gen':     ('GEN',  'Genesis',                     'Gen',   'OT',            10),
    'Exod':    ('EXO',  'Exodus',                      'Exo',   'OT',            20),
    'Lev':     ('LEV',  'Leviticus',                   'Lev',   'OT',            30),
    'Num':     ('NUM',  'Numbers',                     'Num',   'OT',            40),
    'Deut':    ('DEU',  'Deuteronomy',                 'Deu',   'OT',            50),
    'JoshB':   ('JOS',  'Joshua',                      'Jos',   'OT',            60),
    'JoshA':   ('JOSA', 'Joshua (LXX-A)',              'JosA',  'Apocrypha',    61),
    'JudgB':   ('JDG',  'Judges',                      'Jdg',   'OT',            70),
    'JudgA':   ('JDGA', 'Judges (LXX-A)',             'JdgA',  'Apocrypha',    71),
    'Ruth':    ('RUT',  'Ruth',                        'Rut',   'OT',            80),
    '1Sam/K':  ('1SA',  '1 Samuel',                    '1Sa',   'OT',            90),
    '2Sam/K':  ('2SA',  '2 Samuel',                    '2Sa',   'OT',           100),
    '1/3Kgs':  ('1KI',  '1 Kings',                     '1Ki',   'OT',           110),
    '2/4Kgs':  ('2KI',  '2 Kings',                     '2Ki',   'OT',           120),
    '1Chr':    ('1CH',  '1 Chronicles',                '1Ch',   'OT',           130),
    '2Chr':    ('2CH',  '2 Chronicles',                '2Ch',   'OT',           140),
    '1Esdr':   ('1ES',  '1 Esdras',                    '1Es',   'Apocrypha',   150),
    '2Esdr':   ('2ES',  '2 Esdras (Ezra-Nehemiah)',   '2Es',   'OT',           155),
    'Esth':    ('ESG',  'Esther (Greek)',               'EsG',   'Apocrypha',   160),
    'Jdt':     ('JDT',  'Judith',                      'Jdt',   'Apocrypha',   170),
    'TobBA':   ('TOB',  'Tobit (GII)',                 'Tob',   'Apocrypha',   180),
    'TobS':    ('TOBS', 'Tobit (GI)',                  'TobS',  'Apocrypha',   181),
    '1Mac':    ('1MA',  '1 Maccabees',                 '1Ma',   'Apocrypha',   190),
    '2Mac':    ('2MA',  '2 Maccabees',                 '2Ma',   'Apocrypha',   200),
    '3Mac':    ('3MA',  '3 Maccabees',                 '3Ma',   'Apocrypha',   210),
    '4Mac':    ('4MA',  '4 Maccabees',                 '4Ma',   'Apocrypha',   220),
    'Ps':      ('PSA',  'Psalms',                      'Psa',   'OT',           230),
    'Od':      ('ODE',  'Odes',                        'Ode',   'Apocrypha',   235),
    'Prov':    ('PRO',  'Proverbs',                    'Pro',   'OT',           240),
    'Qoh':     ('ECC',  'Ecclesiastes',                'Ecc',   'OT',           250),
    'Cant':    ('SNG',  'Song of Songs',               'Song',  'OT',           260),
    'Job':     ('JOB',  'Job',                         'Job',   'OT',           270),
    'Wis':     ('WIS',  'Wisdom of Solomon',           'Wis',   'Apocrypha',   280),
    'Sir':     ('SIR',  'Sirach',                      'Sir',   'Apocrypha',   290),
    'PsSol':   ('PSL',  'Psalms of Solomon',           'PsSol', 'Apocrypha',   295),
    'Hos':     ('HOS',  'Hosea',                       'Hos',   'OT',           300),
    'Mic':     ('MIC',  'Micah',                       'Mic',   'OT',           310),
    'Amos':    ('AMO',  'Amos',                        'Amo',   'OT',           320),
    'Joel':    ('JOL',  'Joel',                        'Joel',  'OT',           330),
    'Jonah':   ('JON',  'Jonah',                       'Jon',   'OT',           340),
    'Obad':    ('OBA',  'Obadiah',                     'Oba',   'OT',           350),
    'Nah':     ('NAM',  'Nahum',                       'Nah',   'OT',           360),
    'Hab':     ('HAB',  'Habakkuk',                    'Hab',   'OT',           370),
    'Zeph':    ('ZEP',  'Zephaniah',                   'Zep',   'OT',           380),
    'Hag':     ('HAG',  'Haggai',                      'Hag',   'OT',           390),
    'Zech':    ('ZEC',  'Zechariah',                   'Zec',   'OT',           400),
    'Mal':     ('MAL',  'Malachi',                     'Mal',   'OT',           410),
    'Isa':     ('ISA',  'Isaiah',                      'Isa',   'OT',           420),
    'Jer':     ('JER',  'Jeremiah',                    'Jer',   'OT',           430),
    'Bar':     ('BAR',  'Baruch',                      'Bar',   'Apocrypha',   440),
    'EpJer':   ('EJR',  'Epistle of Jeremiah',         'EpJer', 'Apocrypha',   445),
    'Lam':     ('LAM',  'Lamentations',                'Lam',   'OT',           450),
    'Ezek':    ('EZK',  'Ezekiel',                     'Ezek',  'OT',           460),
    'Bel':     ('BEL',  'Bel and the Dragon (LXX)',   'Bel',   'Apocrypha',   470),
    'BelTh':   ('BELT', 'Bel and the Dragon (Th)',    'BelTh', 'Apocrypha',   471),
    'Dan':     ('DAN',  'Daniel (LXX)',                'DanL',  'OT',           480),
    'DanTh':   ('DANT', 'Daniel (Theodotion)',         'DanTh', 'OT',           481),
    'Sus':     ('SUS',  'Susanna (LXX)',               'SusL',  'Apocrypha',   490),
    'SusTh':   ('SUST', 'Susanna (Theodotion)',       'SusTh', 'Apocrypha',   491),
}

def parse_verse_ref(ref_str):
    """Parse 「Book ch:v」 → (lxx_abbr, chapter, verse_num), or None to skip.
    Handles:
      - Letter suffixes on verse/chapter: '19:45b' → v=45, '10:3l' → v=3
      - Verse ranges with '-': '9:3-4' → v=3 (take first)
      - Verse ranges with '/': '7:27/28' → v=27 (take first)
      - Chapter-only single-chapter books: 'Obad 21' → ch=1, v=21
      - Prologue chapter: 'Sir Prolog:1' → ch=0, v=1
      - Empty cv (section headers like '「Od 」'): return None (skip)
    """
    ref_str = ref_str.strip('「」').strip()
    parts = ref_str.rsplit(' ', 1)
    if len(parts) != 2 or not parts[1].strip():
        return None  # bare book name (section header) — skip
    book_abbr, cv = parts[0], parts[1].strip()

    # Handle verse range with '-' or '/' — take the first element
    cv = cv.replace('/', '-')
    if '-' in cv and cv.count(':') <= 1:
        cv = cv.split('-')[0]

    if ':' in cv:
        ch_str, v_str = cv.split(':', 1)
        # Prolog chapter → 0
        if re.fullmatch(r'[Pp]rolog', ch_str.strip()):
            ch_str = '0'
        # Strip non-digit suffix chars
        ch_str = re.sub(r'[^0-9]', '', ch_str)
        v_str  = re.sub(r'[^0-9]', '', v_str)
        if not ch_str or not v_str:
            return None
        try:
            return (book_abbr, int(ch_str), int(v_str))
        except ValueError:
            return None
    else:
        # Single-chapter books (Obad, EpJer) or bare verse number
        cv_clean = re.sub(r'[^0-9]', '', cv)
        if not cv_clean:
            return None
        try:
            return (book_abbr, 1, int(cv_clean))
        except ValueError:
            return None

# ---------------------------------------------------------------------------
# Step 1: Load words and Strong's numbers into arrays (1-indexed → 0-indexed lists)
# ---------------------------------------------------------------------------
print('Loading words...')
# text_accented.csv format: row_num TAB second_col TAB word  (3 columns)
words = {}  # token_idx (1-based) → word string
with open(WORDS_CSV, encoding='utf-8') as f:
    for line in f:
        line = line.rstrip('\n\r')
        parts = line.split('\t')
        if len(parts) >= 3:
            words[int(parts[0])] = parts[2]
        elif len(parts) == 2:
            words[int(parts[0])] = parts[1]

print(f'  {len(words):,} word tokens loaded')

print('Loading Strong\'s numbers...')
strongs = {}  # token_idx (1-based) → strongs string ('' if missing)
with open(STRONGS_CSV, encoding='utf-8') as f:
    for line in f:
        line = line.rstrip('\n')
        if '\t' in line:
            idx_s, sn = line.split('\t', 1)
            strongs[int(idx_s)] = sn.strip()
        else:
            # Line has only the index, no Strong's number
            try:
                strongs[int(line.strip())] = ''
            except ValueError:
                pass

print(f'  {len(strongs):,} Strong\'s entries loaded (empty = no number)')

# ---------------------------------------------------------------------------
# Step 2: Parse E-verse.csv into an ordered list of (col1_start, book, ch, v)
# Use col1 = index into words/strongs (1-based)
# ---------------------------------------------------------------------------
print('Loading verse structure...')
# raw_list: all rows including skipped ones — (col1, parsed_or_None)
raw_list = []
skipped_refs = set()
with open(EVERSES_CSV, encoding='utf-8') as f:
    for line in f:
        line = line.rstrip('\n')
        parts = line.split('\t')
        if len(parts) < 3:
            continue
        try:
            col1 = int(parts[0])
        except ValueError:
            continue
        parsed = parse_verse_ref(parts[2])
        if parsed is None:
            raw_ref = parts[2].strip('「」').strip()
            if raw_ref not in skipped_refs:
                skipped_refs.add(raw_ref)
                print(f'  SKIP (section header or unrecognized): {parts[2]!r}')
        elif parsed[0] not in BOOK_META:
            print(f'  WARNING: Unknown book abbreviation: {parsed[0]!r}')
            parsed = None
        raw_list.append((col1, parsed))

# Build final verse_list: each entry has a definite start token.
# Section headers (parsed=None) mark a gap; their col1 becomes the start of the
# NEXT real verse (overwriting whatever was there), so the tokens are not lost.
# We do this by looking ahead: if an entry is None, we skip it and let the
# following real verse absorb those tokens (since its col1_start is > the None row,
# the tokens between the None row and the next verse row are naturally included in
# the preceding real verse's range... unless the None is at the START of a sequence).
#
# Simpler approach: collect only real verses. When computing the end token for
# verse[i], use the col1 of the NEXT raw row (real or not), not the next real verse.
# This is automatic because end_token = raw_list[i+1][0] - 1 regardless of whether
# row i+1 is real.  We just need to make sure gaps are bridged correctly.
#
# Actually the simplest correct approach: merge consecutive raw rows where the real
# verse starts at the next non-None. Build a list where each entry carries the
# START token that we'll use to collect words.

# Build verse_list with correct token ranges:
# For each real verse at position j in raw_list, its START is raw_list[j][0]
# and its END is raw_list[j+1][0] - 1 (whether j+1 is real or not), which means
# any header tokens before j+1's real verse are included in verse j's word collection.
# That's actually wrong too — if the header comes AFTER verse j's start, the header
# tokens would be appended TO verse j. Let me check the actual structure.
#
# In practice the headers appear at the START of a book section, before any real
# verses. The structure is:
#   (start_of_book_section, None)     ← skip
#   (start_of_v1, real_verse)          ← use this col1 as verse start
# So header tokens (from header col1 to first_real_verse col1 - 1) get absorbed
# into the preceding verse or are pre-book whitespace. That's fine.
#
# The simple solution that works: just filter Nones and use the col1 of each
# real row as the verse START, and next real row's col1 as exclusive end.
verse_list = [(col1, parsed) for (col1, parsed) in raw_list if parsed is not None]

print(f'  {len(verse_list):,} verse boundaries loaded (from {len(raw_list):,} raw rows)')

# Total tokens (max col1 in the word list)
total_tokens = max(words.keys())
print(f'  Total word tokens: {total_tokens:,}')

# ---------------------------------------------------------------------------
# Step 3: For each verse, collect tokens and build text + text_tagged
# verse_list[i] = (col1_start, (book_abbr, chapter, verse_num))
# End of verse i = verse_list[i+1][0] - 1; last verse ends at total_tokens.
# ---------------------------------------------------------------------------
print('Building verses...')

def build_verse(start_token, end_token, words, strongs):
    """Return (plain_text, tagged_text) for tokens start..end inclusive."""
    text_parts = []
    tagged_parts = []
    for idx in range(start_token, end_token + 1):
        w = words.get(idx, '')
        if not w:
            continue
        s = strongs.get(idx, '')
        text_parts.append(w)
        if s:
            tagged_parts.append(f'{w}{{{s}}}')
        else:
            tagged_parts.append(f'{w}{{}}')
    return ' '.join(text_parts), ' '.join(tagged_parts)

# Build all verses
all_verses = []  # list of (book_abbr, chapter, verse_num, text, text_tagged)
n = len(verse_list)
for i, (col1_start, parsed) in enumerate(verse_list):
    book_abbr, chapter, verse_num = parsed
    if i + 1 < n:
        end_token = verse_list[i + 1][0] - 1
    else:
        end_token = total_tokens
    text, tagged = build_verse(col1_start, end_token, words, strongs)
    all_verses.append((book_abbr, chapter, verse_num, text, tagged))

print(f'  Built {len(all_verses):,} verses')

# ---------------------------------------------------------------------------
# Step 4: Compute chapter counts per book (exclude prologue chapter 0)
# ---------------------------------------------------------------------------
chapter_counts = {}  # book_abbr → max non-zero chapter
for (ba, ch, v, _, _) in all_verses:
    if ch == 0:
        continue  # prologue
    prev = chapter_counts.get(ba, 0)
    if ch > prev:
        chapter_counts[ba] = ch

# ---------------------------------------------------------------------------
# Step 5: Write to SQLite
# ---------------------------------------------------------------------------
print(f'Writing to {DB_PATH} ...')
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

db = sqlite3.connect(DB_PATH)
db.execute('PRAGMA journal_mode=WAL')
db.execute('PRAGMA synchronous=NORMAL')

db.executescript("""
CREATE TABLE books (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    short_name      TEXT NOT NULL,
    testament       TEXT NOT NULL DEFAULT 'OT',
    chapters_count  INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE verses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     TEXT NOT NULL,
    chapter     INTEGER NOT NULL,
    verse_num   INTEGER NOT NULL,
    text        TEXT NOT NULL,
    text_tagged TEXT
);

CREATE INDEX idx_verses_ref ON verses (book_id, chapter, verse_num);
""")

# Insert books (only those that appear in the data)
books_used = {ba for (ba, _, _, _, _) in all_verses}
book_rows = []
for lxx_abbr, (book_id, name, short_name, testament, sort) in sorted(BOOK_META.items(), key=lambda x: x[1][4]):
    if lxx_abbr in books_used:
        chap_count = chapter_counts.get(lxx_abbr, 0)
        book_rows.append((book_id, name, short_name, testament, chap_count, sort))

db.executemany('INSERT INTO books VALUES (?,?,?,?,?,?)', book_rows)
print(f'  Inserted {len(book_rows)} books')

# Build book_id lookup
lxx_to_berean = {lxx_abbr: meta[0] for lxx_abbr, meta in BOOK_META.items()}

# Insert verses in batches
verse_rows = []
for (ba, ch, v, text, tagged) in all_verses:
    book_id = lxx_to_berean.get(ba)
    if not book_id:
        continue
    if not text.strip():
        continue  # Skip empty verses
    verse_rows.append((book_id, ch, v, text, tagged))

BATCH = 10000
for i in range(0, len(verse_rows), BATCH):
    db.executemany('INSERT INTO verses (book_id, chapter, verse_num, text, text_tagged) VALUES (?,?,?,?,?)', verse_rows[i:i+BATCH])
    if i % 100000 == 0:
        print(f'  {i:,} / {len(verse_rows):,} verses...')

print(f'  Inserted {len(verse_rows):,} verse rows')

# FTS5 index for keyword search
print('Building FTS5 index...')
db.execute("""
    CREATE VIRTUAL TABLE verses_fts USING fts5(
        text,
        book_id UNINDEXED,
        chapter UNINDEXED,
        verse_num UNINDEXED,
        content='verses',
        content_rowid='id'
    )
""")
db.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")

db.commit()
db.close()

print()
print('Done!')
print(f'  Database: {DB_PATH}')
print(f'  Books: {len(book_rows)}')
print(f'  Verses: {len(verse_rows):,}')
print()
print('Next steps:')
print('  1. Register lxx_greek in electron/db/bible.ts')
print('  2. npm run dev — verify Gen 1:1 shows ἐν{{G1722}} ἀρχῇ{{G746}} ...')
print('  3. Verify Psalm 151 exists')
