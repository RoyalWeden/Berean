import { useEffect, useState, useMemo } from 'react'
import {
  Download, Loader2, CheckCircle2, XCircle, Eye, EyeOff,
  ChevronDown, ChevronUp, RefreshCw, LogOut,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import type { BgImportReviewNote } from '@/types/electron'

type ReviewFilter = 'all' | 'new' | 'updated' | 'duplicate'

export default function BibleGatewayImporter() {
  const {
    bgImportPhase, bgImportDone, bgImportTotal, bgImportMessage, bgImportReviewNotes,
    setBgImportProgress, resetBgImport, bumpNoteToken,
  } = useAppStore(useShallow((s) => ({
    bgImportPhase:       s.bgImportPhase,
    bgImportDone:        s.bgImportDone,
    bgImportTotal:       s.bgImportTotal,
    bgImportMessage:     s.bgImportMessage,
    bgImportReviewNotes: s.bgImportReviewNotes,
    setBgImportProgress: s.setBgImportProgress,
    resetBgImport:       s.resetBgImport,
    bumpNoteToken:       s.bumpNoteToken,
  })))

  // ── Local state ──────────────────────────────────────────────────────────────
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [filter, setFilter] = useState<ReviewFilter>('new')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDetails, setShowDetails] = useState(false)
  const [detailLines, setDetailLines] = useState<string[]>([])
  // Load saved credentials on mount
  useEffect(() => {
    window.settings.get('bgUsername').then((v) => { if (v) setUsername(String(v)) })
    window.settings.get('bgPassword').then((v) => { if (v) setPassword(String(v)) })
  }, [])

  // Append progress messages to the detail log
  useEffect(() => {
    if (bgImportMessage) setDetailLines((prev) => [...prev.slice(-99), bgImportMessage])
  }, [bgImportMessage])

  // When review notes arrive, pre-select new + updated
  useEffect(() => {
    if (bgImportPhase === 'review' && bgImportReviewNotes.length > 0) {
      const autoSelected = bgImportReviewNotes
        .filter(n => n.status === 'new' || n.status === 'updated')
        .map(n => n.id)
      setSelectedIds(new Set(autoSelected))
    }
  }, [bgImportPhase, bgImportReviewNotes])

  // ── Derived counts ───────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    new:       bgImportReviewNotes.filter(n => n.status === 'new').length,
    updated:   bgImportReviewNotes.filter(n => n.status === 'updated').length,
    duplicate: bgImportReviewNotes.filter(n => n.status === 'duplicate').length,
  }), [bgImportReviewNotes])

  const filteredNotes = useMemo(() => {
    if (filter === 'all') return bgImportReviewNotes
    return bgImportReviewNotes.filter(n => n.status === filter)
  }, [bgImportReviewNotes, filter])

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function handleFetch() {
    if (!username.trim() || !password.trim()) return
    setDetailLines([])
    // Save credentials
    await window.settings.set('bgUsername', username.trim())
    await window.settings.set('bgPassword', password)
    setBgImportProgress({ phase: 'login', done: 0, total: 0, message: 'Connecting…' })
    try {
      const result = await window.bgImport.start({ username: username.trim(), password })
      if (result && !result.success && result.error) {
        setBgImportProgress({ phase: 'error', done: 0, total: 0, message: result.error })
      }
    } catch (err) {
      setBgImportProgress({ phase: 'error', done: 0, total: 0, message: String(err) })
    }
  }

  async function handleImport() {
    const toImport = bgImportReviewNotes.filter(n => selectedIds.has(n.id))
    if (toImport.length === 0) return
    try {
      await window.bgImport.importSelected(toImport)
      bumpNoteToken() // refresh NotesList and verse indicator dots immediately
    } catch (err) {
      setBgImportProgress({ phase: 'error', done: 0, total: 0, message: String(err) })
    }
  }

  function toggleNote(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll(notes: BgImportReviewNote[]) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      notes.forEach(n => next.add(n.id))
      return next
    })
  }

  function deselectAll(notes: BgImportReviewNote[]) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      notes.forEach(n => next.delete(n.id))
      return next
    })
  }

  const isRunning = bgImportPhase === 'login' || bgImportPhase === 'fetching'
  const selectedCount = selectedIds.size

  async function handleClearSession() {
    await window.bgImport.clearSession()
  }

  // ── Idle / Credentials ───────────────────────────────────────────────────────
  if (bgImportPhase === 'idle') {
    return (
      <div className="space-y-3">
        <p className="text-footnote text-text-muted leading-relaxed">
          Enter your BibleGateway credentials. They're stored locally and never leave your device.
        </p>

        <div className="space-y-2">
          <input
            type="email"
            placeholder="Email"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-control bg-surface-3 border border-border text-footnote text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
              className="w-full px-2.5 py-1.5 pr-8 rounded-control bg-surface-3 border border-border text-footnote text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
            />
            <button
              onClick={() => setShowPassword(p => !p)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary cursor-pointer"
            >
              {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleFetch}
            disabled={!username.trim() || !password.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent hover:bg-accent-hover text-white text-footnote font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={13} />
            Fetch Notes from BibleGateway
          </button>
          <button
            onClick={handleClearSession}
            title="Clear saved BibleGateway session (sign out)"
            className="flex items-center gap-1 text-caption text-text-muted hover:text-text-secondary cursor-pointer"
          >
            <LogOut size={11} />
            Sign out
          </button>
          {import.meta.env.DEV && (
            <button
              onClick={() => window.bgImport.debugOpen()}
              title="Open a visible BibleGateway window and run intense DOM logging — check the Electron console for output"
              className="flex items-center gap-1 text-caption text-text-muted hover:text-text-secondary cursor-pointer ml-auto"
            >
              Debug
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Running (login / fetching) ───────────────────────────────────────────────
  if (isRunning) {
    const pct = bgImportTotal > 0 ? Math.round((bgImportDone / bgImportTotal) * 100) : null
    const label = bgImportPhase === 'login' ? 'Signing in…' : 'Fetching notes…'

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-accent" />
            <span className="text-footnote font-medium text-text-secondary">{label}</span>
          </div>
          <button
            onClick={() => { window.bgImport.cancel(); resetBgImport() }}
            className="text-caption text-text-muted hover:text-text-primary cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {bgImportMessage && (
          <p className="text-caption text-text-muted leading-relaxed">{bgImportMessage}</p>
        )}

        {pct !== null && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-caption2 text-text-muted">{bgImportDone} / {bgImportTotal}</p>
          </div>
        )}

        {/* Expandable detail log */}
        <div>
          <button
            onClick={() => setShowDetails(p => !p)}
            className="flex items-center gap-1 text-caption2 text-text-muted hover:text-text-secondary cursor-pointer"
          >
            {showDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
          {showDetails && (
            <div className="mt-1.5 max-h-28 overflow-y-auto bg-surface-3 rounded p-2 space-y-0.5">
              {detailLines.map((line, i) => (
                <p key={i} className="text-caption2 text-text-muted font-mono leading-relaxed">{line}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Review ───────────────────────────────────────────────────────────────────
  if (bgImportPhase === 'review') {
    const allFilteredIds = filteredNotes.map(n => n.id)
    const allFilteredSelected = allFilteredIds.every(id => selectedIds.has(id))

    return (
      <div className="space-y-3">
        {/* Summary */}
        <div className="flex items-center justify-between">
          <p className="text-footnote font-medium text-text-primary">
            {bgImportReviewNotes.length} notes found
          </p>
          <button
            onClick={resetBgImport}
            className="flex items-center gap-1 text-caption text-text-muted hover:text-text-secondary cursor-pointer"
          >
            <RefreshCw size={10} /> Fetch again
          </button>
        </div>

        <p className="text-caption text-text-muted">{bgImportMessage}</p>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {([
            ['all',       `All (${bgImportReviewNotes.length})`],
            ['new',       `New (${counts.new})`],
            ['updated',   `Updated (${counts.updated})`],
            ['duplicate', `Imported (${counts.duplicate})`],
          ] as [ReviewFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2 py-0.5 rounded text-caption2 font-medium transition-colors cursor-pointer ${
                filter === key
                  ? 'bg-accent text-white'
                  : 'bg-surface-4 text-text-muted hover:text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Select all for current filter */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => allFilteredSelected ? deselectAll(filteredNotes) : selectAll(filteredNotes)}
            className="text-caption2 text-accent hover:underline cursor-pointer"
          >
            {allFilteredSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-caption2 text-text-muted">
            ({filteredNotes.length} in view, {selectedCount} total selected)
          </span>
        </div>

        {/* Note list */}
        <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
          {filteredNotes.length === 0 ? (
            <p className="text-caption text-text-muted italic py-2">None in this category.</p>
          ) : filteredNotes.map(note => (
            <label
              key={note.id}
              className="flex items-start gap-2 p-1.5 rounded hover:bg-surface-hover cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(note.id)}
                onChange={() => toggleNote(note.id)}
                disabled={note.status === 'duplicate'}
                className="mt-0.5 flex-shrink-0 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-caption font-medium text-text-primary truncate">
                    {note.passage || 'Unknown'}
                  </span>
                  <span className={`text-micro px-1 py-0.5 rounded font-medium flex-shrink-0 ${
                    note.status === 'new'       ? 'bg-success/20 text-success' :
                    note.status === 'updated'   ? 'bg-warning/20 text-warning' :
                    'bg-surface-4 text-text-muted'
                  }`}>
                    {note.status === 'new' ? 'New' : note.status === 'updated' ? 'Updated' : 'Already imported'}
                  </span>
                </div>
                {note.body && (
                  <p className="text-caption2 text-text-muted mt-0.5 line-clamp-2 leading-relaxed">
                    {note.body.slice(0, 120)}{note.body.length > 120 ? '…' : ''}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        {/* Import button */}
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <button
            onClick={handleImport}
            disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-accent hover:bg-accent-hover text-white text-footnote font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={13} />
            Import {selectedCount > 0 ? `${selectedCount} Selected` : 'Selected'}
          </button>
          <button
            onClick={resetBgImport}
            className="text-caption text-text-muted hover:text-text-primary cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Saving ───────────────────────────────────────────────────────────────────
  if (bgImportPhase === 'saving') {
    const pct = bgImportTotal > 0 ? Math.round((bgImportDone / bgImportTotal) * 100) : 0
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-accent" />
          <span className="text-footnote font-medium text-text-secondary">Saving notes…</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-caption2 text-text-muted">{bgImportDone} / {bgImportTotal}</p>
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (bgImportPhase === 'done') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} className="text-success flex-shrink-0" />
          <span className="text-footnote font-medium text-text-primary">Import complete</span>
        </div>
        <p className="text-caption text-text-muted leading-relaxed">{bgImportMessage}</p>
        <button
          onClick={resetBgImport}
          className="flex items-center gap-1.5 text-caption text-accent hover:underline cursor-pointer"
        >
          <RefreshCw size={11} /> Import again
        </button>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <XCircle size={15} className="text-destructive flex-shrink-0" />
        <span className="text-footnote font-medium text-text-primary">Import failed</span>
      </div>
      <p className="text-caption text-text-muted leading-relaxed">
        {bgImportMessage || 'An unexpected error occurred.'}
      </p>
      <button
        onClick={resetBgImport}
        className="text-caption text-accent hover:underline cursor-pointer"
      >
        Try again
      </button>
    </div>
  )
}
