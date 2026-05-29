"""
Restructure Recognitions of Clement from 1 book (RCL) with 10 chapters into
10 separate books (RCL1–RCL10), where:
  current (RCL, chapter=N, verse_num=V)  →  (RCLN, chapter=V, verse_num=1)
"""
import sqlite3, os, shutil

DB     = '/Users/roywe/Berean/data/recog_clement.db'
BACKUP = DB + '.bak'

BOOK_NAMES = {
    1:  ('Book I',    'Book I'),
    2:  ('Book II',   'Book II'),
    3:  ('Book III',  'Book III'),
    4:  ('Book IV',   'Book IV'),
    5:  ('Book V',    'Book V'),
    6:  ('Book VI',   'Book VI'),
    7:  ('Book VII',  'Book VII'),
    8:  ('Book VIII', 'Book VIII'),
    9:  ('Book IX',   'Book IX'),
    10: ('Book X',    'Book X'),
}

conn = sqlite3.connect(BACKUP)
all_rows = conn.execute(
    "SELECT chapter, verse_num, text FROM verses WHERE book_id='RCL' ORDER BY chapter, verse_num"
).fetchall()
conn.close()
print(f"Read {len(all_rows)} verse rows")

if os.path.exists(DB): os.remove(DB)
for ext in ('-shm', '-wal'):
    if os.path.exists(DB + ext): os.remove(DB + ext)
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

for book_num in range(1, 11):
    book_id      = f'RCL{book_num}'
    name, short  = BOOK_NAMES[book_num]
    book_rows    = [(v, t) for (ch, v, t) in all_rows if ch == book_num]
    ch_count     = max((v for v, _ in book_rows), default=0)

    conn.execute(
        "INSERT INTO books VALUES (?, ?, ?, 'Pseudepigrapha', ?)",
        (book_id, name, short, ch_count)
    )
    for verse_num, text in book_rows:
        conn.execute(
            "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, 1, ?)",
            (book_id, verse_num, text)
        )
    print(f"  {book_id} ({name}): {ch_count} chapters, {len(book_rows)} verses")

conn.commit()
conn.close()
print("Recognitions of Clement restructured successfully")
