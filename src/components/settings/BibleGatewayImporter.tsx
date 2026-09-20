import { useEffect, useState, useMemo } from 'react'
import {
  Download, Loader2, CheckCircle2, XCircle, Eye, EyeOff,
  ChevronDown, ChevronUp, RefreshCw, LogOut,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import type { BgImportReviewNote } from '@/types/electron'
import { TextField, Button, IconButton, SegmentedControl, Checkbox, DisclosureRow } from '@/components/ui'

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
          <TextField
            type="email"
            placeholder="Email"
            value={username}
            onChange={e => setUsername(e.target.value)}
            wrapperClassName="w-full"
          />
          <TextField
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFetch()}
            wrapperClassName="w-full"
            trailing={
              <IconButton
                icon={showPassword ? EyeOff : Eye}
                label={showPassword ? 'Hide password' : 'Show password'}
                size={20}
                onClick={() => setShowPassword(p => !p)}
              />
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Download} onClick={handleFetch} disabled={!username.trim() || !password.trim()}>
            Fetch Notes from BibleGateway
          </Button>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={handleClearSession} tooltip="Clear saved BibleGateway session (sign out)">
            Sign out
          </Button>
          {import.meta.env.DEV && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.bgImport.debugOpen()}
              tooltip="Open a visible BibleGateway window and run intense DOM logging — check the Electron console for output"
              className="ml-auto"
            >
              Debug
            </Button>
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
          <Button variant="ghost" size="sm" onClick={() => { window.bgImport.cancel(); resetBgImport() }}>
            Cancel
          </Button>
        </div>

        {bgImportMessage && (
          <p className="text-caption text-text-muted leading-relaxed">{bgImportMessage}</p>
        )}

        {pct !== null && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-control bg-lift-2 overflow-hidden">
              <div
                className="h-full rounded-control bg-accent transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-caption2 text-text-muted">{bgImportDone} / {bgImportTotal}</p>
          </div>
        )}

        {/* Expandable detail log */}
        <div>
          <DisclosureRow open={showDetails} title={showDetails ? 'Hide details' : 'Show details'} onClick={() => setShowDetails(p => !p)} />
          {showDetails && (
            <div className="mt-1.5 max-h-28 overflow-y-auto bg-surface-elevated rounded-card p-2 space-y-0.5">
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
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={resetBgImport}>Fetch again</Button>
        </div>

        <p className="text-caption text-text-muted">{bgImportMessage}</p>

        {/* Filter tabs */}
        <SegmentedControl
          aria-label="Filter notes"
          value={filter}
          onChange={setFilter}
          options={([
            ['all',       `All (${bgImportReviewNotes.length})`],
            ['new',       `New (${counts.new})`],
            ['updated',   `Updated (${counts.updated})`],
            ['duplicate', `Imported (${counts.duplicate})`],
          ] as [ReviewFilter, string][]).map(([value, label]) => ({ value, label }))}
        />

        {/* Select all for current filter */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => allFilteredSelected ? deselectAll(filteredNotes) : selectAll(filteredNotes)}>
            {allFilteredSelected ? 'Deselect all' : 'Select all'}
          </Button>
          <span className="text-caption2 text-text-muted">
            ({filteredNotes.length} in view, {selectedCount} total selected)
          </span>
        </div>

        {/* Note list */}
        <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
          {filteredNotes.length === 0 ? (
            <p className="text-caption text-text-muted italic py-2">None in this category.</p>
          ) : filteredNotes.map(note => (
            <div
              key={note.id}
              onClick={() => note.status !== 'duplicate' && toggleNote(note.id)}
              className="flex items-start gap-2 p-1.5 rounded-row hover:bg-surface-hover cursor-pointer group"
            >
              <Checkbox
                checked={selectedIds.has(note.id)}
                onChange={() => {}}
                disabled={note.status === 'duplicate'}
                className="mt-0.5 flex-shrink-0 pointer-events-none"
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
            </div>
          ))}
        </div>

        {/* Import button */}
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <Button variant="primary" icon={Download} onClick={handleImport} disabled={selectedCount === 0}>
            Import {selectedCount > 0 ? `${selectedCount} Selected` : 'Selected'}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetBgImport}>Cancel</Button>
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
        <div className="h-1.5 rounded-control bg-lift-2 overflow-hidden">
          <div className="h-full rounded-control bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
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
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={resetBgImport}>Import again</Button>
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
      <Button variant="ghost" size="sm" onClick={resetBgImport}>Try again</Button>
    </div>
  )
}
