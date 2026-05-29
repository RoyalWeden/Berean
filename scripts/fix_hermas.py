"""
Restructure Shepherd of Hermas into 3 books:
  HER_VIS  Visions     — original chapters  1-24
  HER_MAN  Mandates    — original chapters 25-47  (renumbered 1-23)
  HER_SIM  Similitudes — original chapters 48-100 (renumbered 1-53)
"""
import sqlite3, os, shutil

DB     = '/Users/roywe/Berean/data/hermas.db'
BACKUP = DB + '.bak'

SECTIONS = [
    ('HER_VIS', 'Visions',      'Vis.',  1,  24),
    ('HER_MAN', 'Mandates',     'Mand.', 25, 47),
    ('HER_SIM', 'Similitudes',  'Sim.',  48, 100),
]

# Read all data directly from backup
conn = sqlite3.connect(BACKUP)
all_rows = conn.execute(
    "SELECT chapter, verse_num, text FROM verses WHERE book_id='HER' ORDER BY chapter, verse_num"
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

for book_id, name, short_name, ch_start, ch_end in SECTIONS:
    section_rows = [(ch, v, t) for ch, v, t in all_rows if ch_start <= ch <= ch_end]
    new_chapters = ch_end - ch_start + 1

    conn.execute(
        "INSERT INTO books VALUES (?, ?, ?, 'Pseudepigrapha', ?)",
        (book_id, name, short_name, new_chapters)
    )
    for orig_ch, verse_num, text in section_rows:
        new_ch = orig_ch - ch_start + 1
        conn.execute(
            "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
            (book_id, new_ch, verse_num, text)
        )
    print(f"  {book_id} ({name}): {new_chapters} chapters, {len(section_rows)} verses")

conn.commit()
conn.close()
print("Hermas restructured successfully")
