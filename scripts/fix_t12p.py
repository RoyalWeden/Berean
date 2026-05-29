"""
Fix T12P structure: each testament currently has chapter=1 with verse_num used
as the chapter number. Restructure so verse_num becomes chapter and all verses
get verse_num=1 (one "verse" per chapter containing the full chapter text).
"""
import sqlite3, os, shutil

DB     = '/Users/roywe/Berean/data/t12p.db'
BACKUP = DB + '.bak'

# Step 1: read all data directly from backup
conn = sqlite3.connect(BACKUP)
rows = conn.execute("SELECT book_id, verse_num, text FROM verses ORDER BY book_id, verse_num").fetchall()
books = conn.execute("SELECT id, name, short_name, testament FROM books ORDER BY rowid").fetchall()
conn.close()
print(f"Read {len(rows)} verse rows, {len(books)} books")

# Step 2: delete file and recreate from scratch
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

# Step 3: insert verses with restructured chapter/verse
for book_id, old_verse_num, text in rows:
    conn.execute(
        "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, 1, ?)",
        (book_id, old_verse_num, text)
    )

# Step 4: insert books with correct chapters_count
for book_id, name, short_name, testament in books:
    chapters_count = max(
        (v for b, v, t in rows if b == book_id),
        default=1
    )
    conn.execute(
        "INSERT INTO books VALUES (?, ?, ?, ?, ?)",
        (book_id, name, short_name, testament, chapters_count)
    )

conn.commit()

# Verify
print("Result:")
for row in conn.execute("SELECT id, chapters_count FROM books ORDER BY rowid").fetchall():
    print(f"  {row[0]}: {row[1]} chapters")

conn.close()
print("T12P restructured successfully")
