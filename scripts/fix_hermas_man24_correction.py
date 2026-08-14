#!/usr/bin/env python3
"""
Corrects a real transcription error in the FIRST Hermas fix (fix_hermas_taylor_endings.py): that
script's HER_MAN_24 dict was accidentally a copy of HER_SIM_65's text (Tenth Similitude, Chapter
4) instead of Mandate Twelve's own real Chapter 6 — so after running it, HER_MAN chapter 24 held
five verses of genuine Hermas text, but the WRONG five verses (duplicated from a different book
entirely), rather than the publisher back-matter that had been there before.

Correct text (Mandate 12, "Chapter 6", vol.1 pp.163-164 of Charles Taylor's translation — the
same primary-source PDFs the first fix used) verified against
/Users/roywe/Downloads/shepherd-of-hermas_vol-1_taylor.pdf directly, not re-derived from memory.

Usage: python3 scripts/fix_hermas_man24_correction.py /path/to/hermas_taylor.db
Refuses to run unless HER_MAN chapter 24 currently holds exactly the wrong (Similitude-10-shaped)
5 rows the first fix mistakenly wrote, so this can't misfire against any other state.
"""
import sqlite3
import sys

CORRECT_HER_MAN_24 = {
    1: "BUT I, the Angel of Repentance, say unto you, Fear not the devil. For I was sent, quoth "
       "he, to be with such of you as repent with their whole heart, and to make them strong in "
       "the faith.",
    2: "Trust God therefore, ye that have despaired of your life and added to your sins and are "
       "weighing down your life, that, if ye turn to the Lord with all your heart and do "
       "righteousness the rest of the days of your life and serve Him rightly according to His "
       "will, He will heal your former sins; and ye shall have power to have dominion over the "
       "works of the devil. And fear not at all the threatening of the devil; for he is slack "
       "like the sinews of a corpse.",
    3: "Hearken to me therefore, and fear Him who is all-able, to save and to destroy; and "
       "observe these commandments, and ye shall live unto God.",
    4: "I said to him, Sir, now am I strengthened in all the ordinances of the Lord, because "
       "thou art with me; and I know that thou wilt break all the power of the devil, and we "
       "shall have dominion over him and prevail over all his works. I hope, sir, that I am able "
       "now to keep these commandments which thou hast commanded, the Lord enabling me.",
    5: "Thou shalt keep them, quoth he, if thy heart be pure unto the Lord; and all who cleanse "
       "their hearts from the vain desires of this world shall keep them, and they shall live "
       "unto God.",
}

# The exact (wrong) text the first script accidentally wrote — checked verbatim so this can only
# ever fire against precisely that mistaken state, never overwrite anything else.
WRONGLY_WRITTEN_V1_PREFIX = "THEN he said to me, Quit thee manfully in this ministry"


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python3 fix_hermas_man24_correction.py /path/to/hermas_taylor.db")
        sys.exit(2)
    conn = sqlite3.connect(sys.argv[1])
    cur = conn.cursor()

    rows = cur.execute(
        "SELECT id, verse_num, text FROM verses WHERE book_id='HER_MAN' AND chapter=24 ORDER BY verse_num"
    ).fetchall()
    if len(rows) != 5:
        print(f"HER_MAN chapter 24 has {len(rows)} rows, expected exactly 5 — aborting")
        sys.exit(1)
    if not rows[0][2].startswith(WRONGLY_WRITTEN_V1_PREFIX):
        print("HER_MAN chapter 24 verse 1 doesn't match the known mistaken text — aborting "
              "(already corrected, or a different state than expected).")
        sys.exit(1)

    try:
        cur.execute("BEGIN")
        for row_id, verse_num, old_text in rows:
            cur.execute(
                "INSERT INTO verses_fts(verses_fts, rowid, text, book_id, chapter, verse_num) "
                "VALUES ('delete', ?, ?, 'HER_MAN', 24, ?)",
                (row_id, old_text, verse_num),
            )
        cur.execute("DELETE FROM verses WHERE book_id='HER_MAN' AND chapter=24")
        for vnum in sorted(CORRECT_HER_MAN_24):
            cur.execute(
                "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES ('HER_MAN', 24, ?, ?)",
                (vnum, CORRECT_HER_MAN_24[vnum]),
            )
        conn.commit()
        print("ok: HER_MAN chapter 24 corrected to Mandate 12's real Chapter 6 text.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
