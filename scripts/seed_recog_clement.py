"""
Seed Recognitions of Clement from /tmp/recog_clement_raw.txt
Parses Books 1-10 (Book 9 uses Roman numeral "Book IX." in source).
Each chapter becomes one verse (verse_num=1).
Preserves recog_clement.db.bak — only deletes .db, .db-shm, .db-wal.
"""
import sqlite3
import os
import re

SRC = '/tmp/recog_clement_raw.txt'
DB  = '/Users/roywe/Berean/data/recog_clement.db'

TESTAMENT = 'Pseudepigrapha'

BOOK_META = {
    1:  ('RCL1',  'Recognitions of Clement — Book I',    'Rec. Clem. I'),
    2:  ('RCL2',  'Recognitions of Clement — Book II',   'Rec. Clem. II'),
    3:  ('RCL3',  'Recognitions of Clement — Book III',  'Rec. Clem. III'),
    4:  ('RCL4',  'Recognitions of Clement — Book IV',   'Rec. Clem. IV'),
    5:  ('RCL5',  'Recognitions of Clement — Book V',    'Rec. Clem. V'),
    6:  ('RCL6',  'Recognitions of Clement — Book VI',   'Rec. Clem. VI'),
    7:  ('RCL7',  'Recognitions of Clement — Book VII',  'Rec. Clem. VII'),
    8:  ('RCL8',  'Recognitions of Clement — Book VIII', 'Rec. Clem. VIII'),
    9:  ('RCL9',  'Recognitions of Clement — Book IX',   'Rec. Clem. IX'),
    10: ('RCL10', 'Recognitions of Clement — Book X',    'Rec. Clem. X'),
}

# ---------------------------------------------------------------------------
# 1. Delete old DB files (NOT the .bak)
# ---------------------------------------------------------------------------
for path in (DB, DB + '-shm', DB + '-wal'):
    if os.path.exists(path):
        os.remove(path)
        print(f'Deleted: {path}')

# ---------------------------------------------------------------------------
# 2. Read source
# ---------------------------------------------------------------------------
with open(SRC, encoding='utf-8') as f:
    raw = f.read()

# ---------------------------------------------------------------------------
# 3. Locate all book boundaries
#
# Books 1-8, 10 use Arabic:  "\x0cBook N.\n"
# Book 9 uniquely uses Roman: "\x0cBook IX.\n"
#
# We build a sorted list of (char_position, book_number) for all 10 books.
# ---------------------------------------------------------------------------

book_positions = []  # list of (start_of_content_after_header, book_num)

# Arabic-numeral books (1-8, 10)
arabic_pat = re.compile(r'[\x0c\n]Book\s+(\d+)\.\s*\n')
for m in arabic_pat.finditer(raw):
    book_positions.append((m.end(), int(m.group(1))))

# Roman-numeral Book IX
roman_pat = re.compile(r'[\x0c\n]Book\s+IX\.\s*\n', re.IGNORECASE)
for m in roman_pat.finditer(raw):
    book_positions.append((m.end(), 9))

# Sort by position so we can determine end boundaries
book_positions.sort(key=lambda x: x[0])

found_books = [bn for _, bn in book_positions]
print(f'Found Books: {sorted(found_books)}')

# Build per-book text blocks
book_blocks = {}
for idx, (start, book_num) in enumerate(book_positions):
    if idx + 1 < len(book_positions):
        # End at the start of the next book marker.
        # The marker itself begins one char before the stored "content start",
        # so we use the next start minus the length of the next header.
        next_start = book_positions[idx + 1][0]
        # Find the actual Book marker line preceding next_start
        # (safer: just end at next_start — header is before this anyway)
        end = next_start - 1  # exclude \n that starts next book header
    else:
        end = len(raw)
    book_blocks[book_num] = raw[start:end]

# ---------------------------------------------------------------------------
# 4. Parse chapters from each book block
# ---------------------------------------------------------------------------

chapter_marker = re.compile(r'-*Chapter\s+(\d+)\.\s+[^\n]*', re.IGNORECASE)

# Standalone page-number lines (form-feed + digits)
page_num_line = re.compile(r'\x0c?\s*\d{1,4}\s*\n')

# Footnote reference blocks: lone small integer then footnote text
footnote_block = re.compile(
    r'\n\s*\d{1,2}\s*\n\s*\nOriginal[^\n]+(?:\n[^\n]+)*',
    re.IGNORECASE
)


TARGET_VERSE_LEN = 400   # aim for ~400 chars per verse chunk
MIN_VERSE_LEN    = 150   # don't emit a verse shorter than this unless it's the last one

# Sentence boundary: period/!/? followed by space + capital letter (or end)
_SENT_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z"\'(])')
# Also split at semicolons when they start long subordinate clauses
_SEMI_SPLIT  = re.compile(r'(?<=;)\s+')


def split_into_sentences(text: str) -> list[str]:
    """Split text into sentence units using punctuation heuristics."""
    sents = _SENT_SPLIT.split(text)
    # Further split on semicolons if sentences are still very long
    result = []
    for s in sents:
        if len(s) > TARGET_VERSE_LEN * 1.5:
            parts = _SEMI_SPLIT.split(s)
            result.extend(parts)
        else:
            result.append(s)
    return [s.strip() for s in result if s.strip()]


def chunk_into_verses(text: str) -> list[str]:
    """
    Split a long text into verse-sized chunks at sentence boundaries.
    Each chunk targets ~TARGET_VERSE_LEN chars. If the text already has
    natural paragraph breaks (\n\n), each paragraph is chunked independently.
    """
    if not text.strip():
        return []

    # Use paragraph breaks if present, otherwise treat as one block
    raw_paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]

    verses = []
    for para in raw_paragraphs:
        if len(para) <= TARGET_VERSE_LEN:
            verses.append(para)
            continue
        # Split into sentences and accumulate into ~TARGET_VERSE_LEN chunks
        sents = split_into_sentences(para)
        chunk = ''
        for sent in sents:
            if not chunk:
                chunk = sent
            elif len(chunk) + 1 + len(sent) <= TARGET_VERSE_LEN:
                chunk = chunk + ' ' + sent
            else:
                # Would exceed target. Emit current chunk if long enough,
                # or keep accumulating if it's very short.
                if len(chunk) >= MIN_VERSE_LEN:
                    verses.append(chunk)
                    chunk = sent
                else:
                    chunk = chunk + ' ' + sent
        if chunk:
            verses.append(chunk)

    return verses


def clean_chapter_text(text: str) -> str:
    """Remove page numbers, footnote blocks, and collapse whitespace."""
    text = footnote_block.sub('', text)
    text = page_num_line.sub('\n', text)
    # Remove inline footnote superscripts: digit glued to end of a word
    text = re.sub(r'(\w)(\d{1,2})\n', r'\1\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    paragraphs = [' '.join(p.split()) for p in re.split(r'\n\s*\n', text)]
    paragraphs = [p for p in paragraphs if p.strip()]
    return '\n\n'.join(paragraphs).strip()


def parse_book(book_text: str) -> list[tuple[int, str]]:
    """
    Return list of (local_chapter_num_1based, chapter_text).
    The file's chapter numbers may not be contiguous (scanning artifacts),
    so we use sequential 1-based numbering for the DB.
    """
    chapters = []
    matches  = list(chapter_marker.finditer(book_text))
    for idx, m in enumerate(matches):
        start = m.end()
        end   = matches[idx + 1].start() if idx + 1 < len(matches) else len(book_text)
        ch_text = book_text[start:end]
        ch_text = clean_chapter_text(ch_text)
        if ch_text:
            chapters.append((int(m.group(1)), ch_text))
    return chapters


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

total_chapters = 0

for book_num in range(1, 11):
    book_id, book_name, short_name = BOOK_META[book_num]

    if book_num not in book_blocks:
        conn.execute(
            "INSERT INTO books VALUES (?, ?, ?, ?, 0)",
            (book_id, book_name, short_name, TESTAMENT)
        )
        print(f'  {book_id}: [MISSING — 0 chapters]')
        continue

    chapters = parse_book(book_blocks[book_num])

    conn.execute(
        "INSERT INTO books VALUES (?, ?, ?, ?, ?)",
        (book_id, book_name, short_name, TESTAMENT, len(chapters))
    )

    # Insert using 1-based sequential chapter numbering within each book.
    # Each chapter is split into sentence-boundary chunks so the reader
    # doesn't see one giant text block per chapter.
    total_para_count = 0
    for local_ch_idx, (file_ch_num, ch_text) in enumerate(chapters, start=1):
        chunks = chunk_into_verses(ch_text)
        if not chunks:
            chunks = [ch_text.strip()]
        for v_num, chunk in enumerate(chunks, start=1):
            conn.execute(
                "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
                (book_id, local_ch_idx, v_num, chunk)
            )
        total_para_count += len(chunks)

    total_chapters += len(chapters)
    if chapters:
        print(f'  {book_id}: {len(chapters)} chapters '
              f'(file ch {chapters[0][0]}–{chapters[-1][0]})')

conn.commit()

# ---------------------------------------------------------------------------
# 6. Verification output
# ---------------------------------------------------------------------------
print(f'\nTotal chapters inserted: {total_chapters}')
print('\nBook summary from DB:')
for row in conn.execute(
    "SELECT id, name, chapters_count FROM books ORDER BY id"
):
    print(f'  {row[0]}: {row[2]} chapters — {row[1]}')

print('\nSample: first chapter text of each book (100 chars):')
for row in conn.execute(
    "SELECT book_id, chapter, substr(text,1,100) FROM verses "
    "WHERE verse_num=1 AND chapter=1 ORDER BY book_id"
):
    print(f'  {row[0]} {row[1]}:1  {row[2]}...')

conn.close()
print('\nRecognitions of Clement seeded successfully.')
