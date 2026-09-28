/**
 * Tab-type switcher vocabulary (TEST25-NAV-001): the experience set, typed commands in both
 * searches, and current-tab (change this tab) vs new-tab behaviour.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { destinationSpecs, runDestination } from '../navigation/destinationQuery'
import { matchExperiences, otherExperiences, experienceOfTab, runExperience, SWITCHER_EXPERIENCES } from '../navigation/experiences'

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const bible: Tab = { id: 'b1', spaceId: 'scripture', type: 'bible', title: 'John 3', state: { bookId: 'JHN', chapter: 3, translation: 'KJVA', showStrongs: false, scrollPosition: 0 } }
const note: Tab = { id: 'n1', spaceId: 'notes', type: 'note', title: 'Notes', state: { noteId: null, isNew: false } } as Tab
function reset(active: Tab) {
  const tabs = [bible, note]
  const by = (sp: SpaceId) => tabs.filter((t) => t.spaceId === sp)
  useAppStore.setState({
    tabs: { scripture: by('scripture'), notes: by('notes'), lexicon: [], youtube: [], search: [] },
    activeTabId: { scripture: 'b1', notes: 'n1', lexicon: null, youtube: null, search: null },
    activeSpace: active.spaceId, currentSessionId: 's1', sessionDisplayOrders: { s1: ['b1', 'n1'] },
    tabMRUList: [], tabNavStacks: {}, isNavJumping: false, pendingNoteId: null,
  })
}
const count = () => SPACES.reduce((n, sp) => n + useAppStore.getState().tabs[sp].length, 0)
const active = () => { const s = useAppStore.getState(); return s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace])! }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('experience keywords', () => {
  it('names, synonyms and prefixes, case-insensitive', () => {
    expect(matchExperiences('Notes')).toEqual(['notes'])
    expect(matchExperiences('BIBLE')).toEqual(['scripture'])
    expect(matchExperiences('daily')).toEqual(['today'])
    expect(matchExperiences('today')).toEqual(['today'])
    expect(matchExperiences("Strong’s")).toEqual(['lexicon'])
    expect(matchExperiences('strongs')).toEqual(['lexicon'])
    expect(matchExperiences('videos')).toEqual(['youtube'])
    expect(matchExperiences('hist')).toEqual(['history'])
    expect(matchExperiences('se')).toEqual(['settings', 'search'])
    expect(matchExperiences('comp')).toEqual(['compare'])
  })
  it('one letter or an ordinary word matches nothing', () => {
    expect(matchExperiences('n')).toEqual([])
    expect(matchExperiences('grace')).toEqual([])
    expect(matchExperiences('in the beginning')).toEqual([])
  })
})

describe('destinationSpecs with experiences', () => {
  const ids = (q: string, t: 'new-tab' | 'current-tab', cur?: Parameters<typeof destinationSpecs>[2]) => destinationSpecs(q, t, cur).map((d) => d.id)
  it('text search stays primary; experiences follow it', () => {
    expect(ids('notes', 'new-tab')).toEqual(['search-new-tab', 'exp-notes'])
    expect(ids('settings', 'current-tab')).toEqual(['search-current-tab', 'exp-settings', 'search-new-tab'])
    expect(destinationSpecs('notes', 'new-tab').filter((d) => d.primary).map((d) => d.id)).toEqual(['search-new-tab'])
  })
  it('the caret does not offer the experience the tab already is', () => {
    expect(ids('notes', 'current-tab', 'notes')).toEqual(['search-current-tab', 'search-new-tab'])
    expect(ids('notes', 'current-tab', 'scripture')).toContain('exp-notes')
  })
  it('references and Strong\'s numbers are unchanged', () => {
    expect(ids('John 3:16', 'new-tab')).toEqual(['ref-new-tab', 'ref-current-tab', 'search-new-tab'])
    expect(ids('H7225', 'current-tab')).toEqual(['strongs-open', 'search-current-tab'])
  })
  it('labels are just the name', () => {
    expect(destinationSpecs('lexicon', 'current-tab').find((d) => d.id === 'exp-lexicon')?.label).toBe('Lexicon')
  })
})

describe('switcher set', () => {
  it('offers every other experience — Calendar in place of Today (SEP27-CAL-004); Compare offers Scripture', () => {
    expect(SWITCHER_EXPERIENCES).toEqual(['scripture', 'notes', 'calendar', 'lexicon', 'youtube', 'search', 'history', 'settings'])
    expect(SWITCHER_EXPERIENCES).not.toContain('today')
    expect(otherExperiences(bible)).not.toContain('scripture')
    expect(otherExperiences(note)).toEqual(['scripture', 'calendar', 'lexicon', 'youtube', 'search', 'history', 'settings'])
    const cal = { id: 'c1', spaceId: 'notes', type: 'calendar', title: 'Calendar', state: {} } as Tab
    expect(experienceOfTab(cal)).toBe('calendar')
    expect(otherExperiences(cal)).not.toContain('calendar')
    const compare = { ...bible, state: { ...bible.state, compareMode: true } } as Tab
    expect(experienceOfTab(compare)).toBe('compare')
    expect(otherExperiences(compare)).toContain('scripture')
  })
})

describe('running experiences', () => {
  it('current-tab changes this tab (no new tab), keeping its place', () => {
    reset(bible)
    runDestination('exp-lexicon', 'lexicon', 'current-tab')
    expect(count()).toBe(2)
    expect(active().type).toBe('lexicon')
    expect(useAppStore.getState().sessionDisplayOrders.s1[0]).toBe(active().id)
  })
  it('new-tab opens a new tab', () => {
    reset(bible)
    runDestination('exp-lexicon', 'lexicon', 'new-tab')
    expect(count()).toBe(3)
    expect(active().type).toBe('lexicon')
  })
  it('typed "calendar" (caret) turns this tab into the persistent Calendar tab; the plus opens a new one', () => {
    expect(matchExperiences('cal')).toEqual(['calendar'])
    reset(bible)
    runExperience('calendar', 'current-tab')
    expect(count()).toBe(2)
    expect(active().type).toBe('calendar')
    reset(bible)
    runExperience('calendar', 'new-tab')
    expect(count()).toBe(3)
    expect(active().type).toBe('calendar')
  })
  it('Compare turns a Notes tab into a Scripture compare tab; Scripture leaves Compare in place', () => {
    reset(note)
    runExperience('compare', 'current-tab')
    expect(count()).toBe(2)
    expect(active()).toMatchObject({ type: 'bible' })
    expect(active().state).toMatchObject({ compareMode: true })
    const id = active().id
    runExperience('scripture', 'current-tab')
    expect(active().id).toBe(id)
    expect(active().state).toMatchObject({ compareMode: false })
  })
})
