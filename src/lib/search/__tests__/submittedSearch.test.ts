import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store'
import { recordSubmittedSearch, _resetSubmittedSearch } from '../submittedSearch'

const searches = () => useAppStore.getState().history.filter((h) => h.type === 'search').map((h) => h.query)

beforeEach(() => { _resetSubmittedSearch(); useAppStore.setState({ history: [] }) })

describe('search history = submitted searches', () => {
  it('records the submitted query, not one-letter input', () => {
    expect(recordSubmittedSearch('g')).toBe(false)
    expect(recordSubmittedSearch('good tidings')).toBe(true)
    expect(searches()).toEqual(['good tidings'])
  })
  it('keeps intentional repeats; only a same-second double fire counts once', () => {
    recordSubmittedSearch('good tidings', 1_000)
    recordSubmittedSearch('good tidings', 1_400)   // Return + immediate result click
    recordSubmittedSearch('gospel', 20_000)
    recordSubmittedSearch('good tidings', 40_000)
    expect(searches().length).toBe(3)
  })
})
