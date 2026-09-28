import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { TextField, Button, IconButton } from '@/components/ui'
import { buildWorkspaceState, parseWorkspaceState } from '@/lib/workspaceSnapshot'

export default function WorkspacesSection() {
  const panelLayout = useAppStore((s) => s.panelLayout)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const savedWorkspaces = useAppStore((s) => s.savedWorkspaces)
  const setSavedWorkspaces = useAppStore((s) => s.setSavedWorkspaces)
  const updatePanelLayout = useAppStore((s) => s.updatePanelLayout)
  const openWorkspaceSession = useAppStore((s) => s.openWorkspaceSession)

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
      // v2 snapshot: tabs, active tabs, unified display order, session icon (src/lib/workspaceSnapshot.ts)
      const st = useAppStore.getState()
      const stateJson = JSON.stringify(buildWorkspaceState({
        tabs, activeTabId,
        displayOrder: st.sessionDisplayOrders[st.currentSessionId],
        icon: st.sessions.find((x) => x.id === st.currentSessionId)?.icon,
      }))
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
    // Tabs first (opens/switches to the workspace's session), then the panel layout. Old
    // records (NULL or v1 state_json) still load: parseWorkspaceState never throws.
    openWorkspaceSession({ id: ws.id, name: ws.name }, parseWorkspaceState(ws.state_json))
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
        <p className="text-subhead font-medium text-text-primary mb-1">Saved sessions</p>
        <p className="s-desc text-caption text-text-muted">
          Save a named snapshot of the current panel layout. Load it later to restore that arrangement. Tab contents are not restored — only the panel split configuration.
        </p>
      </div>

      {/* Save current */}
      <div className="flex gap-2">
        <TextField
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveWorkspace()}
          placeholder="Name this saved session…"
          wrapperClassName="flex-1"
        />
        <Button variant="primary" size="sm" onClick={saveWorkspace} disabled={!newName.trim() || saving}>
          Save
        </Button>
      </div>

      {/* List */}
      {savedWorkspaces.length === 0 ? (
        <p className="s-desc text-caption text-text-muted text-center py-4">No saved sessions yet</p>
      ) : (
        <div className="space-y-1.5">
          {savedWorkspaces.map((ws) => (
            <div key={ws.id} className="flex items-center gap-2 px-3 py-2 rounded-row bg-surface-elevated">
              {renamingId === ws.id ? (
                <TextField
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(ws.id)
                    if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                  }}
                  onBlur={() => finishRename(ws.id)}
                  autoFocus
                  bare
                  wrapperClassName="flex-1"
                  className="border-b border-accent rounded-none"
                />
              ) : (
                <span className="flex-1 text-footnote text-text-primary truncate">{ws.name}</span>
              )}
              <span className="text-caption2 text-text-muted flex-shrink-0">
                {new Date(ws.created_at).toLocaleDateString()}
              </span>
              <Button size="sm" variant="ghost" onClick={() => loadWorkspace(ws.id)} tooltip="Open this saved session (its tabs and layout) as a session" className="flex-shrink-0">
                Load
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => { setRenamingId(ws.id); setRenameValue(ws.name) }}
                tooltip="Rename"
                className="flex-shrink-0"
              >
                Rename
              </Button>
              <IconButton icon={Trash2} label="Delete this saved session" size={20} danger onClick={() => deleteWorkspace(ws.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
