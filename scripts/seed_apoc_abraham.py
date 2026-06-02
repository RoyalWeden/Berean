"""
Seed the Apocalypse of Abraham (G.H. Box translation, 1918 — public domain)
from the pseudepigrapha.com HTML source.

Source HTML uses anchors of the form:
    <A Name="T1_C{chapter}_V{verse}">{verse}. </A>{verse text...}</TD>

Usage:
    1. curl -sL "https://www.pseudepigrapha.com/pseudepigrapha/Apocalypse_of_Abraham.html" \
         -o /tmp/apoc_abraham_raw.html
    2. python3 scripts/seed_apoc_abraham.py
"""
import sqlite3
import os
import re
import html as htmllib

SRC = '/tmp/apoc_abraham_raw.html'
DB  = '/Users/roywe/Berean/data/apoc_abraham.db'

BOOK_ID    = 'ABR'
BOOK_NAME  = 'Apocalypse of Abraham'
SHORT_NAME = 'Apoc. Abraham'
TESTAMENT  = 'Pseudepigrapha'

# ---------------------------------------------------------------------------
# 1. Read source (UTF-8). The source already contains U+FFFD where curly
#    apostrophes were lost server-side; restore them as a straight apostrophe.
# ---------------------------------------------------------------------------
with open(SRC, encoding='utf-8', errors='replace') as f:
    raw = f.read()
raw = raw.replace('�', "'")

# ---------------------------------------------------------------------------
# 2. Parse verses via the T1_C{c}_V{v} anchors.
#    Capture everything from just after the anchor's closing tags up to the
#    next </TD>, then strip remaining HTML tags.
# ---------------------------------------------------------------------------
# Match: Name="T1_C<chap>_V<verse>"> <verse>. </A> ... text ... </TD>
pattern = re.compile(
    r'Name="T1_C(\d+)_V(\d+)"\s*>\s*\d+\.\s*</A>\s*</B>\s*</FONT>(.*?)</TD>',
    re.IGNORECASE | re.DOTALL,
)

def clean(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text)        # strip tags
    text = htmllib.unescape(text)               # decode &amp; etc.
    text = text.replace('\xa0', ' ')            # nbsp
    text = re.sub(r'\s+', ' ', text).strip()
    return text

# The source mislabels the final chapter: chapter 31's anchors restart (V8 → V1)
# for what is really chapter 32. Detect the verse-number restart within a repeated
# chapter and bump everything after it to the next chapter.
rows = []  # (chapter, verse, text)
seen = set()
bump = 0
prev_rc = None
prev_v = None
for m in pattern.finditer(raw):
    rc = int(m.group(1))
    v = int(m.group(2))
    # Restart detected: same raw chapter as before but verse number went backwards
    if prev_rc == rc and v <= (prev_v or 0):
        bump += 1
    out_chapter = rc + bump
    prev_rc, prev_v = rc, v
    text = clean(m.group(3))
    if text and (out_chapter, v) not in seen:
        seen.add((out_chapter, v))
        rows.append((out_chapter, v, text))

if not rows:
    raise SystemExit('No verses parsed — source format may have changed.')

chapters = sorted({c for c, _, _ in rows})
chapters_count = max(chapters)
print(f'Parsed {len(rows)} verses across {len(chapters)} chapters (max chapter {chapters_count})')

# ---------------------------------------------------------------------------
# 3. Recreate the DB (delete old .db / -shm / -wal — never a .bak)
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
