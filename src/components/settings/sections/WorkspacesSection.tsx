import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'

export default function WorkspacesSection() {
  const panelLayout = useAppStore((s) => s.panelLayout)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const savedWorkspaces = useAppStore((s) => s.savedWorkspaces)
  const setSavedWorkspaces = useAppStore((s) => s.setSavedWorkspaces)
  const updatePanelLayout = useAppStore((s) => s.updatePanelLayout)

  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    window.workspaces.list().then(setSavedWorkspaces).catch(() => {})
  }, [setSavedWorkspaces])

  async function saveWorkspace() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const layoutJson = JSON.stringify(panelLayout)
      const stateJson = JSON.stringify({ tabs, activeTabId })
      const ws = await window.workspaces.save(newName.trim(), layoutJson, stateJson)
      setSavedWorkspaces([ws, ...savedWorkspaces])
      setNewName('')
    } finally {
      setSaving(false)
    }
  }

  async function loadWorkspace(id: string) {
    const ws = await window.workspaces.load(id).catch(() => null)
    if (!ws) return
    try {
      const layout = JSON.parse(ws.layout_json)
      updatePanelLayout(layout)
    } catch {}
  }

  async function deleteWorkspace(id: string) {
    await window.workspaces.delete(id).catch(() => {})
    setSavedWorkspaces(savedWorkspaces.filter((w) => w.id !== id))
  }

  async function finishRename(id: string) {
    const name = renameValue.trim()
    if (name) {
      await window.workspaces.rename(id, name).catch(() => {})
      setSavedWorkspaces(savedWorkspaces.map((w) => w.id === id ? { ...w, name } : w))
    }
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-[rgb(var(--color-text-primary))] mb-1">Saved workspaces</p>
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))]">
          Save a named snapshot of the current panel layout. Load it later to restore that arrangement. Tab contents are not restored — only the panel split configuration.
        </p>
      </div>

      {/* Save current */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveWorkspace()}
          placeholder="Name this workspace…"
          className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
        />
        <button
          onClick={saveWorkspace}
          disabled={!newName.trim() || saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-[rgb(var(--color-accent))] text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {/* List */}
      {savedWorkspaces.length === 0 ? (
        <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] text-center py-4">No saved workspaces yet</p>
      ) : (
        <div className="space-y-1.5">
          {savedWorkspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
              {renamingId === ws.id ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(ws.id)
                    if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                  }}
                  onBlur={() => finishRename(ws.id)}
                  autoFocus
                  className="flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none border-b border-[rgb(var(--color-accent))]"
                />
              ) : (
                <span className="flex-1 text-xs text-[rgb(var(--color-text-primary))] truncate">{ws.name}</span>
              )}
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">
                {new Date(ws.created_at).toLocaleDateString()}
              </span>
              <button
                onClick={() => loadWorkspace(ws.id)}
                title="Load this workspace"
                className="text-[10px] px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
              >
                Load
              </button>
              <button
                onClick={() => { setRenamingId(ws.id); setRenameValue(ws.name) }}
                title="Rename"
                className="text-[10px] px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
              >
                Rename
              </button>
              <button
                onClick={() => deleteWorkspace(ws.id)}
                title="Delete this workspace"
                className="text-[rgb(var(--color-text-muted))] hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
