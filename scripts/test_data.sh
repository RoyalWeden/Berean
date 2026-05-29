#!/usr/bin/env bash
# Data-layer smoke tests for Berean databases.
# Run from the project root: bash scripts/test_data.sh

set -euo pipefail

PASS=0; FAIL=0

ok()  { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail(){ echo "  ✗ $*"; FAIL=$((FAIL+1)); }

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then ok "$label"; else fail "$label  got='$got'  want='$want'"; fi
}

assert_gte() {
  local label="$1" got="$2" min="$3"
  if (( got >= min )); then ok "$label ($got ≥ $min)"; else fail "$label ($got < $min)"; fi
}

assert_nonempty() {
  local label="$1" got="$2"
  if [[ -n "$got" ]]; then ok "$label"; else fail "$label (empty)"; fi
}

echo ""
echo "=== kjva.db ==="

# Books count
cnt=$(sqlite3 data/kjva.db "SELECT COUNT(*) FROM books;" 2>/dev/null || echo 0)
assert_gte "books count (≥66)" "$cnt" 66

# OT book check
name=$(sqlite3 data/kjva.db "SELECT name FROM books WHERE id='GEN';" 2>/dev/null || echo "")
assert_nonempty "books.GEN exists" "$name"

# NT book check
name=$(sqlite3 data/kjva.db "SELECT name FROM books WHERE id='MAT';" 2>/dev/null || echo "")
assert_nonempty "books.MAT exists" "$name"

# Book rowid mapping: MAT rowid should be 54
rid=$(sqlite3 data/kjva.db "SELECT rowid FROM books WHERE id='MAT';" 2>/dev/null || echo 0)
assert_eq "MAT rowid=54" "$rid" "54"

rid=$(sqlite3 data/kjva.db "SELECT rowid FROM books WHERE id='REV';" 2>/dev/null || echo 0)
assert_eq "REV rowid=80" "$rid" "80"

rid=$(sqlite3 data/kjva.db "SELECT rowid FROM books WHERE id='GEN';" 2>/dev/null || echo 0)
assert_eq "GEN rowid=1" "$rid" "1"

rid=$(sqlite3 data/kjva.db "SELECT rowid FROM books WHERE id='MAL';" 2>/dev/null || echo 0)
assert_eq "MAL rowid=39" "$rid" "39"

# Apocrypha offset: 1ES should be rowid 40
rid=$(sqlite3 data/kjva.db "SELECT rowid FROM books WHERE id='1ES';" 2>/dev/null || echo 0)
assert_eq "1ES rowid=40" "$rid" "40"

# Verse count
vcnt=$(sqlite3 data/kjva.db "SELECT COUNT(*) FROM verses;" 2>/dev/null || echo 0)
assert_gte "verse count (≥30000)" "$vcnt" 30000

# Gen 1:1 text
gen11=$(sqlite3 data/kjva.db "SELECT text FROM verses WHERE book_id='GEN' AND chapter=1 AND verse_num=1;" 2>/dev/null || echo "")
assert_nonempty "GEN 1:1 text" "$gen11"

# Gen 1:1 tagged
gen11t=$(sqlite3 data/kjva.db "SELECT text_tagged FROM verses WHERE book_id='GEN' AND chapter=1 AND verse_num=1;" 2>/dev/null || echo "")
assert_nonempty "GEN 1:1 text_tagged" "$gen11t"

# H7225 in Gen 1:1 tagged
echo "$gen11t" | grep -q "H7225" && ok "GEN 1:1 has H7225 tag" || fail "GEN 1:1 missing H7225 tag"

# H8064 in Gen 1:1 tagged (heaven)
echo "$gen11t" | grep -q "H8064" && ok "GEN 1:1 has H8064 (heaven)" || fail "GEN 1:1 missing H8064"

# NT tagged coverage ≥ 75%
nt_tagged=$(sqlite3 data/kjva.db "SELECT COUNT(*) FROM verses WHERE book_id IN ('MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV') AND text_tagged IS NOT NULL AND text_tagged != '';" 2>/dev/null || echo 0)
nt_total=$(sqlite3 data/kjva.db "SELECT COUNT(*) FROM verses WHERE book_id IN ('MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV');" 2>/dev/null || echo 1)
pct=$(( nt_tagged * 100 / nt_total ))
assert_gte "NT text_tagged coverage ≥75%" "$pct" 75

echo ""
echo "=== strongs_hebrew.db ==="

hcnt=$(sqlite3 data/strongs_hebrew.db "SELECT COUNT(*) FROM entries;" 2>/dev/null || echo 0)
assert_gte "Hebrew entries (≥8000)" "$hcnt" 8000

h7225=$(sqlite3 data/strongs_hebrew.db "SELECT short_def FROM entries WHERE strongs_id='H7225';" 2>/dev/null || echo "")
assert_nonempty "H7225 entry" "$h7225"

# Hebrew occurrences
hocc=$(sqlite3 data/strongs_hebrew.db "SELECT COUNT(*) FROM occurrences WHERE strongs_id='H7225';" 2>/dev/null || echo 0)
assert_gte "H7225 occurrences (≥40)" "$hocc" 40

# H7225 book_num range: OT books are 1-39, should not exceed 39
hmax=$(sqlite3 data/strongs_hebrew.db "SELECT MAX(book_num) FROM occurrences WHERE strongs_id='H7225';" 2>/dev/null || echo 999)
if (( hmax <= 39 )); then ok "H7225 max book_num ≤39 ($hmax)"; else fail "H7225 max book_num $hmax > 39"; fi

echo ""
echo "=== strongs_greek.db ==="

gcnt=$(sqlite3 data/strongs_greek.db "SELECT COUNT(*) FROM entries;" 2>/dev/null || echo 0)
assert_gte "Greek entries (≥5500)" "$gcnt" 5500

g5485=$(sqlite3 data/strongs_greek.db "SELECT short_def FROM entries WHERE strongs_id='G5485';" 2>/dev/null || echo "")
assert_nonempty "G5485 entry" "$g5485"

gocc=$(sqlite3 data/strongs_greek.db "SELECT COUNT(*) FROM occurrences WHERE strongs_id='G5485';" 2>/dev/null || echo 0)
assert_gte "G5485 occurrences (≥80)" "$gocc" 80

# Greek NT book_nums should be 54-80 (kjva rowid range for NT)
gmin=$(sqlite3 data/strongs_greek.db "SELECT MIN(book_num) FROM occurrences WHERE strongs_id='G5485';" 2>/dev/null || echo 0)
gmax=$(sqlite3 data/strongs_greek.db "SELECT MAX(book_num) FROM occurrences WHERE strongs_id='G5485';" 2>/dev/null || echo 0)
if (( gmin >= 54 )); then ok "G5485 min book_num ≥54 ($gmin — NT range)"; else fail "G5485 min book_num $gmin < 54"; fi
if (( gmax <= 80 )); then ok "G5485 max book_num ≤80 ($gmax)"; else fail "G5485 max book_num $gmax > 80"; fi

# Key verse word index: Eph 2:8 "by grace" — grace carries G5485; "by" is untagged per bbli
eph28t=$(sqlite3 data/kjva.db "SELECT text_tagged FROM verses WHERE book_id='EPH' AND chapter=2 AND verse_num=8;" 2>/dev/null || echo "")
echo "$eph28t" | grep -q "grace{G5485}" && ok "EPH 2:8 grace{G5485}" || fail "EPH 2:8 missing grace{G5485}"

echo ""
echo "=== cross_references.db ==="

if [[ ! -f data/cross_references.db ]]; then
  fail "cross_references.db not found"
else
  crrows=$(sqlite3 data/cross_references.db "SELECT COUNT(*) FROM refs;" 2>/dev/null || echo 0)
  assert_gte "cross_references rows (≥300000)" "$crrows" 300000

  # GEN 1:1 should have cross-references
  gen11cr=$(sqlite3 data/cross_references.db "SELECT COUNT(*) FROM refs WHERE from_book='GEN' AND from_ch=1 AND from_vs=1;" 2>/dev/null || echo 0)
  assert_gte "GEN 1:1 cross-refs (≥1)" "$gen11cr" 1

  # JHN 3:16 cross-refs
  jhn316=$(sqlite3 data/cross_references.db "SELECT COUNT(*) FROM refs WHERE from_book='JHN' AND from_ch=3 AND from_vs=16;" 2>/dev/null || echo 0)
  assert_gte "JHN 3:16 cross-refs (≥5)" "$jhn316" 5

  # to_book IDs should match kjva.db book IDs
  topsa=$(sqlite3 data/cross_references.db "SELECT COUNT(*) FROM refs WHERE to_book='PSA';" 2>/dev/null || echo 0)
  assert_gte "refs to PSA (≥1000)" "$topsa" 1000

  topmat=$(sqlite3 data/cross_references.db "SELECT COUNT(*) FROM refs WHERE to_book='MAT';" 2>/dev/null || echo 0)
  assert_gte "refs to MAT (≥100)" "$topmat" 100

  # Verify no unknown book IDs (all should match kjva.db books)
  unknown=$(sqlite3 data/cross_references.db "
    SELECT COUNT(DISTINCT from_book) FROM refs
    WHERE from_book NOT IN (SELECT id FROM books);" 2>/dev/null || echo "?")
  # cross_references.db doesn't join to kjva.db — check with known ids
  bad_from=$(sqlite3 data/cross_references.db "SELECT DISTINCT from_book FROM refs WHERE from_book GLOB '[a-z]*' LIMIT 5;" 2>/dev/null || echo "")
  if [[ -z "$bad_from" ]]; then
    ok "cross_references from_book uses uppercase IDs"
  else
    fail "cross_references has lowercase from_book values: $bad_from"
  fi
fi

echo ""
echo "=== Word index alignment (spot checks) ==="

# Gen 1:1 H7225 should be at word index 2 ("beginning")
gen11txt=$(sqlite3 data/kjva.db "SELECT text FROM verses WHERE book_id='GEN' AND chapter=1 AND verse_num=1;" 2>/dev/null || echo "")
# Count words before "beginning" in "In the beginning God..."
word2=$(echo "$gen11txt" | awk '{print $3}' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z]//g')
assert_eq "GEN 1:1 word[2] = 'beginning'" "$word2" "beginning"

# Eph 2:8 G5485 should be at indices 1 (by) and 2 (grace)
eph28txt=$(sqlite3 data/kjva.db "SELECT text FROM verses WHERE book_id='EPH' AND chapter=2 AND verse_num=8;" 2>/dev/null || echo "")
word1=$(echo "$eph28txt" | awk '{print $2}' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z]//g')
word2=$(echo "$eph28txt" | awk '{print $3}' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z]//g')
assert_eq "EPH 2:8 word[1] = 'by'" "$word1" "by"
assert_eq "EPH 2:8 word[2] = 'grace'" "$word2" "grace"

echo ""
echo "=== Summary ==="
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo ""
if (( FAIL == 0 )); then
  echo "All tests passed."
else
  echo "Some tests FAILED. Review output above."
  exit 1
fi
