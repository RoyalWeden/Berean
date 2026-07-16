"""
Seed the Didache (Charles H. Hoole translation, 1894 -- public domain)
from the earlychristianwritings.com HTML source.

Source HTML uses plain paragraphs of the form:
    <h3>CHAPTER {n}</h3>
    <p>{chapter}:{verse} {verse text...}</p>

Usage:
    1. curl -sL -A "Mozilla/5.0" \
         "https://www.earlychristianwritings.com/text/didache-hoole.html" \
         -o /tmp/didache_hoole_raw.html
    2. python3 scripts/seed_didache_hoole.py
"""
import sqlite3
import os
import re
import html as htmllib

SRC = '/tmp/didache_hoole_raw.html'
DB  = '/Users/roywe/Berean/data/didache_hoole.db'

BOOK_ID    = 'DID'
BOOK_NAME  = 'Didache'
SHORT_NAME = 'Didache'
# App-wide testament buckets are only 'OT' | 'NT' | 'Apocrypha' | 'Pseudepigrapha'
# (see ScriptureSearchView.tsx / Sidebar.tsx filters) — 'Pseudepigrapha' is the
# established catch-all for extra-biblical texts like Hermas and 1 Clement.
TESTAMENT  = 'Pseudepigrapha'

# ---------------------------------------------------------------------------
# 1. Read source. Page declares iso-8859-1 but the verse text itself is plain
#    ASCII -- read as UTF-8 with a permissive fallback either way.
# ---------------------------------------------------------------------------
with open(SRC, encoding='utf-8', errors='replace') as f:
    raw = f.read()

# ---------------------------------------------------------------------------
# 2. Parse verses from <p>{chapter}:{verse} text</p> paragraphs.
# ---------------------------------------------------------------------------
pattern = re.compile(r'<p>\s*(\d+):(\d+)\s+(.*?)</p>', re.IGNORECASE | re.DOTALL)

def clean(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text)        # strip any stray tags
    text = htmllib.unescape(text)               # decode &amp; etc.
    text = text.replace('\xa0', ' ')            # nbsp
    text = re.sub(r'\s+', ' ', text).strip()
    return text

rows = []  # (chapter, verse, text)
seen = set()
for m in pattern.finditer(raw):
    chapter = int(m.group(1))
    verse = int(m.group(2))
    text = clean(m.group(3))
    if text and (chapter, verse) not in seen:
        seen.add((chapter, verse))
        rows.append((chapter, verse, text))

if not rows:
    raise SystemExit('No verses parsed -- source format may have changed.')

chapters = sorted({c for c, _, _ in rows})
chapters_count = max(chapters)
print(f'Parsed {len(rows)} verses across {len(chapters)} chapters (max chapter {chapters_count})')

# ---------------------------------------------------------------------------
# 3. Recreate the DB (delete old .db / -shm / -wal -- never a .bak)
# ---------------------------------------------------------------------------
for path in (DB, DB + '-shm', DB + '-wal'):
    if os.path.exists(path):
        os.remove(path)

conn = sqlite3.connect(DB)
cur = conn.cursor()
cur.executescript("""
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

cur.execute(
    'INSERT INTO books (id, name, short_name, testament, chapters_count) VALUES (?,?,?,?,?)',
    (BOOK_ID, BOOK_NAME, SHORT_NAME, TESTAMENT, chapters_count),
)
cur.executemany(
    'INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?,?,?,?)',
    [(BOOK_ID, c, v, t) for c, v, t in rows],
)
conn.commit()

# Keep DELETE journal mode so the read-only bundle never needs a -shm/-wal file (MAS).
cur.execute('PRAGMA journal_mode=DELETE')
conn.commit()
conn.close()
print(f'Wrote {DB}')
