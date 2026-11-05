#!/usr/bin/env python3
"""Independent HOLDOUT set (spec §10.2) — written 2026-10-28 AFTER the Phase 1–2 rules and
before any Phase 3 tuning; frozen by SHA-256 in HOLDOUT.lock. Not used to write router rules,
prompts, follow-up rules or ranking. Same case schema as cases.jsonl; ids start with X.

Gold refs / Strong's ids are validated against data/*.db by validate_cases.py (run with
--file holdout.jsonl). Topical gold sets are the author's judgement → human_review=True.
"""
import json
from pathlib import Path

OUT = Path(__file__).with_name('holdout3.jsonl')
cases = []

def C(id, section, category, q, *, on=False, deep=False, hist=None, intent='verses', gold=None, gold_any=None,
      strongs=None, mustnot=None, rules=None, crit=None, review=False, tabref=None, tab=False):
    hist = hist or []
    cases.append({
        'id': id, 'section': section, 'category': category, 'commentary_expected': on,
        'mode': ('deep' if deep else 'commentary') if on else ('deep-off' if deep else 'passages'),
        'switches': {'commentary': on, 'deepSearch': deep, 'tabContext': tab}, 'question': q,
        'user_turns': [t[1] for t in hist if t[0] == 'user'] + [q], 'assistant_turns': [t[1] for t in hist if t[0] == 'assistant'],
        'history': [{'role': r, 'content': c} for r, c in hist], 'tab': tabref, 'fixture_data': {},
        'expected_intent': intent, 'expected_tools': [], 'gold_references': gold or [], 'gold_any': gold_any or [],
        'gold_strongs': strongs or [], 'must_include': [], 'must_not_include': mustnot or [], 'expected_count': None,
        'cover_groups': [], 'scoring_rules': rules or [], 'critical_failure_flags': crit or ['fabricated_ref', 'fabricated_strongs'],
        'human_review': review, 'platform': 'mac', 'static_check': None, 'multi_turn': bool(hist),
    })

NC = ['no_unsolicited_commentary']
M, L, P = 'ZM', 'ZL', 'ZP'
h = lambda *t: list(t)
C('Z001', L, 'english', 'Greek word used for "light" in John 1', intent='strongs', strongs=['G5457'], rules=['strongs_card_or_list'] + NC)
C('Z002', L, 'english', 'tell me the Hebrew noun for heart', intent='strongs', strongs=['H3820', 'H3824'], rules=['strongs_card_or_list'] + NC)
C('Z003', L, 'translit', 'meaning of emunah', intent='strongs', strongs=['H530'], rules=['strongs_card_or_list'] + NC)
C('Z004', L, 'translit', 'what is koinonia', intent='strongs', strongs=['G2842'], rules=['strongs_card_or_list'] + NC)
C('Z005', L, 'script', 'אמת', intent='strongs', strongs=['H571'], rules=['strongs_card_or_list'] + NC)
C('Z006', L, 'script', 'πίστις', intent='strongs', strongs=['G4102'], rules=['strongs_card_or_list'] + NC)
C('Z007', L, 'id-occ', 'count the uses of G4151 in Romans', intent='strongs_occurrences', strongs=['G4151'], rules=['strongs_card_or_list', 'scope_book:ROM'] + NC)
C('Z008', L, 'table', 'give me the Strong\'s breakdown of Exodus 20:8', intent='word_tags', gold=['EXO 20:8'], rules=['word_tag_table'] + NC)
C('Z009', L, 'compare', 'how do G26 and G5368 differ', intent='strongs', strongs=['G26', 'G5368'], rules=['strongs_card_or_list'] + NC)
C('Z010', L, 'verse-word', "which Hebrew word is 'remember' in Exodus 20:8", intent='strongs', strongs=['H2142'], rules=['strongs_card_or_list'] + NC)
C('Z020', M, 'lang', 'now the Greek', hist=h(('user', 'the Hebrew word for truth'), ('assistant', "Strong's H571 emeth")), intent='strongs', strongs=['G225'], rules=['strongs_card_or_list'] + NC)
C('Z021', M, 'lang', "what's the Hebrew counterpart?", hist=h(('user', 'Greek word for spirit'), ('assistant', "Strong's G4151 pneuma")), intent='strongs', strongs=['H7307'], rules=['strongs_card_or_list'] + NC)
C('Z022', M, 'occ', 'where else is that one found', hist=h(('user', 'H2617'), ('assistant', "Strong's H2617 cheçed")), intent='strongs_occurrences', strongs=['H2617'], rules=['strongs_card_or_list'] + NC)
C('Z023', M, 'occ-book', 'any in Proverbs?', hist=h(('user', 'the Hebrew word for wisdom'), ('assistant', "Strong's H2451 chokmah")), intent='strongs_occurrences', strongs=['H2451'], rules=['strongs_card_or_list', 'scope_book:PRO'] + NC)
C('Z024', M, 'swap', 'do grace next', hist=h(('user', 'the Greek word for faith'), ('assistant', "Strong's G4102 pistis")), intent='strongs', strongs=['G5485'], rules=['strongs_card_or_list'] + NC)
C('Z025', M, 'more', 'show me others like these', hist=h(('user', 'verses about the shepherd'), ('assistant', 'Passages: Psalms 23:1; John 10:11')), gold_any=['EZK 34:12', 'ISA 40:11', 'JHN 10:14', '1PE 5:4', 'HEB 13:20'], mustnot=['PSA 23:1', 'JHN 10:11'], rules=['any_gold_top5'] + NC, review=True)
C('Z026', M, 'limit', 'only the top two', hist=h(('user', 'verses about the jubilee'), ('assistant', 'Passages: Leviticus 25:10; Leviticus 25:11; Leviticus 25:12')), gold_any=['LEV 25:10', 'LEV 25:11'], rules=['any_gold_top3'] + NC)
C('Z027', M, 'table', 'word by word for that verse', hist=h(('user', 'John 11:35'), ('assistant', 'Passages: John 11:35')), intent='word_tags', gold=['JHN 11:35'], rules=['word_tag_table'] + NC)
C('Z028', M, 'lxx', 'what does the Septuagint have there', hist=h(('user', 'Genesis 1:2'), ('assistant', 'Passages: Genesis 1:2')), gold_any=['lxx:GEN 1:2'], rules=['any_gold_top3'] + NC)
C('Z029', M, 'corpus', 'check Jubilees too', hist=h(('user', 'verses about the sabbath'), ('assistant', 'Passages: Exodus 20:8')), gold_any=['jubilees:JUB 2:17', 'jubilees:JUB 2:18', 'jubilees:JUB 50:6', 'jubilees:JUB 2:21'], rules=['any_gold_top5', 'scope_text:jubilees'] + NC, review=True)
C('Z040', P, 'paraphrase', 'verses about God being near to the brokenhearted', gold_any=['PSA 34:18', 'PSA 147:3', 'ISA 61:1'], rules=['any_gold_top5'] + NC, review=True)
C('Z041', P, 'paraphrase', 'where does it say not to be unequally yoked', gold_any=['2CO 6:14'], rules=['any_gold_top3'] + NC)
C('Z042', P, 'paraphrase', 'the bit about faith without works being dead', gold_any=['JAS 2:17', 'JAS 2:26', 'JAS 2:20'], rules=['any_gold_top3'] + NC)
C('Z043', P, 'law', 'laws about not charging interest to the poor', gold_any=['EXO 22:25', 'LEV 25:36', 'DEU 23:19'], rules=['any_gold_top5'] + NC, review=True)
C('Z044', P, 'event', 'when the walls of Jericho fell', gold_any=['JOS 6:20'], rules=['any_gold_top3'] + NC)
C('Z045', P, 'person', 'the story of Ruth gleaning in Boaz\'s field', gold_any=['RUT 2:3', 'RUT 2:2', 'RUT 2:8'], rules=['any_gold_top5'] + NC)
C('Z046', P, 'zero-overlap', 'scripture for a grieving parent', gold_any=['2SA 12:23', 'PSA 34:18', 'MAT 5:4', 'REV 21:4', 'JER 31:15'], rules=['any_gold_top5'] + NC, review=True)
C('Z047', P, 'negation', 'verses about rest that are not about the sabbath day', gold_any=['MAT 11:28', 'PSA 23:2', 'HEB 4:9', 'PSA 62:1', 'EXO 33:14'], mustnot=['EXO 20:8', 'EXO 31:16'], rules=['any_gold_top5'] + NC, review=True)
C('Z048', P, 'scope', 'Proverbs only, verses about laziness', gold_any=['PRO 6:6', 'PRO 24:30', 'PRO 26:14', 'PRO 19:15', 'PRO 13:4'], rules=['any_gold_top5', 'scope_book:PRO'] + NC, review=True)
C('Z049', P, 'false-premise', 'which verse says money is the root of all evil', gold_any=['1TI 6:10'], rules=['any_gold_top3', 'correct_premise'] + NC, review=True)

OUT.write_text(''.join(json.dumps(c, ensure_ascii=False) + '\n' for c in cases))
print(f'{len(cases)} holdout3 cases')
