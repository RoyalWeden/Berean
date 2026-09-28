/** NOTES-HOME-001…004 — the Notes Home model: folder tree, locations, sections, rows, search, prefs. */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Note, NoteFolder } from '@/types'
import {
  buildFolderTree, findFolderNode, subtreeIds, visibleFolderRows, folderPathLabel, notesAt, systemFolderCounts, locationTitle, parentLocation,
  folderViewSections, firstImageSrc, notePreviewText, matchFolders, notesHomePrefs, sectionCollapse, matchesFilter,
} from '../notesHomeModel'

const now = new Date(2026, 8, 28, 10, 0).getTime()
const day = 24 * 3600 * 1000
let seq = 0
const note = (p: Partial<Note> = {}): Note => ({
  id: `n${++seq}`, type: 'general', title: `Note ${seq}`, content: '', createdAt: now - day, updatedAt: now - day, tags: [], folderId: null, pinned: false, ...p,
} as Note)
const folder = (id: string, name: string, parentId: string | null = null): NoteFolder => ({ id, name, parentId, createdAt: 0 })

const folders = [folder('a', 'Sermons'), folder('b', 'Torah', 'a'), folder('c', 'Feasts', 'b'), folder('d', 'Apologetics')]

describe('folder tree', () => {
  it('nests folders, sorts siblings A–Z and counts notes recursively', () => {
    const notes = [note({ folderId: 'a' }), note({ folderId: 'b' }), note({ folderId: 'c' }), note({ folderId: 'c' }), note()]
    const tree = buildFolderTree(folders, notes)
    expect(tree.map((n) => n.folder.name)).toEqual(['Apologetics', 'Sermons'])
    const sermons = findFolderNode(tree, 'a')!
    expect(sermons.direct).toBe(1)
    expect(sermons.total).toBe(4)
    expect(findFolderNode(tree, 'c')!.depth).toBe(2)
  })
  it('a folder with a missing parent becomes a root; a parent cycle cannot hide or duplicate a folder', () => {
    const tree = buildFolderTree([folder('x', 'Orphan', 'gone'), folder('p', 'P', 'q'), folder('q', 'Q', 'p')], [])
    const ids: string[] = []
    const walk = (ns: typeof tree) => ns.forEach((n) => { ids.push(n.folder.id); walk(n.children) })
    walk(tree)
    expect(ids.sort()).toEqual(['p', 'q', 'x'])
  })
  it('collapsed folders hide their children; expanded ones show them in order', () => {
    const tree = buildFolderTree(folders, [])
    expect(visibleFolderRows(tree, new Set()).map((n) => n.folder.id)).toEqual(['d', 'a'])
    expect(visibleFolderRows(tree, new Set(['a', 'b'])).map((n) => n.folder.id)).toEqual(['d', 'a', 'b', 'c'])
  })
  it('a folder cannot move into itself or a descendant', () => {
    const tree = buildFolderTree(folders, [])
    expect([...subtreeIds(findFolderNode(tree, 'a')!)].sort()).toEqual(['a', 'b', 'c'])
  })
  it('path labels and back navigation follow the parents', () => {
    expect(folderPathLabel('c', folders)).toBe('Sermons / Torah / Feasts')
    expect(parentLocation('c', folders)).toBe('b')
    expect(parentLocation('a', folders)).toBeNull()
    expect(parentLocation('all', folders)).toBeNull()
    expect(parentLocation('sys:daily', folders)).toBeNull()
  })
})

describe('locations', () => {
  it('All Notes is every note; system folders hold unfiled notes of their kind; a folder its own notes', () => {
    const daily = note({ type: 'daily', title: 'Daily — 2026-09-28' })
    const verse = note({ type: 'verse', verseRef: 'MAT.5.3' })
    const filedVerse = note({ type: 'verse', verseRef: 'MAT.5.4', folderId: 'a' })
    const general = note({ folderId: 'd' })
    const all = [daily, verse, filedVerse, general]
    expect(notesAt('all', all)).toHaveLength(4)
    expect(notesAt('sys:daily', all)).toEqual([daily])
    expect(notesAt('sys:verse', all)).toEqual([verse])
    expect(notesAt('a', all)).toEqual([filedVerse])
    expect(notesAt(null, all)).toEqual([])
    expect(systemFolderCounts(all)).toEqual({ daily: 1, verse: 1, esword: 0, biblegateway: 0 })
  })
  it('titles', () => {
    expect(locationTitle(null, folders)).toBe('Folders')
    expect(locationTitle('all', folders)).toBe('All Notes')
    expect(locationTitle('sys:verse', folders)).toBe('Verse Notes')
    expect(locationTitle('b', folders)).toBe('Torah')
  })
  it('the former filter chips still filter', () => {
    expect(matchesFilter(note({ type: 'verse' }), 'scripture')).toBe(true)
    expect(matchesFilter(note({ pinned: true }), 'pinned')).toBe(true)
    expect(matchesFilter(note({ type: 'daily' }), 'topic')).toBe(false)
  })
})

describe('folder view sections', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
  const ns = [
    note({ title: 'today', updatedAt: at(2026, 9, 28) }),
    note({ title: 'pinned-old', pinned: true, updatedAt: at(2025, 3, 1) }),
    note({ title: 'week', updatedAt: at(2026, 9, 24) }),
    note({ title: 'month', updatedAt: at(2026, 9, 10) }),
    note({ title: 'july', updatedAt: at(2026, 7, 2) }),
    note({ title: 'last-year', updatedAt: at(2025, 12, 2) }),
  ]
  it('Pinned first, then Today / Previous 7 Days / Previous 30 Days / months; every note once', () => {
    const s = folderViewSections(ns, { sort: 'modified', grouping: 'none', now, locale: 'en-US' })
    expect(s.map((x) => x.title)).toEqual(['Pinned', 'Today', 'Previous 7 Days', 'Previous 30 Days', 'July', 'December 2025'])
    expect(s.flatMap((x) => x.notes).length).toBe(ns.length)
    expect(s[0].notes.map((n) => n.title)).toEqual(['pinned-old'])
  })
  it('newest first inside a section', () => {
    const two = [note({ title: 'older', updatedAt: now - 3600_000 * 2 }), note({ title: 'newer', updatedAt: now - 60_000 })]
    expect(folderViewSections(two, { sort: 'modified', grouping: 'none', now })[0].notes.map((n) => n.title)).toEqual(['newer', 'older'])
  })
  it('title sort is one A–Z section; a grouping keeps the desktop board / folder / type sections', () => {
    const s = folderViewSections(ns, { sort: 'name', grouping: 'none', now })
    expect(s.map((x) => x.id)).toEqual(['pinned', 'notes'])
    const g = folderViewSections([note({ type: 'verse' }), note({ type: 'daily' })], { sort: 'modified', grouping: 'type', now })
    expect(g.map((x) => x.title)).toEqual(['Scripture', 'Daily'])
  })
  it('sections collapse per location, for the session', () => {
    sectionCollapse.__reset()
    expect(sectionCollapse.isCollapsed('a', 'today')).toBe(false)
    sectionCollapse.toggle('a', 'today')
    expect(sectionCollapse.isCollapsed('a', 'today')).toBe(true)
    expect(sectionCollapse.isCollapsed('b', 'today')).toBe(false)
  })
})

describe('row content', () => {
  it('thumbnail: the first data: or http(s) image, never a vault path', () => {
    expect(firstImageSrc('text ![a](data:image/png;base64,AAAA) ![b](https://x.org/b.png)')).toBe('data:image/png;base64,AAAA')
    expect(firstImageSrc('<img src="https://x.org/i.jpg"> ![a](data:image/png;base64,BB)')).toBe('https://x.org/i.jpg')
    expect(firstImageSrc('![a](attachments/pic.png)')).toBeNull()
    expect(firstImageSrc(null)).toBeNull()
  })
  it('preview: markdown and images stripped, the title line not repeated', () => {
    const strip = (s: string) => s.replace(/[#*]/g, '')
    expect(notePreviewText({ title: 'Matthew 5.3', content: '# Matthew 5:3\n\n**Blessed** ![x](data:image/png;base64,A) are' }, strip)).toBe('Blessed are')
  })
})

describe('search', () => {
  it('folders match by name, prefix matches first', () => {
    expect(matchFolders('to', folders).map((f) => f.name)).toEqual(['Torah'])
    expect(matchFolders('e', folders).map((f) => f.name)[0]).toBe('Apologetics')
    expect(matchFolders('  ', folders)).toEqual([])
  })
})

describe('persisted presentation', () => {
  beforeEach(() => { localStorage.clear(); notesHomePrefs.__reset() })
  it('layout and expanded folders survive a relaunch; bad data falls back to defaults', () => {
    expect(notesHomePrefs.get().layout).toBe('list')
    notesHomePrefs.set({ layout: 'gallery', expandedFolders: ['a'] })
    notesHomePrefs.__reset()
    expect(notesHomePrefs.get()).toEqual({ layout: 'gallery', expandedFolders: ['a'] })
    localStorage.setItem('berean.notesHome.v1', '{"layout":"weird","expandedFolders":7}')
    notesHomePrefs.__reset()
    expect(notesHomePrefs.get()).toEqual({ layout: 'list', expandedFolders: [] })
  })
})
