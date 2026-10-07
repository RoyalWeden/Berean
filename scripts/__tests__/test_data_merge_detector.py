"""Unit tests for scripts/data_merge_detector.py — pure, no DB required for
most cases; a couple of tests build a tiny in-memory sqlite DB mirroring the
real verses/verses_fts schema to exercise scan_book end-to-end, including
idempotence after scripts/fix_enoch_merged_verses.py-style splitting.

Run with: python3 -m unittest scripts.__tests__.test_data_merge_detector -v
(from the repo root), or plain `python3 scripts/__tests__/test_data_merge_detector.py`.
"""
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from data_merge_detector import classify_text, scan_book  # noqa: E402


class ClassifyTextTests(unittest.TestCase):
    def test_clean_row_has_no_reasons(self):
        text = "And thence I went to another place, and he showed me a great mountain."
        self.assertEqual(classify_text(text), [])

    def test_marker_split_detects_inline_verse_marker(self):
        # Mirrors the real ch39:5 corruption: a later verse's marker ("6a.")
        # embedded mid-string, immediately followed by capitalised prose.
        text = (
            "Here mine eyes saw their dwellings. 6a. And in that place mine "
            "eyes saw the Elect One of righteousness and of faith,"
        )
        reasons = classify_text(text)
        self.assertIn("inline-verse-marker", reasons)

    def test_sub_verse_letters_alone_do_not_confuse_digit_marker(self):
        # A lone continuation letter ("b.") is not itself flagged by the
        # digit-marker regex (by design — see CONTINUATION_LETTER_RE) but a
        # nearby digit marker in the same merged row still trips detection.
        text = "Intro line. 6a. First part, b. Second part, c. Third part. 7. Next verse content here."
        reasons = classify_text(text)
        self.assertIn("inline-verse-marker", reasons)

    def test_double_pipe_cleanup_marker_detected(self):
        text = (
            "Then I asked regarding it: 'Why is one separated from the other?' "
            "|| 8. Then I asked regarding all the hollow places. |}"
        )
        reasons = classify_text(text)
        self.assertIn("double-pipe", reasons)
        self.assertIn("wikitable-markup", reasons)

    def test_heading_leak_detected(self):
        text = (
            "And He sware by His great name that this shall be a pledge of "
            "good faith between Me and them for ever. LV. 3-LVI. 4. Final "
            "Judgement of Azazel, the Watchers and their children."
        )
        reasons = classify_text(text)
        self.assertIn("heading-leak", reasons)

    def test_clean_row_after_split_has_no_reasons(self):
        # Post-fix state: the marker and the "||" tail are both gone.
        text = "Then I asked regarding all the hollow places: 'Why is one separated from the other?'"
        self.assertEqual(classify_text(text), [])


class ScanBookIdempotenceTests(unittest.TestCase):
    """Builds a minimal in-memory DB with the same verses/verses_fts shape
    as data/enoch.db and checks that scan_book flags the corrupted row,
    and reports zero anomalies once it's been split — the same idempotence
    property fix_enoch_merged_verses.py relies on."""

    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        cur = self.conn.cursor()
        cur.executescript(
            """
            CREATE TABLE books (
                id TEXT PRIMARY KEY, name TEXT, short_name TEXT,
                testament TEXT, chapters_count INTEGER
            );
            CREATE TABLE verses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id TEXT NOT NULL, chapter INTEGER NOT NULL,
                verse_num INTEGER NOT NULL, text TEXT NOT NULL,
                UNIQUE(book_id, chapter, verse_num)
            );
            INSERT INTO books VALUES ('TST', 'Test Book', 'Tst', 'Pseudepigrapha', 1);
            """
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_merged_row_flagged_then_clean_after_split(self):
        cur = self.conn.cursor()
        cur.execute(
            "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?,?,?,?)",
            ("TST", 1, 5, "First sentence here. 6. Second sentence, entirely distinct."),
        )
        self.conn.commit()
        anomalies = list(scan_book(self.conn, "TST"))
        self.assertEqual(len(anomalies), 1)
        self.assertIn("inline-verse-marker", anomalies[0].reasons)

        # Simulate the fix: split at the marker into two rows.
        cur.execute("DELETE FROM verses WHERE book_id='TST' AND chapter=1 AND verse_num=5")
        cur.execute(
            "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?,?,?,?)",
            ("TST", 1, 5, "First sentence here."),
        )
        cur.execute(
            "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?,?,?,?)",
            ("TST", 1, 6, "Second sentence, entirely distinct."),
        )
        self.conn.commit()
        anomalies_after = list(scan_book(self.conn, "TST"))
        self.assertEqual(anomalies_after, [])

    def test_rerunning_scan_on_already_clean_book_is_a_no_op(self):
        cur = self.conn.cursor()
        cur.execute(
            "INSERT INTO verses(book_id, chapter, verse_num, text) VALUES (?,?,?,?)",
            ("TST", 1, 1, "A perfectly ordinary verse with no markers at all."),
        )
        self.conn.commit()
        first = list(scan_book(self.conn, "TST"))
        second = list(scan_book(self.conn, "TST"))
        self.assertEqual(first, [])
        self.assertEqual(second, [])


if __name__ == "__main__":
    unittest.main()
