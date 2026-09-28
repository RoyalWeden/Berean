// @vitest-environment jsdom
/** DATA-SYNC-009 — database → UI invalidation after remote changes (TEST 4, TEST 8). */
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useAppStore } from '@/store'
import { SYNCED_ENTITY_KINDS } from '@/platform/sync/entities'
import { INVALIDATES, applySyncInvalidation } from '../syncInvalidation'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('applySyncInvalidation', () => {
  it('every synced entity kind has a deliberate invalidation decision', () => {
    for (const kind of SYNCED_ENTITY_KINDS) expect(INVALIDATES[kind], kind).toBeDefined()
  })

  it('TEST 4: a visible view re-reads and re-renders when remote notes / highlights arrive — no refresh', async () => {
    const reads: string[] = []
    let db = { note: 'old title', highlight: 'yellow' }
    function Visible() {
      const noteToken = useAppStore((s) => s.noteChangeToken)
      const hlToken = useAppStore((s) => s.highlightChangeToken)
      const [shown, setShown] = React.useState('')
      React.useEffect(() => { reads.push('read'); setShown(`${db.note}|${db.highlight}`) }, [noteToken, hlToken])
      return <span data-testid="v">{shown}</span>
    }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<Visible />))
    expect(host.textContent).toBe('old title|yellow')
    db = { note: 'DEVICE B TEST 002', highlight: 'green' }         // the sync engine wrote the database
    act(() => applySyncInvalidation(['note', 'highlight']))
    expect(host.textContent).toBe('DEVICE B TEST 002|green')      // TEST 8: the view shows the latest database state
    act(() => root.unmount()); host.remove()
  })

  it('tags / tabs / workspaces are refreshed from the database', async () => {
    const refreshVerseTags = vi.fn(async () => {})
    const setSavedWorkspaces = vi.fn()
    useAppStore.setState({ refreshVerseTags, setSavedWorkspaces } as never)
    ;(window as unknown as { workspaces: unknown }).workspaces = { list: async () => [{ id: 'w', name: 'Deep study' }] }
    const verseNote = useAppStore.getState().verseNoteToken
    applySyncInvalidation(['verse_tag', 'workspace', 'note_folder'])
    await new Promise((r) => setTimeout(r, 0))
    expect(refreshVerseTags).toHaveBeenCalled()
    expect(setSavedWorkspaces).toHaveBeenCalledWith([{ id: 'w', name: 'Deep study' }])
    expect(useAppStore.getState().verseNoteToken).toBe(verseNote + 1)   // reader verse-note dots too
  })

  it('no synced kind needs the view reopened: library lists re-read on their epochs (DATA-LIVE-002)', () => {
    expect(Object.values(INVALIDATES)).not.toContain('on-open')
    const before = { ...useAppStore.getState().dataEpochs }
    applySyncInvalidation(['playlist', 'pdf_bookmark', 'youtube_user', 'ai_chat'])
    const after = useAppStore.getState().dataEpochs
    expect(after).toEqual({ playlists: before.playlists + 1, pdfs: before.pdfs + 1, youtube: before.youtube + 1, aiChats: before.aiChats + 1 })
  })

  it('a mounted Scripture side-panel note list follows a remote change with no reopen', () => {
    let notes = ['Gen 1:1 study']
    function SidePanel() {
      const token = useAppStore((s) => s.noteChangeToken)
      const verseToken = useAppStore((s) => s.verseNoteToken)
      const [shown, setShown] = React.useState<string[]>([])
      React.useEffect(() => { setShown([...notes]) }, [token, verseToken])
      return <ul>{shown.map((n) => <li key={n}>{n}</li>)}</ul>
    }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<SidePanel />))
    notes = ['Gen 1:1 study', 'Added on the Mac']
    act(() => applySyncInvalidation(['note']))
    expect(host.textContent).toBe('Gen 1:1 studyAdded on the Mac')
    act(() => root.unmount()); host.remove()
  })
})
