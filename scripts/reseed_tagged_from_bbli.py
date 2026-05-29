#!/usr/bin/env python3
"""
Reseed kjva.db text_tagged from kjv+.bbli (KJV with Strong's Numbers).
Covers all 66 canonical books; apocrypha/pseudepigrapha left untouched.

bbli Scripture format:
  word text<num>HXXXX</num>   → tagged word(s)
  <i>text</i>                 → italic (translator-supplied)
  <red>text</red><num>G...<num>  → red-letter (Yeshua's words) + Strongs
  <sup>(</sup><num>X</num><sup>)</sup>  → parenthetical Strongs (H853 etc.)
  <num>X</num>                → standalone extra Strongs after a tagged word
                                 EXCEPTION A: if previous inline was H4480 (min-prefix),
                                 REPLACE it with this more semantically meaningful root.
                                 Otherwise: APPEND as secondary Strongs (multi-Strongs).

Output text_tagged format (space-separated tokens):
  word{HXXXX}       — tagged word
  !word{GXXXX}      — red-letter tagged word (Yeshua's words)
  *word{}           — italic (translator-supplied)
  word{}            — no tag, not italic
  ~{HXXXX}          — parenthetical Strongs (grammatical particle, no English word)
  word{HXXX|HYYY}   — multi-Strongs word (primary + secondary semantic root)
"""

import re
import sqlite3
import sys

BBLI_PATH = "/Users/roywe/Downloads/kjv+.bbli"
KJVA_PATH = "data/kjva.db"

# ── Book mapping: bbli book number → kjva.db book_id ──────────────────────────
BOOK_MAP = {
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

# Strongs numbers that are Hebrew grammatical prefixes (not semantic roots).
# When these appear as the primary inline Strongs and are followed by a standalone
# secondary Strongs, the secondary is more semantically meaningful for the English word.
PREFIX_STRONGS = {"H4480", "H4482", "H4483"}  # min = from/of

# ── Parser ─────────────────────────────────────────────────────────────────────

# Capture parenthetical Strongs number (H853 accusative marker etc.) → <paren> sentinel
RE_PAREN = re.compile(r'<sup>\(</sup><num>([^<]*)</num><sup>\)</sup>')
# Bold tags (keep content — psalm titles)
RE_BOLD = re.compile(r'<b>([^<]*)</b>')
# Red-letter: <red>word(s)</red><num>Gxxx</num> — mark words with sentinel \x01
RE_RED_NUM = re.compile(r'<red>([^<]*)</red><num>([^<]*)</num>')
# Bare <red>word(s)</red> not immediately followed by <num> (rare)
RE_RED_BARE = re.compile(r'<red>([^<]*)</red>(?!<num>)')

# Segment pattern — processes scripture left to right (after red tags stripped)
# Group 1: text before a <num> tag (may be empty for standalone <num>)
# Group 2: strongs number from <num>...</num>
# Group 3: italic text inside <i>...</i>
# Group 4: parenthetical strongs inside <paren>...</paren>
# Group 5: plain text with no following <num>
RE_SEG = re.compile(
    r'([^<]*?)<num>([^<]+)</num>'   # text + strongs (groups 1,2)
    r'|<i>([^<]*)</i>'              # italic (group 3)
    r'|<paren>([^<]+)</paren>'      # parenthetical strongs (group 4)
    r'|([^<]+)'                     # plain text (group 5)
)


def word_tokens(text: str, italic: bool = False, strongs: str = "") -> list:
    """Split text into tokens; assign strongs to the last word."""
    words = text.split()
    if not words:
        return []
    result = []
    for i, w in enumerate(words):
        if italic:
            result.append(f"*{w}{{}}")
        elif strongs and i == len(words) - 1:
            result.append(f"{w}{{{strongs}}}")
        else:
            result.append(f"{w}{{}}")
    return result


def _mark_red_with_num(m: re.Match) -> str:
    """<red>words</red><num>Gxxx</num> → \x01word1 \x01word2<num>Gxxx</num>"""
    words = m.group(1).split()
    marked = " ".join(f"\x01{w}" for w in words)
    return f"{marked}<num>{m.group(2)}</num>"


def _mark_red_bare(m: re.Match) -> str:
    """<red>words</red> (no following num) → \x01word1 \x01word2"""
    words = m.group(1).split()
    return " ".join(f"\x01{w}" for w in words)


def parse_bbli(scripture: str) -> str:
    """Convert a bbli Scripture string to text_tagged format."""
    # Convert parenthetical Strongs to <paren> sentinel (preserving the number)
    text = RE_PAREN.sub(r'<paren>\1</paren>', scripture)
    text = RE_BOLD.sub(r"\1", text)   # <b>word</b> → word (psalm titles)
    # Mark red-letter words with \x01 sentinel BEFORE stripping tags.
    # Order matters: process <red>...</red><num>... first (most common), then bare.
    text = RE_RED_NUM.sub(_mark_red_with_num, text)
    text = RE_RED_BARE.sub(_mark_red_bare, text)

    tokens = []
    prev_strongs = ""  # track the last inline strongs for multi-strongs handling

    for m in RE_SEG.finditer(text):
        word_text = m.group(1)   # text before <num>
        strongs   = m.group(2)   # strongs number
        italic    = m.group(3)   # italic text
        paren     = m.group(4)   # parenthetical strongs (no English word)
        plain     = m.group(5)   # plain text (no following <num>)

        if strongs is not None:
            strongs = strongs.strip()
            if word_text is not None and word_text.strip():
                # Build tokens for each word; Strongs goes on the last word.
                # \x01 prefix = red-letter sentinel.
                words = word_text.strip().split()
                for i, w in enumerate(words):
                    is_red = w.startswith("\x01")
                    clean_w = w.lstrip("\x01")
                    if i == len(words) - 1 and strongs:
                        tokens.append(f"{'!' if is_red else ''}{clean_w}{{{strongs}}}")
                    else:
                        tokens.append(f"{'!' if is_red else ''}{clean_w}{{}}")
                prev_strongs = strongs
            else:
                # Standalone <num>strongs</num> — secondary Strongs for previous word.
                if prev_strongs in PREFIX_STRONGS and tokens:
                    # PREFIX swap: replace the prefix Strongs with this semantic root
                    last = tokens[-1]
                    brace = last.index("{")
                    word_part = last[:brace]
                    tokens[-1] = f"{word_part}{{{strongs}}}"
                elif prev_strongs and tokens:
                    # Multi-Strongs: append with | separator on the last token
                    last = tokens[-1]
                    brace = last.index("{")
                    inner = last[brace + 1:-1]   # content currently inside braces
                    word_part = last[:brace]
                    tokens[-1] = f"{word_part}{{{inner}|{strongs}}}"
                prev_strongs = ""

        elif paren is not None:
            # Parenthetical Strongs — grammatical particle, no corresponding English word
            tokens.append(f"~{{{paren.strip()}}}")
            prev_strongs = ""

        elif italic is not None:
            tokens.extend(word_tokens(italic, italic=True))
            prev_strongs = ""

        elif plain is not None:
            stripped = plain.strip()
            if stripped:
                # Handle red sentinel in plain text (words without following <num>)
                for w in stripped.split():
                    is_red = w.startswith("\x01")
                    clean_w = w.lstrip("\x01")
                    if clean_w:
                        tokens.append(f"{'!' if is_red else ''}{clean_w}{{}}")
            prev_strongs = ""

    return " ".join(tokens)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    bbli = sqlite3.connect(BBLI_PATH)
    kjva = sqlite3.connect(KJVA_PATH)
    kjva.execute("PRAGMA journal_mode=WAL")

    total = 0
    updated = 0
    errors = []

    bbli_verses = bbli.execute(
        "SELECT Book, Chapter, Verse, Scripture FROM Bible ORDER BY Book, Chapter, Verse"
    ).fetchall()

    print(f"Processing {len(bbli_verses)} verses from bbli...")

    updates = []
    for (bnum, ch, vs, scripture) in bbli_verses:
        book_id = BOOK_MAP.get(bnum)
        if not book_id:
            continue
        total += 1

        try:
            tagged = parse_bbli(scripture)
        except Exception as e:
            errors.append(f"{book_id} {ch}:{vs}: {e}")
            continue

        if tagged:
            updates.append((tagged, book_id, ch, vs))

    print(f"Parsed {total} verses. Applying updates...")

    kjva.executemany(
        "UPDATE verses SET text_tagged=? WHERE book_id=? AND chapter=? AND verse_num=?",
        updates
    )
    kjva.commit()
    updated = len(updates)

    print(f"Updated {updated} verses.")
    if errors:
        print(f"\n{len(errors)} parse errors:")
        for e in errors[:20]:
            print(f"  {e}")

    # Quick spot check
    print("\n── Spot checks ──")
    for (bid, ch, vs) in [("GEN", 1, 1), ("GEN", 1, 4), ("GEN", 1, 9), ("GEN", 1, 11),
                           ("JHN", 1, 14), ("JHN", 3, 16), ("EPH", 2, 8),
                           ("ROM", 6, 17), ("LUK", 6, 32)]:
        row = kjva.execute(
            "SELECT text_tagged FROM verses WHERE book_id=? AND chapter=? AND verse_num=?",
            (bid, ch, vs)
        ).fetchone()
        print(f"  {bid} {ch}:{vs}: {row[0] if row else 'NOT FOUND'}")

    kjva.close()
    bbli.close()


if __name__ == "__main__":
    main()
