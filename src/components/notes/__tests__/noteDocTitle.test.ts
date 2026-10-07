import { describe, it, expect } from 'vitest'
import { contentStartsWithTitle } from '../NoteDocTitle'

describe('macOS note document title (TEST 2026-10-04)', () => {
  it('steps aside when the body already opens with # <title>', () => {
    expect(contentStartsWithTitle('# Keyboard Shortcuts\n\nBody', 'Keyboard Shortcuts')).toBe(true)
    expect(contentStartsWithTitle('---\ntype: general-note\n---\n\n#  keyboard   shortcuts\nx', 'Keyboard Shortcuts')).toBe(true)
  })
  it('shows for every other note', () => {
    expect(contentStartsWithTitle('TestFlight iCloud test', 'Test Note')).toBe(false)
    expect(contentStartsWithTitle('## Keyboard Shortcuts', 'Keyboard Shortcuts')).toBe(false)
    expect(contentStartsWithTitle('# Other heading', 'Keyboard Shortcuts')).toBe(false)
    expect(contentStartsWithTitle('', 'X')).toBe(false)
  })
})
