"""
Seed 2 Baruch (Apocalypse of Baruch) from /tmp/2baruch_raw.html
(raw HTML fetched directly via curl, NOT run through any AI summarizer — the
source text must be transcribed verbatim, so paraphrasing risk had to be
avoided entirely).

Source: https://www.pseudepigrapha.com/pseudepigrapha/2Baruch.html
R.H. Charles-based translation, Wesley Center for Applied Theology.

Source quirks handled here (verified by direct inspection of the raw HTML,
not guessed):
  - Chapter/verse anchors are normally "C<n>" / "C<n>.<v>", but chapters 32
    and 33 use bare "<n>" / "<n>.<v>" (missing the "C" prefix) — anchor
    regexes below accept both forms.
  - A large <TABLE> INDEX (chapter-to-topic listing) precedes the real
    content and must be stripped, not parsed.
  - Chapters 12-13 embed two "OXYRHYNCHUS GREEK FRAGMENT" side-by-side
    comparison tables — a second column giving an alternate/fragmentary
    reading of the same verses, reusing (or "a"-suffixing) the real verses'
    own anchor IDs. Left uncleaned, this corrupts the real chapter 12/13
    text. Cleaned by keeping only the first <TD> of each table row in the
    two fragment tables (located by the literal "OXYRHYNCHUS GREEK
    FRAGMENT" marker) before the main anchor-based parse ever runs.
  - A literal "<FONT Color="fuchsia">finish</FONT>" marker follows the last
    real verse (85:2) before a copyright footer — content is truncated
    there so the footer never bleeds into 85:2's text.
  - Inline topic subheadings (e.g. "<CENTER><I>4:2-7. The heavenly
    Jerusalem</I></CENTER>", sometimes as a <TD ColSpan="2"> cell inside
    the chapter 13 fragment table) are interleaved directly in the body
    text between verses, with no verse anchor of their own — the same
    text that already appears (correctly stripped) in the INDEX table up
    top, repeated a second time inline right before the section it
    introduces. With no anchor to bound them, they silently glued onto
    the end of whichever verse precedes them (~32 verses affected,
    chapters 4-77) until SECTION_HEADING_RE below started stripping them.
"""
import html as html_module
import os
import re
import sqlite3

SRC = '/tmp/2baruch_raw.html'
DB  = '/Users/roywe/Berean/data/2baruch.db'

BOOK_ID    = '2BA'
BOOK_NAME  = '2 Baruch'
SHORT_NAME = '2 Baruch'
TESTAMENT  = 'Pseudepigrapha'

# ---------------------------------------------------------------------------
# 1. Delete old DB files (NOT the .bak)
# ---------------------------------------------------------------------------
for path in (DB, DB + '-shm', DB + '-wal'):
    if os.path.exists(path):
        os.remove(path)
        print(f'Deleted: {path}')

# ---------------------------------------------------------------------------
# 2. Read source, truncate footer, strip the Oxyrhynchus fragment tables
# ---------------------------------------------------------------------------
with open(SRC, encoding='utf-8') as f:
    raw = f.read()

finish_marker = raw.find('<FONT Color="fuchsia">finish</FONT>')
if finish_marker == -1:
    raise ValueError('Could not find the end-of-content "finish" marker')
raw = raw[:finish_marker]


FRAGMENT_CELL_RE = re.compile(
    r'OXYRHYNCHUS GREEK FRAGMENT'
    r'|Chapter\s+\d+a</FONT>'          # "Chapter 12a" / "13a" / "14a" heading cells
    r'|>\d+a\s*</FONT>',               # verse-label cells reading "1a "/"2a "/"11a " etc.
    re.I,
)


def strip_fragment_table_second_columns(text: str) -> str:
    """Within each <TABLE Border="0">...</TABLE> that contains the literal
    "OXYRHYNCHUS GREEK FRAGMENT" marker, drop every <TD>...</TD> cell that
    belongs to the fragment/alternate-reading column (identified by content,
    not row position — the real column's rows in this source have malformed
    HTML in places, e.g. chapter 12 verse 3's row is missing its closing
    </TR> before verse 4's row opens, which breaks any <TR>-based row
    grouping) and keep everything else, in document order.
    """
    out = []
    pos = 0
    while True:
        marker = text.find('OXYRHYNCHUS GREEK FRAGMENT', pos)
        if marker == -1:
            out.append(text[pos:])
            break
        tbl_start = text.rfind('<TABLE', 0, marker)
        tbl_end = text.find('</TABLE>', marker)
        tbl_end = tbl_end + len('</TABLE>') if tbl_end != -1 else len(text)

        out.append(text[pos:tbl_start])

        table_html = text[tbl_start:tbl_end]
        cells = re.findall(r'<TD\b.*?</TD>', table_html, re.S | re.I)
        kept = [c for c in cells if not FRAGMENT_CELL_RE.search(c)]
        out.append(' '.join(kept))

        pos = tbl_end

    return ''.join(out)


raw = strip_fragment_table_second_columns(raw)

# Inline topic subheadings — see the module docstring's "Inline topic subheadings" entry.
# No verse anchor of their own, so they must be stripped BEFORE chapter/verse splitting or
# they silently glue onto the end of the preceding verse. Matches the plain-body
# <CENTER><I>...</I></CENTER> form, the <TD ColSpan="2"><CENTER><I>...</I></CENTER></TD> form
# found inside the chapter 13 fragment table, AND a <B>...</B> variant (chapter 52's
# "53-54. THE MESSIAH APOCALYPSE" heading uses bold instead of italic).
SECTION_HEADING_RE = re.compile(
    r'(?:<TD[^>]*>\s*)?'
    r'<CENTER>\s*(?:<BR>\s*)*'
    r'<[IB]>.*?</[IB]>\s*'
    r'</CENTER>'
    r'(?:\s*</TD>)?',
    re.S | re.I,
)
raw = SECTION_HEADING_RE.sub(' ', raw)

# Discard the INDEX table and everything before the real Chapter 1 heading.
first_ch = re.search(r'<A ID="C?1"><FONT Color="red">Chapter 1</FONT></A>', raw)
if not first_ch:
    raise ValueError('Could not find Chapter 1 heading')
raw = raw[first_ch.start():]

# ---------------------------------------------------------------------------
# 3. Split into chapters — accepts both "C<n>" and bare "<n>" anchor forms
#    (chapters 32/33 lack the "C" prefix in the source).
# ---------------------------------------------------------------------------
chapter_pattern = re.compile(
    r'<A ID="C?(\d+)"><FONT Color="red">Chapter\s+\d+</FONT></A>'
)
chapter_splits = list(chapter_pattern.finditer(raw))

chapters_data: dict[int, str] = {}
for idx, m in enumerate(chapter_splits):
    ch_num = int(m.group(1))
    start = m.end()
    end = chapter_splits[idx + 1].start() if idx + 1 < len(chapter_splits) else len(raw)
    chapters_data[ch_num] = raw[start:end]

print(f'Found {len(chapters_data)} chapters: {sorted(chapters_data.keys())[:5]} … {sorted(chapters_data.keys())[-5:]}')

# ---------------------------------------------------------------------------
# 4. Parse verses within each chapter — anchors again accept both "C<n>.<v>"
#    and bare "<n>.<v>" forms.
# ---------------------------------------------------------------------------
# Captures the verse number from the VISIBLE label (the second group), not the anchor's
# own ID (first group) — two verses in the source (36:11, 46:8) have a stale/mistyped
# anchor ID one behind their true, correctly-displayed verse number (e.g. anchor
# "C36.10" visibly labelled "11 "). Trusting the rendered label matches what a reader
# of the actual page sees, which is what "verbatim" transcription means here.
verse_anchor = re.compile(
    r'<A ID="C?\d+\.\d+"><FONT Color="blue">(\d+)\s*</FONT></A>'
)

TAG_RE = re.compile(r'<[^>]+>')


def clean_text(fragment: str) -> str:
    # Strip tags BEFORE any literal-string replacement — one verse (11:5) has a
    # malformed, unclosed "<span" immediately followed by "<BR>" in the source
    # (a copy-paste artifact); TAG_RE still consumes the whole run correctly as
    # long as <BR>'s own closing ">" hasn't already been eaten by a prior pass.
    text = TAG_RE.sub(' ', fragment)
    text = html_module.unescape(text)
    text = ' '.join(text.split())
    return text.strip()


def parse_chapter(text: str) -> list[tuple[int, str]]:
    matches = list(verse_anchor.finditer(text))
    verses = []
    for i, m in enumerate(matches):
        v_num = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = clean_text(text[start:end])
        if body:
            verses.append((v_num, body))
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
for ch_num in sorted(chapters_data.keys()):
    verses = parse_chapter(chapters_data[ch_num])
    for v_num, text in verses:
        conn.execute(
            "INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
            (BOOK_ID, ch_num, v_num, text)
        )
        total_verses += 1
    if ch_num in (1, 12, 13, 32, 33, 85):
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
    "SELECT chapter, verse_num, substr(text,1,80) FROM verses "
    "WHERE chapter IN (1, 12, 13, 32, 33, 85) ORDER BY chapter, verse_num LIMIT 20"
):
    print(f'  {BOOK_ID} {row[0]}:{row[1]}  {row[2]}...')

conn.close()
print('\n2 Baruch seeded successfully.')
