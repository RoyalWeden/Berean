import { describe, it, expect } from 'vitest'
import {
  matchesTitle, filterVideosBySearch, buildFtsMatch,
  titleScore, transcriptScore, rankVideosBySearch, highlightSnippet, decodeEntities,
  type SearchableVideo, type TranscriptMatchInfo,
} from '../youtubeSearch'

const v = (videoId: string, title: string, channelName = 'Chan', channelHandle = '@chan'): SearchableVideo =>
  ({ videoId, title, channelName, channelHandle })

describe('matchesTitle', () => {
  it('matches title substring (case-insensitive)', () => {
    expect(matchesTitle(v('a', 'Stop Calling him Jesus'), 'jesus')).toBe(true)
    expect(matchesTitle(v('a', 'Stop Calling him Jesus'), 'YESHUA')).toBe(false)
  })
  it('matches channel name and handle', () => {
    expect(matchesTitle(v('a', 'X', 'Matthew for Yeshua', '@matthewforyeshua'), 'matthew')).toBe(true)
    expect(matchesTitle(v('a', 'X', 'Matthew for Yeshua', '@matthewforyeshua'), '@matthewfor')).toBe(true)
  })
  it('empty query matches everything', () => {
    expect(matchesTitle(v('a', 'anything'), '')).toBe(true)
    expect(matchesTitle(v('a', 'anything'), '   ')).toBe(true)
  })
  it('no match returns false', () => {
    expect(matchesTitle(v('a', 'Genesis study'), 'exodus')).toBe(false)
  })
})

describe('filterVideosBySearch', () => {
  const videos = [
    v('v1', 'Genesis 1 study', 'Channel A', '@a'),
    v('v2', 'Random vlog', 'Channel B', '@b'),
    v('v3', 'Exodus notes', 'Channel C', '@c'),
  ]
  // v2 + v3 mention "covenant" in their transcripts
  const transcriptMatches = new Set(['v2', 'v3'])

  it('empty query returns all videos unchanged', () => {
    expect(filterVideosBySearch(videos, '', 'both', transcriptMatches)).toHaveLength(3)
    expect(filterVideosBySearch(videos, '   ', 'title', new Set())).toHaveLength(3)
  })

  it('title scope filters by title/channel only', () => {
    const r = filterVideosBySearch(videos, 'genesis', 'title', transcriptMatches)
    expect(r.map((x) => x.videoId)).toEqual(['v1'])
  })

  it('title scope ignores transcript matches', () => {
    // "covenant" is only in transcripts, so title scope finds nothing
    const r = filterVideosBySearch(videos, 'covenant', 'title', transcriptMatches)
    expect(r).toHaveLength(0)
  })

  it('transcript scope filters by transcript match set only', () => {
    const r = filterVideosBySearch(videos, 'covenant', 'transcript', transcriptMatches)
    expect(r.map((x) => x.videoId).sort()).toEqual(['v2', 'v3'])
  })

  it('transcript scope ignores title hits', () => {
    // "genesis" matches v1's title but no video's transcript matches → empty set passed
    const r = filterVideosBySearch(videos, 'genesis', 'transcript', new Set())
    expect(r).toHaveLength(0)
  })

  it('both scope unions title and transcript hits', () => {
    // "genesis" hits v1 title; transcript matches for this query are {v2, v3}
    const r = filterVideosBySearch(videos, 'genesis', 'both', transcriptMatches)
    expect(r.map((x) => x.videoId).sort()).toEqual(['v1', 'v2', 'v3'])
  })

  it('both scope dedupes when a video matches both title and transcript', () => {
    // "exodus" hits v3 title; transcript matches for this query are {v1, v3} → union {v1, v3}, v3 once
    const tm = new Set(['v1', 'v3'])
    const r = filterVideosBySearch(videos, 'exodus', 'both', tm)
    expect(r.map((x) => x.videoId).sort()).toEqual(['v1', 'v3'])
  })

  it('both scope returns nothing when neither title nor transcript matches', () => {
    // query matches no title and no transcript → empty set
    const r = filterVideosBySearch(videos, 'zzz-nomatch', 'both', new Set())
    expect(r).toHaveLength(0)
  })
})

describe('buildFtsMatch', () => {
  it('single token becomes a prefix term', () => {
    expect(buildFtsMatch('yeshua')).toBe('yeshua*')
  })
  it('multiple tokens are prefix-ANDed', () => {
    expect(buildFtsMatch('keep the commandments')).toBe('keep* the* commandments*')
  })
  it('lowercases tokens', () => {
    expect(buildFtsMatch('Yeshua MESSIAH')).toBe('yeshua* messiah*')
  })
  it('strips punctuation that would break FTS5 syntax', () => {
    expect(buildFtsMatch('"Jesus" (really)?')).toBe('jesus* really*')
    expect(buildFtsMatch('don\'t break')).toBe('don* t* break*')
  })
  it('handles unicode letters/numbers', () => {
    expect(buildFtsMatch('Exodus 20')).toBe('exodus* 20*')
  })
  it('empty / whitespace / punctuation-only query returns empty string', () => {
    expect(buildFtsMatch('')).toBe('')
    expect(buildFtsMatch('   ')).toBe('')
    expect(buildFtsMatch('?!.,')).toBe('')
  })
  it('does not allow a bare * (would be an FTS5 error)', () => {
    expect(buildFtsMatch('*')).toBe('')
  })
})

describe('titleScore', () => {
  const mk = (title: string, ch = 'Chan', h = '@chan'): SearchableVideo => ({ videoId: 'x', title, channelName: ch, channelHandle: h })
  it('ranks exact > starts-with > word > substring', () => {
    expect(titleScore(mk('Yeshua'), 'yeshua')).toBe(1000)
    expect(titleScore(mk('Yeshua is Lord'), 'yeshua')).toBe(600)
    expect(titleScore(mk('Behold Yeshua now'), 'yeshua')).toBe(400)
    expect(titleScore(mk('Yeshuahood'), 'yeshua')).toBe(600) // starts-with beats word
    expect(titleScore(mk('aYeshuab'), 'yeshua')).toBe(250)   // substring only
  })
  it('channel matches score below title matches', () => {
    expect(titleScore(mk('Random', 'Matthew for Yeshua', '@m'), 'yeshua')).toBe(150)
    expect(titleScore(mk('Random', 'xYeshuax', '@m'), 'yeshua')).toBe(100)
  })
  it('no match → 0; empty query → 0', () => {
    expect(titleScore(mk('Genesis'), 'exodus')).toBe(0)
    expect(titleScore(mk('Genesis'), '')).toBe(0)
  })
  it('handles regex-special characters in the query safely', () => {
    expect(titleScore(mk('cost is $5 (today)'), '$5')).toBeGreaterThan(0)
  })
})

describe('transcriptScore', () => {
  it('undefined info → 0', () => {
    expect(transcriptScore(undefined)).toBe(0)
  })
  it('stronger bm25 (more negative) scores higher', () => {
    const strong = transcriptScore({ rank: -8, matchCount: 1 })
    const weak = transcriptScore({ rank: -2, matchCount: 1 })
    expect(strong).toBeGreaterThan(weak)
  })
  it('more matches add a bounded frequency boost', () => {
    const few = transcriptScore({ rank: -5, matchCount: 1 })
    const many = transcriptScore({ rank: -5, matchCount: 10 })
    expect(many).toBeGreaterThan(few)
  })
  it('non-negative even for positive bm25 (clamped)', () => {
    expect(transcriptScore({ rank: 3, matchCount: 1 })).toBeGreaterThanOrEqual(0)
  })
})

describe('rankVideosBySearch', () => {
  const v = (videoId: string, title: string, published = '2024-01-01'): SearchableVideo & { published: string } =>
    ({ videoId, title, channelName: 'C', channelHandle: '@c', published })
  const videos = [v('v1', 'Random vlog'), v('v2', 'Yeshua teaching'), v('v3', 'About Yeshua and Torah')]

  it('empty query keeps original order', () => {
    const r = rankVideosBySearch(videos, '', 'both', new Map())
    expect(r.map((x) => x.videoId)).toEqual(['v1', 'v2', 'v3'])
  })

  it('title scope ranks best title match first', () => {
    // v2 "Yeshua teaching" starts-with > v3 word-match
    const r = rankVideosBySearch(videos, 'yeshua', 'title', new Map())
    expect(r[0].videoId).toBe('v2')
    expect(r.map((x) => x.videoId)).not.toContain(undefined)
  })

  it('transcript scope orders by transcript score', () => {
    const info = new Map<string, TranscriptMatchInfo>([
      ['v1', { rank: -9, matchCount: 5 }], // strongest transcript match
      ['v3', { rank: -3, matchCount: 1 }],
    ])
    const r = rankVideosBySearch(videos, 'covenant', 'transcript', info)
    expect(r[0].videoId).toBe('v1')
  })

  it('both scope: a video matching title AND transcript outranks title-only', () => {
    const info = new Map<string, TranscriptMatchInfo>([
      ['v3', { rank: -9, matchCount: 8 }], // v3 also has strong transcript hits
    ])
    const r = rankVideosBySearch(videos, 'yeshua', 'both', info)
    // v3 (title word-match 400 + strong transcript) should beat v2 (title 600 only) if transcript boost is big enough
    expect(r[0].videoId).toBe('v3')
  })

  it('does not mutate the input array', () => {
    const copy = [...videos]
    rankVideosBySearch(videos, 'yeshua', 'both', new Map())
    expect(videos).toEqual(copy)
  })

  it('ties break by newer published date', () => {
    const a = v('a', 'Yeshua', '2020-01-01')
    const b = v('b', 'Yeshua', '2024-06-01')
    const r = rankVideosBySearch([a, b], 'yeshua', 'title', new Map())
    expect(r[0].videoId).toBe('b') // same exact-title score → newer first
  })
})

describe('highlightSnippet', () => {
  it('splits matched terms into highlighted parts', () => {
    const parts = highlightSnippet('keep the commandments of God', 'commandments')
    const matched = parts.filter((p) => p.match).map((p) => p.text)
    expect(matched).toEqual(['commandments'])
    expect(parts.map((p) => p.text).join('')).toBe('keep the commandments of God')
  })

  it('highlights multiple tokens (case-insensitive)', () => {
    const parts = highlightSnippet('Keep the Commandments', 'keep commandments')
    const matched = parts.filter((p) => p.match).map((p) => p.text.toLowerCase())
    expect(matched).toEqual(['keep', 'commandments'])
  })

  it('truncates long snippets around the first match with ellipses', () => {
    const long = 'a '.repeat(120) + 'COVENANT here ' + 'b '.repeat(120)
    const parts = highlightSnippet(long, 'covenant', 60)
    const joined = parts.map((p) => p.text).join('')
    expect(joined.length).toBeLessThanOrEqual(64) // ~maxLen + ellipses
    expect(joined).toContain('…')
    expect(parts.some((p) => p.match && /covenant/i.test(p.text))).toBe(true)
  })

  it('no query or no snippet → single plain part', () => {
    expect(highlightSnippet('hello', '')).toEqual([{ text: 'hello', match: false }])
    expect(highlightSnippet('', 'x')).toEqual([{ text: '', match: false }])
  })

  it('rejoins to the (possibly truncated) text exactly', () => {
    const parts = highlightSnippet('the Sabbath day is holy', 'sabbath holy')
    expect(parts.map((p) => p.text).join('')).toBe('the Sabbath day is holy')
  })

  it('handles regex-special query characters', () => {
    const parts = highlightSnippet('price is $5 today', '$5')
    expect(parts.some((p) => p.match)).toBe(true)
  })
})

describe('decodeEntities', () => {
  it('decodes common named entities', () => {
    expect(decodeEntities('say &quot;hi&quot;')).toBe('say "hi"')
    expect(decodeEntities('rock &amp; roll')).toBe('rock & roll')
    expect(decodeEntities('a &lt; b &gt; c')).toBe('a < b > c')
  })
  it('decodes numeric entities (decimal + hex)', () => {
    expect(decodeEntities('it&#39;s')).toBe("it's")
    expect(decodeEntities('quote&#34;end')).toBe('quote"end')
    expect(decodeEntities('hex&#x27;test')).toBe("hex'test")
  })
  it('resolves double-encoded entities', () => {
    expect(decodeEntities('say &amp;quot;hi&amp;quot;')).toBe('say "hi"')
  })
  it('leaves plain text and unknown entities untouched', () => {
    expect(decodeEntities('no entities here')).toBe('no entities here')
    expect(decodeEntities('a & b')).toBe('a & b')
    expect(decodeEntities('&unknownentity;')).toBe('&unknownentity;')
  })
  it('fast-paths text with no ampersand', () => {
    expect(decodeEntities('clean text')).toBe('clean text')
    expect(decodeEntities('')).toBe('')
  })
})

describe('highlightSnippet decodes entities before highlighting', () => {
  it('shows decoded quotes and highlights the term', () => {
    const parts = highlightSnippet('keep the &quot;commandments&quot;', 'commandments')
    const joined = parts.map((p) => p.text).join('')
    expect(joined).toBe('keep the "commandments"')
    expect(parts.some((p) => p.match && p.text === 'commandments')).toBe(true)
  })
})
