import { describe, it, expect } from 'vitest'
import { filterCommands, type Command } from '../commands'

const commands: Command[] = [
  { id: 'toggle-strongs', label: "Toggle Strong's numbers", keywords: ['strongs', 'hebrew', 'greek'], run: () => {} },
  { id: 'new-note', label: 'New general note', run: () => {} },
  { id: 'open-settings', label: 'Open Settings', keywords: ['preferences'], run: () => {} },
]

describe('filterCommands', () => {
  it('returns everything when the query is empty', () => {
    expect(filterCommands(commands, '')).toHaveLength(3)
    expect(filterCommands(commands, '   ')).toHaveLength(3)
  })

  it('matches by label substring, case-insensitively', () => {
    expect(filterCommands(commands, 'strong').map((c) => c.id)).toEqual(['toggle-strongs'])
    expect(filterCommands(commands, 'STRONG').map((c) => c.id)).toEqual(['toggle-strongs'])
  })

  it('matches by keyword even when absent from the label', () => {
    expect(filterCommands(commands, 'hebrew').map((c) => c.id)).toEqual(['toggle-strongs'])
    expect(filterCommands(commands, 'preferences').map((c) => c.id)).toEqual(['open-settings'])
  })

  it('returns no matches for an unrelated query', () => {
    expect(filterCommands(commands, 'xyz123')).toEqual([])
  })
})
