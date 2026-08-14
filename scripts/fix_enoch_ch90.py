#!/usr/bin/env python3
"""
One-time repair of data/enoch.db chapter 90.

Verse 15's row in the shipped DB contains verses 15-42 of the Book of Enoch (Charles
translation) concatenated into a single text field, with the original verse-break markers
("|| 17.", "18.", etc.) still literally present in the string. Worse than a mere merge:
comparing against the correct source, verses 16 and 19 are ENTIRELY MISSING from the blob — they
were dropped somewhere during whatever process ingested this text, not just mis-split.

Correct per-verse text below is R.H. Charles's 1917 translation (the same one already used
throughout this DB — matching phrasing "Lord of the sheep", the dagger-marked uncertain-reading
convention e.g. "into His shadow", bracketed editorial insertions, and curly-quote style),
sourced from Wikisource's transcription of that edition rather than sacred-texts.com, whose own
chapter-number-to-filename mapping is offset (boe090.htm is not actually chapter 90) and would
have risked exactly the kind of chapter-numbering mismatch flagged as a known risk with that site.

Usage: python3 scripts/fix_enoch_ch90.py /path/to/data/enoch.db
Back up enoch.db before running. Idempotent-safe: refuses to run a second time (verse 15 will no
longer be the 5176-char corrupted blob after the first successful run).
"""
import sqlite3
import sys

VERSES = {
    15: "And I saw till the Lord of the sheep came unto them in wrath, and all who saw Him fled, and they all fell †into His shadow† from before His face.",
    16: "All the eagles and vultures and ravens and kites were gathered together, and there came with them all the sheep of the field, yea, they all came together, and helped each other to break that horn of the ram.",
    17: "And I saw that man, who wrote the book according to the command of the Lord, till he opened that book concerning the destruction which those twelve last shepherds had wrought, and showed that they had destroyed much more than their predecessors, before the Lord of the sheep.",
    18: "And I saw till the Lord of the sheep came unto them and took in His hand the staff of His wrath, and smote the earth, and the earth clave asunder, and all the beasts and all the birds of the heaven fell from among those sheep, and were swallowed up in the earth and it covered them.",
    19: "And I saw till a great sword was given to the sheep, and the sheep proceeded against all the beasts of the field to slay them, and all the beasts and the birds of the heaven fled before their face.",
    20: "And I saw till a throne was erected in the pleasant land, and the Lord of the sheep sat Himself thereon, and the other took the sealed books and opened those books before the Lord of the sheep.",
    21: "And the Lord called those men the seven first white ones, and commanded that they should bring before Him, beginning with the first star which led the way, all the stars whose privy members were like those of horses, and they brought them all before Him.",
    22: "And He said to that man who wrote before Him, being one of those seven white ones, and said unto him: ‘Take those seventy shepherds to whom I delivered the sheep, and who taking them on their own authority slew more than I commanded them.’",
    23: "And behold they were all bound, I saw, and they all stood before Him.",
    24: "And the judgement was held first over the stars, and they were judged and found guilty, and went to the place of condemnation, and they were cast into an abyss, full of fire and flaming, and full of pillars of fire.",
    25: "And those seventy shepherds were judged and found guilty, and they were cast into that fiery abyss.",
    26: "And I saw at that time how a like abyss was opened in the midst of the earth, full of fire, and they brought those blinded sheep, and they were all judged and found guilty and cast into this fiery abyss, and they burned; now this abyss was to the right of that house.",
    27: "And I saw those sheep burning †and their bones burning†.",
    28: "And I stood up to see till they folded up that old house; and carried off all the pillars, and all the beams and ornaments of the house were at the same time folded up with it, and they carried it off and laid it in a place in the south of the land.",
    29: "And I saw till the Lord of the sheep brought a new house greater and loftier than that first, and set it up in the place of the first which had been folded up: all its pillars were new, and its ornaments were new and larger than those of the first, the old one which He had taken away, and all the sheep were within it.",
    30: "And I saw all the sheep which had been left, and all the beasts on the earth, and all the birds of the heaven, falling down and doing homage to those sheep and making petition to and obeying them in every thing.",
    31: "And thereafter those three who were clothed in white and had seized me by my hand [who had taken me up before], and the hand of that ram also seizing hold of me, they took me up and set me down in the midst of those sheep †before the judgement took place†.",
    32: "And those sheep were all white, and their wool was abundant and clean.",
    33: "And all that had been destroyed and dispersed, and all the beasts of the field, and all the birds of the heaven, assembled in that house, and the Lord of the sheep rejoiced with great joy because they were all good and had returned to His house.",
    34: "And I saw till they laid down that sword, which had been given to the sheep, and they brought it back into the house, and it was sealed before the presence of the Lord, and all the sheep were invited into that house, but it held them not.",
    35: "And the eyes of them all were opened, and they saw the good, and there was not one among them that did not see.",
    36: "And I saw that that house was large and broad and very full.",
    37: "And I saw that a white bull was born, with large horns, and all the beasts of the field and all the birds of the air feared him and made petition to him all the time.",
    38: "And I saw till all their generations were transformed, and they all became white bulls; and the first among them became a lamb, and that lamb became a great animal and had great black horns on its head; and the Lord of the sheep rejoiced over it and over all the oxen.",
    39: "And I slept in their midst: and I awoke and saw everything.",
    40: "This is the vision which I saw while I slept, and I awoke and blessed the Lord of righteousness and gave Him glory.",
    41: "Then I wept with a great weeping and my tears stayed not till I could no longer endure it: when I saw, they flowed on account of what I had seen; for everything shall come and be fulfilled, and all the deeds of men in their order were shown to me.",
    42: "On that night I remembered the first dream, and because of it I wept and was troubled—because I had seen that vision.",
}


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python3 fix_enoch_ch90.py /path/to/enoch.db")
        sys.exit(2)
    db_path = sys.argv[1]
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    row = cur.execute(
        "SELECT id, text FROM verses WHERE book_id='ENO' AND chapter=90 AND verse_num=15"
    ).fetchone()
    if not row:
        print("verse 15 not found — nothing to fix")
        conn.close()
        return
    old_id, old_text = row
    if len(old_text) < 1000:
        print(f"verse 15 is only {len(old_text)} chars — this is not the known corrupted row "
              f"(expected ~5176 chars). Refusing to touch it.")
        conn.close()
        sys.exit(1)

    existing = cur.execute(
        "SELECT verse_num FROM verses WHERE book_id='ENO' AND chapter=90 AND verse_num>15"
    ).fetchall()
    if existing:
        print(f"unexpected: rows already exist for verse_num>15: {existing} — aborting")
        conn.close()
        sys.exit(1)

    try:
        cur.execute("BEGIN")
        # verses_fts is an external-content FTS5 table fed only by an AFTER INSERT trigger — a
        # plain DELETE on `verses` would leave this row's FTS entry orphaned (stale text,
        # searchable but wrong), so the deletion has to be told to FTS explicitly.
        cur.execute(
            "INSERT INTO verses_fts(verses_fts, rowid, text, book_id, chapter, verse_num) "
            "VALUES ('delete', ?, ?, ?, ?, ?)",
            (old_id, old_text, "ENO", 90, 15),
        )
        cur.execute("DELETE FROM verses WHERE id=?", (old_id,))
        for vnum in sorted(VERSES):
            cur.execute(
                "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?, ?, ?, ?)",
                ("ENO", 90, vnum, VERSES[vnum]),
            )
        conn.commit()
        print(f"ok: replaced 1 corrupted row (id={old_id}, {len(old_text)} chars) with "
              f"{len(VERSES)} correctly-split rows (verses 15-42), recovering 2 previously "
              f"entirely-missing verses (16, 19).")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
