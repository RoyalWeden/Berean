import { describe, it, expect } from 'vitest'
import {
  decodeHtmlEntities, parseTsMs, fillDurations,
  captionTracksFromPlayer, selectCaptionTrack, timedTextUrl,
  parseJson3, parseTimedTextXml, parseTimedText,
  createStabilityTracker,
  isTransientTranscriptError, transcriptFetchPriority, TRANSCRIPT_RETRY_DAYS,
  type CaptionTrack,
} from '../ipc/youtubeTranscriptCore'

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeHtmlEntities('&quot;hi&quot; &apos;there&apos;')).toBe(`"hi" 'there'`)
  })

  it('decodes numeric and hex entities', () => {
    expect(decodeHtmlEntities('&#39;quote&#39;')).toBe(`'quote'`)
    expect(decodeHtmlEntities('&#x27;quote&#x27;')).toBe(`'quote'`)
  })

  it('decodes double-encoded entities', () => {
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&')
  })

  it('leaves plain text untouched and is a no-op fast path with no ampersand', () => {
    expect(decodeHtmlEntities('no entities here')).toBe('no entities here')
    expect(decodeHtmlEntities('')).toBe('')
  })
})

describe('parseTsMs', () => {
  it('parses HH:MM:SS.mmm into milliseconds', () => {
    expect(parseTsMs('00:00:00.000')).toBe(0)
    expect(parseTsMs('00:01:02.500')).toBe(62_500)
    expect(parseTsMs('01:00:00.000')).toBe(3_600_000)
  })
})

describe('fillDurations', () => {
  it('fills each segment dur_ms from the next segment start, leaving the last as-is', () => {
    const segs = [
      { start_ms: 0, dur_ms: 0, text: 'a' },
      { start_ms: 1000, dur_ms: 0, text: 'b' },
      { start_ms: 2500, dur_ms: 0, text: 'c' },
    ]
    const out = fillDurations(segs)
    expect(out[0].dur_ms).toBe(1000)
    expect(out[1].dur_ms).toBe(1500)
    expect(out[2].dur_ms).toBe(0)
  })

  it('does not override an already-set duration', () => {
    const segs = [{ start_ms: 0, dur_ms: 500, text: 'a' }, { start_ms: 1000, dur_ms: 0, text: 'b' }]
    expect(fillDurations(segs)[0].dur_ms).toBe(500)
  })
})

describe('caption track selection', () => {
  const manualEn: CaptionTrack = { baseUrl: 'https://x/en', languageCode: 'en' }
  const manualEnUS: CaptionTrack = { baseUrl: 'https://x/en-US', languageCode: 'en-US' }
  const asrEn: CaptionTrack = { baseUrl: 'https://x/asr-en', languageCode: 'en', kind: 'asr' }
  const manualEs: CaptionTrack = { baseUrl: 'https://x/es', languageCode: 'es', isTranslatable: true }
  const manualFr: CaptionTrack = { baseUrl: 'https://x/fr', languageCode: 'fr' }

  it('pulls captionTracks out of an InnerTube player response', () => {
    const player = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [manualEn] } } }
    expect(captionTracksFromPlayer(player)).toEqual([manualEn])
  })

  it('returns [] when there are no tracks / malformed response', () => {
    expect(captionTracksFromPlayer({})).toEqual([])
    expect(captionTracksFromPlayer(null)).toEqual([])
    expect(captionTracksFromPlayer({ captions: {} })).toEqual([])
  })

  it('returns null for an empty track list', () => {
    expect(selectCaptionTrack([])).toBeNull()
  })

  it('prefers manual English, plain "en" over regional "en-US"', () => {
    const choice = selectCaptionTrack([manualEnUS, manualEn])
    expect(choice).toEqual({ track: manualEn, lang: 'en', kind: 'manual' })
  })

  it('prefers manual English over English ASR', () => {
    const choice = selectCaptionTrack([asrEn, manualEn])
    expect(choice?.kind).toBe('manual')
    expect(choice?.track).toBe(manualEn)
  })

  it('falls back to English ASR when no manual English track exists', () => {
    const choice = selectCaptionTrack([manualFr, asrEn])
    expect(choice).toEqual({ track: asrEn, lang: 'en', kind: 'asr' })
  })

  it('falls back to a translatable non-English track with tlang=en', () => {
    const choice = selectCaptionTrack([manualFr, manualEs])
    expect(choice?.kind).toBe('translated')
    expect(choice?.translateTo).toBe('en')
    expect(choice?.track).toBe(manualEs)
  })

  it('falls back to the first track as-is when nothing else matches', () => {
    const choice = selectCaptionTrack([manualFr])
    expect(choice).toEqual({ track: manualFr, lang: 'fr', kind: 'manual' })
  })

  it('builds a timedtext URL with fmt=json3 and optional tlang', () => {
    const url = timedTextUrl({ track: manualEs, translateTo: 'en', lang: 'en', kind: 'translated' }, 'json3')
    expect(url).toContain('fmt=json3')
    expect(url).toContain('tlang=en')
  })

  it('omits fmt when null (xml/srv3 fallback)', () => {
    const url = timedTextUrl({ track: manualEn, lang: 'en', kind: 'manual' }, null)
    expect(url).not.toContain('fmt=')
  })
})

describe('parseJson3', () => {
  it('parses events with segs into segments, skipping window/style events with no segs', () => {
    const body = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 500 }, // style/window event, no segs
        { tStartMs: 1000, dDurationMs: 1200, segs: [{ utf8: '\n' }] }, // blank after trim
        { tStartMs: 2000, dDurationMs: 800, segs: [{ utf8: 'Second &amp; line' }] },
      ],
    })
    const segs = parseJson3(body)
    expect(segs).toEqual([
      { start_ms: 0, dur_ms: 1000, text: 'Hello world' },
      { start_ms: 2000, dur_ms: 800, text: 'Second & line' },
    ])
  })

  it('returns [] on invalid JSON or missing events', () => {
    expect(parseJson3('not json')).toEqual([])
    expect(parseJson3(JSON.stringify({}))).toEqual([])
  })

  it('accepts an already-parsed object', () => {
    const segs = parseJson3({ events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'hi' }] }] })
    expect(segs).toEqual([{ start_ms: 0, dur_ms: 500, text: 'hi' }])
  })
})

describe('parseTimedTextXml', () => {
  it('parses the classic <transcript><text start dur> format (seconds)', () => {
    const xml = `<?xml version="1.0"?><transcript>
      <text start="1.5" dur="2.5">Hello &amp; welcome</text>
      <text start="4" dur="3">Second line</text>
    </transcript>`
    expect(parseTimedTextXml(xml)).toEqual([
      { start_ms: 1500, dur_ms: 2500, text: 'Hello & welcome' },
      { start_ms: 4000, dur_ms: 3000, text: 'Second line' },
    ])
  })

  it('parses srv3 <timedtext><body><p t d> format (ms), stripping <s> word children', () => {
    const xml = `<timedtext format="3"><body>
      <p t="1000" d="2000"><s>Hello</s> <s>world</s></p>
      <p t="3000" d="1500">Plain<br/>break</p>
    </body></timedtext>`
    expect(parseTimedTextXml(xml)).toEqual([
      { start_ms: 1000, dur_ms: 2000, text: 'Hello world' },
      { start_ms: 3000, dur_ms: 1500, text: 'Plain break' },
    ])
  })

  it('returns [] for empty/non-string input', () => {
    expect(parseTimedTextXml('')).toEqual([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseTimedTextXml(null as any)).toEqual([])
  })

  it('parseTimedText dispatches on body shape', () => {
    expect(parseTimedText('{"events":[{"tStartMs":0,"dDurationMs":500,"segs":[{"utf8":"hi"}]}]}'))
      .toEqual([{ start_ms: 0, dur_ms: 500, text: 'hi' }])
    expect(parseTimedText('<transcript><text start="0" dur="1">hi</text></transcript>'))
      .toEqual([{ start_ms: 0, dur_ms: 1000, text: 'hi' }])
    expect(parseTimedText('garbage')).toEqual([])
  })
})

describe('createStabilityTracker', () => {
  it('does not accept until the count has held for `required` consecutive observations', () => {
    const t = createStabilityTracker(3)
    expect(t.observe(5)).toBe(false)  // 1st time seeing 5
    expect(t.observe(40)).toBe(false) // still growing — resets streak
    expect(t.observe(212)).toBe(false)
    expect(t.observe(212)).toBe(false) // 2nd consecutive 212
    expect(t.observe(212)).toBe(true)  // 3rd consecutive 212 — stable
  })

  it('never accepts a count of zero', () => {
    const t = createStabilityTracker(2)
    expect(t.observe(0)).toBe(false)
    expect(t.observe(0)).toBe(false)
  })

  it('a growth spike after stabilising resets the streak', () => {
    const t = createStabilityTracker(2)
    expect(t.observe(10)).toBe(false)
    expect(t.observe(10)).toBe(true)
    expect(t.observe(11)).toBe(false) // grew again — must re-stabilise
    expect(t.observe(11)).toBe(true)
  })
})

describe('isTransientTranscriptError', () => {
  it('flags rate-limit / server / network / timeout style errors as transient', () => {
    for (const msg of [
      'API 429', 'no transcript (API 429)', 'HTTP 503', 'timeout after 30 attempts',
      'timed out', 'network error', 'fetch failed', 'rate-limited', 'rate limit exceeded', 'aborted',
    ]) {
      expect(isTransientTranscriptError(msg)).toBe(true)
    }
  })

  it('does not flag a genuine no-captions signal (418) as transient', () => {
    expect(isTransientTranscriptError('no transcript (API 418)')).toBe(false)
    expect(isTransientTranscriptError('no transcript available')).toBe(false)
  })
})

describe('transcriptFetchPriority', () => {
  const now = Date.parse('2026-09-30T00:00:00Z')

  it('never-attempted video gets top priority', () => {
    expect(transcriptFetchPriority({ hasRow: false, error: null, fetched_at: null, segment_count: null }, now)).toBe(0)
  })

  it('a stored success with segments is not eligible', () => {
    expect(transcriptFetchPriority({ hasRow: true, error: null, fetched_at: now, segment_count: 42 }, now)).toBeNull()
  })

  it('a stored "success" with zero segments is retried', () => {
    expect(transcriptFetchPriority({ hasRow: true, error: null, fetched_at: now, segment_count: 0 }, now)).toBe(1)
  })

  it('a transient stored error is always retryable, regardless of age', () => {
    const veryOld = now - 365 * 86_400_000
    expect(transcriptFetchPriority({ hasRow: true, error: 'no transcript (API 429)', fetched_at: now, segment_count: 0 }, now)).toBe(1)
    expect(transcriptFetchPriority({ hasRow: true, error: 'no transcript (API 429)', fetched_at: veryOld, segment_count: 0 }, now)).toBe(1)
  })

  it('a permanent-looking stored error is NOT retryable before TRANSCRIPT_RETRY_DAYS', () => {
    const recent = now - 1 * 86_400_000
    expect(transcriptFetchPriority({ hasRow: true, error: 'no transcript (API 418)', fetched_at: recent, segment_count: 0 }, now)).toBeNull()
  })

  it('a permanent-looking stored error IS retryable once past TRANSCRIPT_RETRY_DAYS', () => {
    const old = now - (TRANSCRIPT_RETRY_DAYS + 1) * 86_400_000
    expect(transcriptFetchPriority({ hasRow: true, error: 'no transcript (API 418)', fetched_at: old, segment_count: 0 }, now)).toBe(2)
  })
})
