import { useEffect, useState } from 'react'
import { RotateCcw, Eye, GitCompare, Save } from 'lucide-react'
import { diffWords } from 'diff'
import { renderPreviewContent } from '@/lib/notePreviewRender'
import { renderMarkdownToHTML } from './pm/staticRender'
import type { NoteVersion } from '@/types'
import { Sheet, SegmentedControl, Button } from '@/components/ui'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fullTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const KIND_LABEL: Record<string, string> = { auto: 'Auto', manual: 'Saved', 'pre-restore': 'Before restore' }

const LOADING_PLACEHOLDER = (
  <div className="flex items-center justify-center h-32">
    <div className="w-5 h-5 rounded-full border-2 border-separator border-t-text-muted animate-spin" />
  </div>
)

/** Render a past version as fully formatted content — routed through the
 *  same PM schema/parser (staticRender.ts) as the live note editor, so a
 *  version looks identical to how the note actually looked in-editor
 *  (bordered verse/lexicon blocks, highlight colors, bullet markers) rather
 *  than the old separate `marked`-based preview pipeline's look.
 *  Defers the render work to a macro-task so the version list stays
 *  responsive while the HTML is being computed.
 */
function RenderedPreviewView({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    setHtml(null)
    const id = setTimeout(() => { setHtml(renderMarkdownToHTML(content)) }, 0)
    return () => clearTimeout(id)
  }, [content])
  if (html === null) return LOADING_PLACEHOLDER
  // No px-6 py-4 here (an earlier version had it): renderMarkdownToHTML's
  // own output already includes the ".berean-pm-editor > .ProseMirror"
  // wrapper, which carries pmEditor.css's own `padding: 16px` — the exact
  // padding the live editor's container relies on too (NoteEditorPM.tsx's
  // own wrapper adds none of its own). Adding padding here stacked on top
  // of that, making version history visibly roomier/differently-spaced
  // than the editor it's supposed to look identical to.
  return (
    <div
      className="berean-notes-text"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Rendered word-level diff of `prev` → `next`.
 * Injects <ins>/<del> HTML markers into the raw markdown at word boundaries,
 * then renders the whole thing through renderPreviewContent so the user sees
 * properly formatted text (headings, verse blocks, etc.) with diff highlights,
 * not raw markdown syntax. Deliberately stays on the old `marked`-based
 * renderPreviewContent rather than staticRender.ts's PM-based renderer: the
 * PM markdown parser is configured `html: false` (markdownIt.ts) so it can't
 * safely round-trip the raw <ins>/<del> tags this view injects — `marked`
 * can. This is the one place that still intentionally uses the legacy
 * pipeline; RenderedPreviewView above (the more commonly used non-diff tab)
 * already renders through the same engine as the live editor.
 * Deferred to a macro-task so clicking a version item doesn't block the scroll list.
 */
function RenderedDiffView({ prev, next }: { prev: string; next: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    setHtml(null)
    const id = setTimeout(() => {
      const parts = diffWords(prev, next)
      // Build a single merged markdown string with inline HTML diff markers.
      // <ins> = words added since this version (exists in current but not here)
      // <del> = words removed since this version (existed here but not in current)
      const merged = parts.map((p) => {
        if (p.added) {
          return `<ins style="background:rgba(34,197,94,0.18);text-decoration:none;border-radius:2px;padding:0 1px">${p.value}</ins>`
        }
        if (p.removed) {
          return `<del style="background:rgba(239,68,68,0.14);color:rgba(248,113,113,0.9);text-decoration:line-through;border-radius:2px;padding:0 1px">${p.value}</del>`
        }
        return p.value
      }).join('')
      setHtml(renderPreviewContent(merged))
    }, 0)
    return () => clearTimeout(id)
  }, [prev, next])
  if (html === null) return LOADING_PLACEHOLDER
  return (
    <div
      className="berean-preview-prose berean-notes-text px-6 py-4 overflow-y-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default function NoteVersionHistory({
  noteId, currentContent, currentTitle, onClose, onRestored,
}: {
  noteId: string
  currentContent: string
  currentTitle: string
  onClose: () => void
  onRestored: (content: string) => void
}) {
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'preview' | 'diff'>('preview')
  const [undoVersionId, setUndoVersionId] = useState<string | null>(null)

  async function reload() {
    const v = await window.notes.getNoteVersions(noteId).catch(() => [])
    setVersions(v)
    return v
  }
  useEffect(() => { reload().then(v => setSelectedId(s => s ?? v[0]?.id ?? null)) }, [noteId]) // eslint-disable-line

  const selected = versions.find(v => v.id === selectedId) ?? null

  async function restore(v: NoteVersion) {
    const res = await window.notes.restoreNoteVersion(noteId, v.id).catch(() => null)
    if (res?.success && res.content != null) {
      onRestored(res.content)
      const fresh = await reload()
      // The newest version is now the 'pre-restore' snapshot of what we replaced — offer undo.
      const preRestore = fresh.find(x => x.kind === 'pre-restore')
      setUndoVersionId(preRestore?.id ?? null)
      setSelectedId(fresh[0]?.id ?? null)
    }
  }

  const [justSaved, setJustSaved] = useState(false)
  async function saveManual() {
    const res = await window.notes.createNoteVersion(noteId, currentTitle, currentContent, 'manual').catch(() => null)
    if (res?.success) {
      const fresh = await reload()
      if (!res.skipped) setSelectedId(fresh[0]?.id ?? null)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 1600)
    }
  }

  async function undo() {
    if (!undoVersionId) return
    const res = await window.notes.restoreNoteVersion(noteId, undoVersionId).catch(() => null)
    if (res?.success && res.content != null) {
      onRestored(res.content)
      await reload()
      setUndoVersionId(null)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      size="xl"
      title="Version history"
      description={currentTitle || 'Untitled'}
      bodyClassName="flex flex-col overflow-hidden"
      headerActions={(
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" icon={Save} onClick={saveManual}>
            {justSaved ? 'Saved' : 'Save version'}
          </Button>
          {selected && (
            <SegmentedControl
              size="sm"
              value={mode}
              onChange={setMode}
              aria-label="Version view mode"
              options={[
                { value: 'diff', label: 'Changes', icon: GitCompare },
                { value: 'preview', label: 'Preview', icon: Eye },
              ]}
            />
          )}
        </div>
      )}
    >
      <div className="flex flex-1 min-h-0 h-full">
        {/* Version list */}
        <div className="w-56 flex-shrink-0 border-r border-separator overflow-y-auto py-1">
          {versions.length === 0 && (
            <p className="px-3 py-4 text-footnote text-text-muted text-center">No saved versions yet. Versions are captured as you edit.</p>
          )}
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelectedId(v.id)}
              className={`w-full text-left px-3 py-2 border-l-2 transition-colors cursor-pointer ${
                selectedId === v.id
                  ? 'bg-surface-3 border-accent'
                  : 'border-transparent hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-footnote text-text-primary">{relativeTime(v.createdAt)}</span>
                <span className={`text-micro px-1 py-0.5 rounded-chip uppercase tracking-wide ${v.kind === 'manual' ? 'bg-accent-muted text-accent' : 'bg-surface-4 text-text-muted'}`}>{KIND_LABEL[v.kind] ?? v.kind}</span>
              </div>
              <div className="text-caption2 text-text-muted mt-0.5">{fullTime(v.createdAt)}</div>
            </button>
          ))}
        </div>

        {/* Viewer */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selected ? (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {mode === 'diff' ? (
                  // Word-level diff rendered through the markdown engine — shows proper
                  // headings, verse blocks, etc. with green/red change highlights.
                  <RenderedDiffView prev={selected.content} next={currentContent} />
                ) : (
                  // Rendered preview — same renderPreviewContent engine as the diff view
                  // so both tabs look identical in font, spacing, and element styles.
                  <RenderedPreviewView content={selected.content} />
                )}
              </div>
              <div className="flex items-center gap-2 px-4 py-2.5 border-t border-separator flex-shrink-0">
                <span className="text-caption2 text-text-muted">
                  {mode === 'diff' ? 'Changes vs. current — green = added since, red = removed since' : 'Read-only — restore to edit'}
                </span>
                <div className="flex-1" />
                {undoVersionId && (
                  <Button variant="ghost" size="sm" icon={RotateCcw} onClick={undo}>Undo restore</Button>
                )}
                <Button variant="primary" size="sm" icon={RotateCcw} onClick={() => restore(selected)}>
                  Restore this version
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-subhead text-text-muted opacity-50">
              Select a version to view
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
