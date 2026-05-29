import { useEffect, useRef, useState, useMemo } from 'react'
import { Download, Loader2, CheckCircle2, XCircle, FolderOpen, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store'
import type { ESwordReviewNote } from '@/types/electron'

type ReviewFilter = 'all' | 'new' | 'updated' | 'duplicate'
type TypeFilter = 'all' | 'verse' | 'daily' | 'topic'

export default function ESwordImporter() {
  const {
    eSwordPhase, eSwordDone, eSwordTotal, eSwordMessage, eSwordReviewNotes,
    setESwordProgress, resetESword, bumpNoteToken,
  } = useAppStore((s) => ({
    eSwordPhase:       s.eSwordPhase,
    eSwordDone:        s.eSwordDone,
    eSwordTotal:       s.eSwordTotal,
    eSwordMessage:     s.eSwordMessage,
    eSwordReviewNotes: s.eSwordReviewNotes,
    setESwordProgress: s.setESwordProgress,
    resetESword:       s.resetESword,
    bumpNoteToken:     s.bumpNoteToken,
  }))

  const [folder, setFolder] = useState('')
  const [importStudy, setImportStudy] = useState(true)
  const [importTopics, setImportTopics] = useState(true)
  const [importJournal, setImportJournal] = useState(true)
  const [filter, setFilter] = useState<ReviewFilter>('new')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const detectedRef = useRef(false)

  // Auto-detect folder on first mount
  useEffect(() => {
    if (detectedRef.current) return
    detectedRef.current = true
    window.eSwordImport.detectFolder().then((f) => { if (f) setFolder(f) }).catch(() => {})
  }, [])

  // Pre-select new + updated when review notes arrive
  useEffect(() => {
    if (eSwordPhase === 'review' && eSwordReviewNotes.length > 0) {
      setSelectedIds(new Set(
        eSwordReviewNotes.filter(n => n.status === 'new' || n.status === 'updated').map(n => n.id)
      ))
    }
  }, [eSwordPhase, eSwordReviewNotes])

  const counts = useMemo(() => ({
    new:       eSwordReviewNotes.filter(n => n.status === 'new').length,
    updated:   eSwordReviewNotes.filter(n => n.status === 'updated').length,
    duplicate: eSwordReviewNotes.filter(n => n.status === 'duplicate').length,
  }), [eSwordReviewNotes])

  const filteredNotes = useMemo(() => {
    let notes = eSwordReviewNotes
    if (typeFilter !== 'all') notes = notes.filter(n => n.type === typeFilter)
    if (filter !== 'all') notes = notes.filter(n => n.status === filter)
    return notes
  }, [eSwordReviewNotes, filter, typeFilter])

  const typeCounts = useMemo(() => ({
    verse: eSwordReviewNotes.filter(n => n.type === 'verse').length,
    daily: eSwordReviewNotes.filter(n => n.type === 'daily').length,
    topic: eSwordReviewNotes.filter(n => n.type === 'topic').length,
  }), [eSwordReviewNotes])

  async function handleBrowse() {
    const picked = await window.app.openFolderDialog()
    if (picked) setFolder(picked)
  }

  async function handleRead() {
    if (!folder.trim()) return
    setESwordProgress({ phase: 'reading', done: 0, total: 0, message: 'Reading files…' })
    try {
      const result = await window.eSwordImport.start({
        folder: folder.trim(),
        study: importStudy,
        topics: importTopics,
        journal: importJournal,
      })
      if (result && !result.success && result.error) {
        setESwordProgress({ phase: 'error', done: 0, total: 0, message: result.error })
      }
    } catch (err) {
      setESwordProgress({ phase: 'error', done: 0, total: 0, message: String(err) })
    }
  }

  async function handleImport() {
    const toImport = eSwordReviewNotes.filter(n => selectedIds.has(n.id))
    if (!toImport.length) return
    try {
      await window.eSwordImport.importSelected(toImport)
      bumpNoteToken()
    } catch (err) {
      setESwordProgress({ phase: 'error', done: 0, total: 0, message: String(err) })
    }
  }

  function toggleNote(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll(notes: ESwordReviewNote[]) {
    setSelectedIds(prev => { const n = new Set(prev); notes.forEach(x => n.add(x.id)); return n })
  }
  function deselectAll(notes: ESwordReviewNote[]) {
    setSelectedIds(prev => { const n = new Set(prev); notes.forEach(x => n.delete(x.id)); return n })
  }

  const isRunning = eSwordPhase === 'reading'
  const selectedCount = selectedIds.size
  const pct = eSwordTotal > 0 ? Math.round((eSwordDone / eSwordTotal) * 100) : null

  // ── Idle / setup ─────────────────────────────────────────────────────────────
  if (eSwordPhase === 'idle') {
    return (
      <div className="space-y-4">
        <p className="text-[12px] text-[rgb(var(--color-text-muted))] leading-relaxed">
          Import notes from e-Sword's local database files. The folder is usually inside your Documents folder.
        </p>

        {/* Folder picker */}
        <div>
          <p className="text-[11px] font-medium text-[rgb(var(--color-text-secondary))] mb-1.5">e-Sword folder</p>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={folder}
              onChange={e => setFolder(e.target.value)}
              placeholder="Path to folder containing study.notx…"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-border))] text-[11px] text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none focus:border-[rgb(var(--color-accent))]"
            />
            <button
              onClick={handleBrowse}
              title="Browse"
              className="p-1.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer flex-shrink-0"
            >
              <FolderOpen size={14} />
            </button>
          </div>
        </div>

        {/* File type selection */}
        <div>
          <p className="text-[11px] font-medium text-[rgb(var(--color-text-secondary))] mb-1.5">Files to import</p>
          <div className="space-y-1.5">
            {([
              [importStudy,  setImportStudy,  'study.notx',  'Verse notes — notes attached to specific Bible verses'],
              [importTopics, setImportTopics, 'topic.topx',  'Topic notes — general reference notes by topic title'],
              [importJournal,setImportJournal,'journal.jnlx','Daily notes — dated study journal entries'],
            ] as [boolean, (v: boolean) => void, string, string][]).map(([checked, set, file, desc]) => (
              <label key={file} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => set(e.target.checked)}
                  className="mt-0.5 accent-[rgb(var(--color-accent))] flex-shrink-0"
                />
                <div>
                  <span className="text-[11px] font-mono text-[rgb(var(--color-text-primary))]">{file}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] ml-1.5">{desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={handleRead}
          disabled={!folder.trim() || (!importStudy && !importTopics && !importJournal)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent-hover))] text-white text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={13} />
          Read e-Sword Notes
        </button>
      </div>
    )
  }

  // ── Reading ───────────────────────────────────────────────────────────────────
  if (isRunning) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-[rgb(var(--color-accent))]" />
            <span className="text-[12px] font-medium text-[rgb(var(--color-text-secondary))]">Reading files…</span>
          </div>
          <button onClick={resetESword} className="text-[11px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
            Cancel
          </button>
        </div>
        {eSwordMessage && (
          <p className="text-[11px] text-[rgb(var(--color-text-muted))]">{eSwordMessage}</p>
        )}
        {pct !== null && (
          <div className="h-1.5 rounded-full bg-[rgb(var(--color-surface-4))] overflow-hidden">
            <div className="h-full rounded-full bg-[rgb(var(--color-accent))] transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    )
  }

  // ── Review ────────────────────────────────────────────────────────────────────
  if (eSwordPhase === 'review') {
    const allFilteredIds = filteredNotes.map(n => n.id)
    const allFilteredSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id))

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-[rgb(var(--color-text-primary))]">
            {eSwordReviewNotes.length} notes found
          </p>
          <button onClick={resetESword} className="flex items-center gap-1 text-[11px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))] cursor-pointer">
            <RefreshCw size={10} /> Read again
          </button>
        </div>
        <p className="text-[11px] text-[rgb(var(--color-text-muted))]">{eSwordMessage}</p>

        {/* Type filter */}
        <div className="flex gap-1 flex-wrap">
          {([
            ['all',   `All (${eSwordReviewNotes.length})`],
            ['verse', `Verse (${typeCounts.verse})`],
            ['daily', `Daily (${typeCounts.daily})`],
            ['topic', `Topic (${typeCounts.topic})`],
          ] as [TypeFilter, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTypeFilter(key)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                typeFilter === key
                  ? 'bg-[rgb(var(--color-accent))] text-white'
                  : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
              }`}
            >{label}</button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1">
          {([
            ['all',       `All`],
            ['new',       `New (${counts.new})`],
            ['updated',   `Updated (${counts.updated})`],
            ['duplicate', `Imported (${counts.duplicate})`],
          ] as [ReviewFilter, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                filter === key ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-accent))] ring-1 ring-[rgb(var(--color-accent))/30]' : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
              }`}
            >{label}</button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => allFilteredSelected ? deselectAll(filteredNotes) : selectAll(filteredNotes)}
            className="text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer">
            {allFilteredSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-[10px] text-[rgb(var(--color-text-muted))]">
            ({filteredNotes.length} in view, {selectedCount} total selected)
          </span>
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
          {filteredNotes.length === 0 ? (
            <p className="text-[11px] text-[rgb(var(--color-text-muted))] italic py-2">None in this category.</p>
          ) : filteredNotes.map(note => (
            <label key={note.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-[rgb(var(--color-surface-3))] cursor-pointer">
              <input type="checkbox" checked={selectedIds.has(note.id)} onChange={() => toggleNote(note.id)}
                disabled={note.status === 'duplicate'}
                className="mt-0.5 flex-shrink-0 accent-[rgb(var(--color-accent))]" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-medium text-[rgb(var(--color-text-primary))] truncate">
                    {note.title || 'Untitled'}
                  </span>
                  <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${
                    note.type === 'verse' ? 'bg-blue-500/15 text-blue-400' :
                    note.type === 'topic' ? 'bg-purple-500/15 text-purple-400' :
                    'bg-amber-500/15 text-amber-400'
                  }`}>{note.type === 'daily' ? 'daily' : note.type}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${
                    note.status === 'new' ? 'bg-green-500/20 text-green-400' :
                    note.status === 'updated' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))]'
                  }`}>{note.status === 'new' ? 'New' : note.status === 'updated' ? 'Updated' : 'Already imported'}</span>
                </div>
                {note.body && (
                  <p className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 line-clamp-2 leading-relaxed">
                    {note.body.slice(0, 120)}{note.body.length > 120 ? '…' : ''}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1 border-t border-[rgb(var(--color-border))]">
          <button onClick={handleImport} disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent-hover))] text-white text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={13} />
            Import {selectedCount > 0 ? `${selectedCount} Selected` : 'Selected'}
          </button>
          <button onClick={resetESword} className="text-[11px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Saving ────────────────────────────────────────────────────────────────────
  if (eSwordPhase === 'saving') {
    const p = eSwordTotal > 0 ? Math.round((eSwordDone / eSwordTotal) * 100) : 0
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-[rgb(var(--color-accent))]" />
          <span className="text-[12px] font-medium text-[rgb(var(--color-text-secondary))]">Saving notes…</span>
        </div>
        <div className="h-1.5 rounded-full bg-[rgb(var(--color-surface-4))] overflow-hidden">
          <div className="h-full rounded-full bg-[rgb(var(--color-accent))] transition-all duration-300" style={{ width: `${p}%` }} />
        </div>
        <p className="text-[10px] text-[rgb(var(--color-text-muted))]">{eSwordDone} / {eSwordTotal}</p>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  if (eSwordPhase === 'done') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} className="text-green-400 flex-shrink-0" />
          <span className="text-[12px] font-medium text-[rgb(var(--color-text-primary))]">Import complete</span>
        </div>
        <p className="text-[11px] text-[rgb(var(--color-text-muted))] leading-relaxed">{eSwordMessage}</p>
        <button onClick={resetESword} className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer">
          <RefreshCw size={11} /> Import again
        </button>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <XCircle size={15} className="text-red-400 flex-shrink-0" />
        <span className="text-[12px] font-medium text-[rgb(var(--color-text-primary))]">Import failed</span>
      </div>
      <p className="text-[11px] text-[rgb(var(--color-text-muted))] leading-relaxed">
        {eSwordMessage || 'An unexpected error occurred.'}
      </p>
      <button onClick={resetESword} className="text-[11px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer">
        Try again
      </button>
    </div>
  )
}
