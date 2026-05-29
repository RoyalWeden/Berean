"""
Seed Apocalypse of Elijah from /tmp/apoc_elijah_raw.txt
Parses chapters and inline verse numbers from the source text.
Preserves apoc_elijah.db.bak — only deletes .db, .db-shm, .db-wal.
"""
import sqlite3
import os
import re

SRC = '/tmp/apoc_elijah_raw.txt'
DB  = '/Users/roywe/Berean/data/apoc_elijah.db'

BOOK_ID    = 'AEL'
BOOK_NAME  = 'Apocalypse of Elijah'
SHORT_NAME = 'Apoc. Elijah'
TESTAMENT  = 'Pseudepigrapha'

# ---------------------------------------------------------------------------
# 1. Delete old DB files (NOT the .bak)
# ---------------------------------------------------------------------------
for path in (DB, DB + '-shm', DB + '-wal'):
    if os.path.exists(path):
        os.remove(path)
        print(f'Deleted: {path}')

# ---------------------------------------------------------------------------
# 2. Read source — skip intro lines before "CHAPTER 1"
# ---------------------------------------------------------------------------
with open(SRC, encoding='utf-8') as f:
    raw = f.read()

# Find where CHAPTER 1 starts; discard everything before it
match = re.search(r'\bCHAPTER\s+1\b', raw)
if not match:
    raise ValueError('Could not find CHAPTER 1 in source file')
raw = raw[match.start():]

# ---------------------------------------------------------------------------
# 3. Split into chapters
# ---------------------------------------------------------------------------
chapter_pattern = re.compile(r'\bCHAPTER\s+(\d+)\b')
chapter_splits  = list(chapter_pattern.finditer(raw))

chapters_data = {}
for idx, m in enumerate(chapter_splits):
    ch_num = int(m.group(1))
    start  = m.end()
    end    = chapter_splits[idx + 1].start() if idx + 1 < len(chapter_splits) else len(raw)
    chapters_data[ch_num] = raw[start:end].strip()

print(f'Found {len(chapters_data)} chapters: {sorted(chapters_data.keys())}')

# ---------------------------------------------------------------------------
# 4. Parse verses within each chapter
#
# Verse numbers are 1-2 digit integers that appear:
#   (a) alone on a line followed by a blank line then the verse text, OR
#   (b) inline at the start of a verse run like "27 Next verse text"
#
# Strategy:
#   - Collapse the chapter text into a single string (preserve spacing)
#   - Use a regex to find verse number boundaries:
#       (?<!\d)(\d{1,2})\s+(?=[A-Z"\[\(])
#   - The text between consecutive markers is the verse body.
# ---------------------------------------------------------------------------

verse_boundary = re.compile(r'(?<!\d)(\d{1,2})\s+(?=[A-Z“‘”’"\[\(])')


def parse_chapter(text: str) -> list[tuple[int, str]]:
    """Return list of (verse_num, verse_text) for a chapter block."""
    # Normalise whitespace: collapse newlines/spaces into single spaces
    cleaned = ' '.join(text.split())

    matches = list(verse_boundary.finditer(cleaned))
    if not matches:
        return []

    # Verify first match is verse 1
    first_num = int(matches[0].group(1))
    if first_num != 1:
        # Try to prepend "1 " if the text starts right away (verse 1 number
        # was consumed by the CHAPTER line itself in some chapters)
        matches_all = list(re.finditer(r'(?<!\d)(\d{1,2})\s+(?=[A-Z"\[\(])', '1 ' + cleaned))
        cleaned = '1 ' + cleaned
        matches = matches_all

    verses = []
    for i, m in enumerate(matches):
        v_num = int(m.group(1))
        text_start = m.end()
        text_end   = matches[i + 1].start() if i + 1 < len(matches) else len(cleaned)
        verse_text = cleaned[text_start:text_end].strip()
        # Remove trailing verse number that got absorbed (e.g. trailing "27")
        verse_text = re.sub(r'\s+\d{1,2}\s*$', '', verse_text).strip()
        if verse_text:
            verses.append((v_num, verse_text))

    return verses


# ---------------------------------------------------------------------------
# 5. Create DB and insert
# ---------------------------------------------------------------------------
conn = sqlite3.connect(DB)
conn.executescript("""
    CREATE TABLE books (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        short_name     TEXT NOT NULL,
        testament      TEXT NOT NULL,
        chapters_count INTEGER NOT NULL
    );
    CREATE TABLE verses (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id   TEXT NOT NULL,
        chapter   INTEGER NOT NULL,
        verse_num INTEGER NOT NULL,
        text      TEXT NOT NULL,
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
""")

total_verses = 0
chapter_verse_counts = {}

for ch_num in sorted(chapters_data.keys()):
    verses = parse_chapter(chapters_data[ch_num])
    chapter_verse_counts[ch_num] = len(verses)
    for v_num, text in verses:
        conn.execute(
            "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
            (BOOK_ID, ch_num, v_num, text)
        )
        total_verses += 1
    print(f'  Chapter {ch_num}: {len(verses)} verses')

conn.execute(
    "INSERT INTO books VALUES (?, ?, ?, ?, ?)",
    (BOOK_ID, BOOK_NAME, SHORT_NAME, TESTAMENT, len(chapters_data))
)
conn.commit()

# ---------------------------------------------------------------------------
# 6. Print sample verses for verification
# ---------------------------------------------------------------------------
print(f'\nTotal: {total_verses} verses across {len(chapters_data)} chapters')
print('\nSample verses:')
for row in conn.execute(
    "SELECT chapter, verse_num, substr(text,1,80) FROM verses ORDER BY chapter, verse_num LIMIT 6"
):
    print(f'  {BOOK_ID} {row[0]}:{row[1]}  {row[2]}...')

conn.close()
print('\nApocalypse of Elijah seeded successfully.')
