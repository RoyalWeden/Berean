/**
 * findLiveBoldSpans — the live-render bold (`**…**`) detector. Guards the Hosea 6:4
 * regression where plain text between two bold spans (each containing nested italics)
 * was incorrectly bolded.
 */
import { describe, it, expect } from 'vitest'
import { findLiveBoldSpans } from '../NoteEditor'

const spansText = (text: string) => findLiveBoldSpans(text).map((s) => text.slice(s.start, s.end))

describe('findLiveBoldSpans', () => {
  it('matches a simple bold span', () => {
    expect(spansText('a **bold** b')).toEqual(['**bold**'])
  })

  it('matches two separate bold spans without bolding the text between', () => {
    expect(spansText('x **one** middle **two** y')).toEqual(['**one**', '**two**'])
  })

  it('Hosea 6:4: two bold spans with nested italics, plain middle stays plain', () => {
    const md = 'for your goodness is as **<u>*a morning cloud*</u>**, and as the early dew **<u>*it goeth away*</u>**.'
    const spans = spansText(md)
    expect(spans).toEqual(['**<u>*a morning cloud*</u>**', '**<u>*it goeth away*</u>**'])
    // the plain connective text is not inside any matched bold span
    expect(spans.join(' ')).not.toContain('and as the early dew')
  })

  it('allows single inner * (nested italic) inside one bold span', () => {
    expect(spansText('**<u>*word*</u>**')).toEqual(['**<u>*word*</u>**'])
  })

  it('does not treat ***bold italic*** as a fast-path bold (left to syntax tree)', () => {
    expect(findLiveBoldSpans('***both***')).toEqual([])
  })

  it('ignores stray single asterisks', () => {
    expect(findLiveBoldSpans('a * b * c')).toEqual([])
  })
})
