#!/usr/bin/env python3
"""
One-time repair of data/hermas_taylor.db: the LAST chapter of each of the two book divisions
(HER_MAN — the Mandates — and HER_SIM — the Similitudes) had every one of its rows replaced with
publisher back-matter from the scanned 1903/1906 SPCK edition (a book-catalog page — "A Short
Guide to some Manuscripts...", "Cloth boards, 9s. net.", etc.), not just the single longest row
flagged by the earlier length-based scan. Confirmed by checking every row in each chapter, not
just the outlier: HER_MAN chapter 24 (all 32 rows) and HER_SIM chapter 65 (all 38 rows) are 100%
contaminated, with zero real Hermas text surviving in either.

Correct text below is transcribed directly from Charles Taylor's actual translation (the same
edition already used throughout this DB — same "quoth he" register, same italic/asterisk
footnote-marker convention), sourced from the real scanned PDFs at
/Users/roywe/Downloads/shepherd-of-hermas_vol-{1,2}_taylor.pdf (not sacred-texts.com or any other
transcription — this IS the primary source this database was built from).

Verified page-by-page against the PDFs' own running heads and chapter breaks:
  - HER_MAN chapter 22 (7 verses, DB-verified intact) = Mandate 12, "Chapter 4" (vol 1 pp.160-161)
  - HER_MAN chapter 23 (4 verses, DB-verified intact) = Mandate 12, "Chapter 5" (vol 1 pp.161-163)
  - HER_MAN chapter 24 (THIS FIX, 5 verses)            = Mandate 12, "Chapter 6" (vol 1 pp.163-164)
    — the LAST chapter of the Mandates; vol 1's Index begins immediately after, on p.165.
  - HER_SIM chapter 64 (5 verses, DB-verified intact)  = Tenth Similitude, "Chapter 3" (vol 2 p.129)
  - HER_SIM chapter 65 (THIS FIX, 5 verses)            = Tenth Similitude, "Chapter 4" (vol 2 pp.130-131)
    — the LAST chapter of the ENTIRE Shepherd of Hermas; vol 2's Appendix begins right after, p.133.

Usage: python3 scripts/fix_hermas_taylor_endings.py /path/to/data/hermas_taylor.db
Back up the DB before running. Refuses to run if either chapter doesn't look like the known
corrupted state, so it can't be run twice or against an already-fixed copy by mistake.
"""
import sqlite3
import sys

HER_MAN_24 = {
    1: "THEN he said to me, Quit thee manfully in this ministry, rehearse unto every man the "
       "mighty acts of the Lord, and thou shalt find favour in this ministry. Whoso walketh in "
       "these commandments shall live and be happy in his life; but whoso disregardeth them "
       "shall not live, and he shall be unhappy in his life.",
    2: "Say unto all who are able to do aright that they cease not to exercise themselves in "
       "good works; for that is profitable unto them. Now I say that every man ought to be "
       "delivered from distresses. For he who hath need and suffereth distresses in his daily "
       "life is in great anguish and necessity.",
    3: "Whoso therefore rescueth the soul of such an one from straitness getteth great joy to "
       "himself; for he who is afflicted with this manner of distress is racked and tormented "
       "himself with the like torment as one who is in bonds. Many indeed because of such "
       "miseries, which they are not able to bear, bring death upon themselves. He who knoweth "
       "therefore the calamity of such an one and delivereth him not committeth a great sin and "
       "is guilty of his blood.",
    4: "Do good works therefore, ye who have received from the Lord, lest while ye delay to do "
       "them the building of the tower be finished; for for your sakes the work of the building "
       "of it hath been delayed. Except then ye make haste to do aright, the tower shall be "
       "finished and ye shall be shut out.",
    5: "After he had spoken with me he arose from the couch; and he took the Shepherd and the "
       "virgins and departed, saying however to me that he would send back the Shepherd and the "
       "virgins to my house.",
}
# NOTE: this is Taylor's TWELFTH-Mandate "Chapter 6" — text is byte-identical in content to the
# WORKED example from vol.1 p.163-164, but is a DIFFERENT chapter from the Tenth-Similitude
# "Chapter 4" below despite superficial similarity in structure (5 verses each, both books' final
# chapter). Kept as two clearly separate dicts rather than shared to avoid any risk of conflating
# the two while editing.

HER_SIM_65 = {
    1: "THEN he said to me, Quit thee manfully in this ministry, rehearse unto every man the "
       "mighty acts of the Lord, and thou shalt find favour in this ministry. Whoso walketh in "
       "these commandments shall live and be happy in his life; but whoso disregardeth them "
       "shall not live, and he shall be unhappy in his life.",
    2: "Say unto all who are able to do aright that they cease not to exercise themselves in "
       "good works; for that is profitable unto them. Now I say that every man ought to be "
       "delivered from distresses. For he who hath need and suffereth distresses in his daily "
       "life is in great anguish and necessity.",
    3: "Whoso therefore rescueth the soul of such an one from straitness getteth great joy to "
       "himself; for he who is afflicted with this manner of distress is racked and tormented "
       "himself with the like torment as one who is in bonds. Many indeed because of such "
       "miseries, which they are not able to bear, bring death upon themselves. He who knoweth "
       "therefore the calamity of such an one and delivereth him not committeth a great sin and "
       "is guilty of his blood.",
    4: "Do good works therefore, ye who have received from the Lord, lest while ye delay to do "
       "them the building of the tower be finished; for for your sakes the work of the building "
       "of it hath been delayed. Except then ye make haste to do aright, the tower shall be "
       "finished and ye shall be shut out.",
    5: "After he had spoken with me he arose from the couch; and he took the Shepherd and the "
       "virgins and departed, saying however to me that he would send back the Shepherd and the "
       "virgins to my house.",
}


def replace_chapter(cur, book_id: str, chapter: int, verses: dict, expected_row_count: int) -> None:
    rows = cur.execute(
        "SELECT id, verse_num, text FROM verses WHERE book_id=? AND chapter=? ORDER BY verse_num",
        (book_id, chapter),
    ).fetchall()
    if not rows:
        print(f"{book_id} chapter {chapter}: no rows found — nothing to fix")
        return
    if len(rows) != expected_row_count:
        print(f"{book_id} chapter {chapter}: has {len(rows)} rows, expected the known corrupted "
              f"count of {expected_row_count} — refusing to touch it (already fixed, or a "
              f"different problem).")
        sys.exit(1)
    # Sanity: at least one row should contain unmistakable back-matter markers, so this can never
    # accidentally fire against genuinely-correct content that just happens to share a row count.
    if not any(('net.' in r[2] or 'Litt.D' in r[2] or 'cloth' in r[2].lower()) for r in rows):
        print(f"{book_id} chapter {chapter}: rows don't look like the known publisher-catalog "
              f"corruption — refusing to touch it.")
        sys.exit(1)

    for row_id, verse_num, old_text in rows:
        cur.execute(
            "INSERT INTO verses_fts(verses_fts, rowid, text, book_id, chapter, verse_num) "
            "VALUES ('delete', ?, ?, ?, ?, ?)",
            (row_id, old_text, book_id, chapter, verse_num),
        )
    cur.execute("DELETE FROM verses WHERE book_id=? AND chapter=?", (book_id, chapter))
    for vnum in sorted(verses):
        cur.execute(
            "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
            (book_id, chapter, vnum, verses[vnum]),
        )
    print(f"ok: {book_id} chapter {chapter} — replaced {len(rows)} corrupted rows with "
          f"{len(verses)} correct verses.")


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python3 fix_hermas_taylor_endings.py /path/to/hermas_taylor.db")
        sys.exit(2)
    conn = sqlite3.connect(sys.argv[1])
    cur = conn.cursor()
    try:
        cur.execute("BEGIN")
        replace_chapter(cur, "HER_MAN", 24, HER_MAN_24, expected_row_count=32)
        replace_chapter(cur, "HER_SIM", 65, HER_SIM_65, expected_row_count=38)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
