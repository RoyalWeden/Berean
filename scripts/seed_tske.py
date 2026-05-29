#!/usr/bin/env python3
"""
Seed data/tske_refs.db from TSKe-SR.cmti (Treasury of Scripture Knowledge, Enhanced).
670,558 cross-references with word-level headings and reciprocal references.

Usage: python3 scripts/seed_tske.py
Run from the project root.
"""

import re
import sqlite3
import sys

TSKE_PATH = "/Users/roywe/Downloads/TSKe-SR.cmti"
OUT_PATH = "data/tske_refs.db"

# ── Book abbreviation maps ────────────────────────────────────────────────────

# TSKe VerseCommentary.Book integer → kjva book_id
TSKE_NUM_TO_ID = {
    1: "GEN",  2: "EXO",  3: "LEV",  4: "NUM",  5: "DEU",
    6: "JOS",  7: "JDG",  8: "RUT",  9: "1SA", 10: "2SA",
   11: "1KI", 12: "2KI", 13: "1CH", 14: "2CH", 15: "EZR",
   16: "NEH", 17: "EST", 18: "JOB", 19: "PSA", 20: "PRO",
   21: "ECC", 22: "SNG", 23: "ISA", 24: "JER", 25: "LAM",
   26: "EZK", 27: "DAN", 28: "HOS", 29: "JOL", 30: "AMO",
   31: "OBA", 32: "JON", 33: "MIC", 34: "NAM", 35: "HAB",
   36: "ZEP", 37: "HAG", 38: "ZEC", 39: "MAL",
   40: "MAT", 41: "MRK", 42: "LUK", 43: "JHN", 44: "ACT",
   45: "ROM", 46: "1CO", 47: "2CO", 48: "GAL", 49: "EPH",
   50: "PHP", 51: "COL", 52: "1TH", 53: "2TH", 54: "1TI",
   55: "2TI", 56: "TIT", 57: "PHM", 58: "HEB", 59: "JAS",
   60: "1PE", 61: "2PE", 62: "1JN", 63: "2JN", 64: "3JN",
   65: "JUD", 66: "REV",
}

# TSKe ref abbreviations inside Comments HTML → kjva book_id
TSKE_ABBR_MAP = {
    "Gen": "GEN", "Exo": "EXO", "Lev": "LEV", "Num": "NUM", "Deu": "DEU",
    "Jos": "JOS", "Jdg": "JDG", "Rth": "RUT", "1Sa": "1SA", "2Sa": "2SA",
    "1Ki": "1KI", "2Ki": "2KI", "1Ch": "1CH", "2Ch": "2CH", "Ezr": "EZR",
    "Neh": "NEH", "Est": "EST", "Job": "JOB", "Psa": "PSA", "Pro": "PRO",
    "Ecc": "ECC", "Son": "SNG", "Isa": "ISA", "Jer": "JER", "Lam": "LAM",
    "Eze": "EZK", "Dan": "DAN", "Hos": "HOS", "Joe": "JOL", "Amo": "AMO",
    "Oba": "OBA", "Jon": "JON", "Mic": "MIC", "Nah": "NAM", "Hab": "HAB",
    "Zep": "ZEP", "Hag": "HAG", "Zec": "ZEC", "Mal": "MAL",
    "Mat": "MAT", "Mar": "MRK", "Luk": "LUK", "Joh": "JHN", "Act": "ACT",
    "Rom": "ROM", "1Co": "1CO", "2Co": "2CO", "Gal": "GAL", "Eph": "EPH",
    "Php": "PHP", "Col": "COL", "1Th": "1TH", "2Th": "2TH", "1Ti": "1TI",
    "2Ti": "2TI", "Tit": "TIT", "Phm": "PHM", "Heb": "HEB", "Jas": "JAS",
    "1Pe": "1PE", "2Pe": "2PE", "1Jn": "1JN", "2Jn": "2JN", "3Jn": "3JN",
    "Jud": "JUD", "Rev": "REV",
}

# ── Regex patterns ────────────────────────────────────────────────────────────

RE_P = re.compile(r"<p[^>]*>(.*?)</p>", re.DOTALL)
RE_REF = re.compile(r"<ref>([^<]+)</ref>")
RE_REF_PARSE = re.compile(r"^(\w+)\s+(\d+):(\d+)(?:-(\d+))?$")
RE_BOLD_HEADING = re.compile(r'<span[^>]*font-weight:bold[^>]*>(.*?):\s*</span>', re.DOTALL)
RE_RECIP_HEADER = re.compile(r'text-decoration:underline[^>]*>RECIPROCAL')
RE_SKIP = re.compile(r'color:#008000|&nbsp;|font-style:italic')
RE_TAGS = re.compile(r"<[^>]+>")


def parse_ref(ref_str: str):
    """Parse 'Gen 1:1' or 'Gen 1:1-3' → (book_id, ch, vs, vs_end|None) or None."""
    m = RE_REF_PARSE.match(ref_str.strip())
    if not m:
        return None
    abbr, ch, vs, vs_end = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    book_id = TSKE_ABBR_MAP.get(abbr)
    if not book_id:
        return None
    return (book_id, ch, vs, int(vs_end) if vs_end else None)


def parse_comments(html: str):
    """
    Parse TSKe Comments HTML → list of ref dicts.
    Each dict: {heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context}
    """
    rows = []

    # Split at RECIPROCAL header
    recip_m = RE_RECIP_HEADER.search(html)
    if recip_m:
        # Find the enclosing <p> start before this match
        main_end = html.rfind("<p", 0, recip_m.start())
        main_html = html[:main_end] if main_end >= 0 else html[:recip_m.start()]
        recip_html = html[recip_m.end():]
    else:
        main_html = html
        recip_html = ""

    current_heading = None
    sort_order = 0

    for p_m in RE_P.finditer(main_html):
        block = p_m.group(1)

        # Skip the self-reference paragraph (green color + italic verse text)
        if RE_SKIP.search(block):
            continue

        # Check for bold word-heading
        heading_m = RE_BOLD_HEADING.search(block)
        if heading_m:
            current_heading = RE_TAGS.sub("", heading_m.group(1)).strip()
            sort_order = 0
            ref_start = heading_m.end()
        else:
            ref_start = 0  # orphan refs belong to current_heading (continuation)

        if current_heading is None:
            continue

        for ref_m in RE_REF.finditer(block, ref_start):
            parsed = parse_ref(ref_m.group(1))
            if parsed:
                to_book, to_ch, to_vs, to_vs_end = parsed
                rows.append({
                    "heading": current_heading,
                    "is_reciprocal": 0,
                    "to_book": to_book,
                    "to_ch": to_ch,
                    "to_vs": to_vs,
                    "to_vs_end": to_vs_end,
                    "sort_order": sort_order,
                    "context": None,
                })
                sort_order += 1

    # Parse RECIPROCAL section
    sort_order = 0
    for p_m in RE_P.finditer(recip_html):
        block = p_m.group(1)
        ref_m = RE_REF.search(block)
        if ref_m:
            parsed = parse_ref(ref_m.group(1))
            if parsed:
                to_book, to_ch, to_vs, to_vs_end = parsed
                after = block[ref_m.end():]
                stripped = RE_TAGS.sub("", after).strip()
                ctx_m = re.search(r"[-–]\s*(.+)", stripped)
                context = ctx_m.group(1).strip() if ctx_m else None
                rows.append({
                    "heading": None,
                    "is_reciprocal": 1,
                    "to_book": to_book,
                    "to_ch": to_ch,
                    "to_vs": to_vs,
                    "to_vs_end": to_vs_end,
                    "sort_order": sort_order,
                    "context": context,
                })
                sort_order += 1

    return rows


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    tske = sqlite3.connect(TSKE_PATH)
    out = sqlite3.connect(OUT_PATH)

    out.executescript("""
        DROP TABLE IF EXISTS tske_refs;
        CREATE TABLE tske_refs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            from_book     TEXT NOT NULL,
            from_ch       INTEGER NOT NULL,
            from_vs       INTEGER NOT NULL,
            heading       TEXT,
            is_reciprocal INTEGER NOT NULL DEFAULT 0,
            to_book       TEXT NOT NULL,
            to_ch         INTEGER NOT NULL,
            to_vs         INTEGER NOT NULL,
            to_vs_end     INTEGER,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            context       TEXT
        );
    """)

    rows_in = tske.execute(
        "SELECT Book, ChapterBegin, VerseBegin, Comments FROM VerseCommentary ORDER BY Book, ChapterBegin, VerseBegin"
    ).fetchall()

    print(f"Processing {len(rows_in)} verses from TSKe…")

    inserts = []
    bad_abbrs: set[str] = set()
    verse_count = 0
    ref_count = 0
    errors = 0

    for book_num, ch, vs, html in rows_in:
        from_book = TSKE_NUM_TO_ID.get(book_num)
        if not from_book:
            continue
        verse_count += 1

        try:
            parsed_rows = parse_comments(html)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  ERROR {from_book} {ch}:{vs}: {e}", file=sys.stderr)
            continue

        for r in parsed_rows:
            inserts.append((
                from_book, ch, vs,
                r["heading"], r["is_reciprocal"],
                r["to_book"], r["to_ch"], r["to_vs"], r["to_vs_end"],
                r["sort_order"], r["context"],
            ))
            ref_count += 1

        if verse_count % 5000 == 0:
            print(f"  {verse_count}/{len(rows_in)} verses ({ref_count} refs)…")

    print(f"Inserting {ref_count} rows…")
    out.executemany(
        """INSERT INTO tske_refs
           (from_book, from_ch, from_vs, heading, is_reciprocal,
            to_book, to_ch, to_vs, to_vs_end, sort_order, context)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        inserts,
    )

    print("Building index…")
    out.execute("CREATE INDEX idx_tske_from ON tske_refs(from_book, from_ch, from_vs, is_reciprocal, sort_order)")
    out.commit()

    if bad_abbrs:
        print(f"\nUnknown book abbreviations ({len(bad_abbrs)}): {sorted(bad_abbrs)[:20]}")
    if errors:
        print(f"\nParse errors: {errors}")

    # Spot checks
    print("\n── Spot checks ──")
    for (bk, ch, vs) in [("GEN", 1, 1), ("JHN", 3, 16), ("PSA", 23, 1)]:
        groups = out.execute(
            "SELECT heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, context"
            " FROM tske_refs WHERE from_book=? AND from_ch=? AND from_vs=? LIMIT 8",
            (bk, ch, vs)
        ).fetchall()
        print(f"\n  {bk} {ch}:{vs} ({len(groups)} rows shown):")
        for g in groups:
            heading, is_r, tb, tc, tv, tve, ctx = g
            rng = f"{tc}:{tv}" + (f"-{tve}" if tve else "")
            tag = "[RECIP]" if is_r else f"[{heading}]"
            print(f"    {tag} → {tb} {rng}" + (f" — {ctx}" if ctx else ""))

    total = out.execute("SELECT COUNT(*) FROM tske_refs").fetchone()[0]
    print(f"\nTotal refs inserted: {total}")
    out.close()
    tske.close()


if __name__ == "__main__":
    main()
