import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import { useIsActivePanel } from '@/components/shell/ActivePanelContext'
import { useAppStore } from '@/store'
import { Waypoints } from 'lucide-react'
import type { TagCoOccurrence, TagEdge, TagGraphData, VerseTag } from '@/types'
import TagGraphCanvas, { clampZoom, type CanvasView } from './TagGraphCanvas'
import TagGraphControls from './TagGraphControls'
import TagGraphSidePanel from './TagGraphSidePanel'
import TagEdgeEditorPopover, { type EdgeDraft } from './TagEdgeEditorPopover'
import { seedNodes, stepLayout, nodeRadius, edgeCountByTag, type SimNode } from './tagForceLayout'

const VIEW_KEY = 'tagsGraph.view'
const DRAFT_ID = '__draft__'

export default function TagsGraphPanel() {
  const isActive = useIsActivePanel('tags')
  const verseTagChangeToken = useAppStore((s) => s.verseTagChangeToken)
  const setVerseTags = useAppStore((s) => s.setVerseTags)

  const [data, setData] = useState<TagGraphData | null>(null)
  const dataRef = useRef<TagGraphData | null>(null)
  dataRef.current = data
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, zoom: 1 })
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EdgeDraft | null>(null)
  const [editorAt, setEditorAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [showCoOccurrence, setShowCoOccurrence] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [search, setSearch] = useState('')
  const [, setFrame] = useState(0)

  const nodesRef = useRef<Map<string, SimNode>>(new Map())
  const fitRef = useRef<((ids?: string[]) => void) | null>(null)
  const settleRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  // ── Load persisted view once ──
  useEffect(() => {
    window.settings.get(VIEW_KEY).then((v) => {
      const parsed = v as Partial<CanvasView & { selectedTagId: string | null }> | null
      if (parsed && typeof parsed.zoom === 'number') {
        setView({ x: parsed.x ?? 0, y: parsed.y ?? 0, zoom: clampZoom(parsed.zoom) })
      }
      if (parsed && parsed.selectedTagId) setSelectedTagId(parsed.selectedTagId)
    }).catch(() => {})
  }, [])

  // Persist view + selection (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      void window.settings.set(VIEW_KEY, { ...view, selectedTagId }).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [view, selectedTagId])

  // ── Load graph data (on mount, on tab changes elsewhere) ──
  const reload = useCallback(async () => {
    try {
      const g = await window.tagGraph.getGraph()
      setData(g)
    } catch { /* bridge not ready */ }
  }, [])
  useEffect(() => { void reload() }, [reload, verseTagChangeToken])

  // ── Seed / reconcile sim nodes when tags change ──
  useEffect(() => {
    if (!data) return
    const center = { x: 600, y: 400 }
    const seeded = seedNodes(data.tags, data.edges, center)
    const prev = nodesRef.current
    const next = new Map<string, SimNode>()
    const ec = edgeCountByTag(data.edges)
    for (const s of seeded) {
      const p = prev.get(s.id)
      next.set(s.id, p ? { ...p, r: nodeRadius(data.tags.find((t) => t.id === s.id)!, ec.get(s.id) ?? 0), pinned: s.pinned } : s)
    }
    nodesRef.current = next
    settleRef.current = 0
    setFrame((f) => f + 1)
  }, [data])

  // Persist any pinned node whose position the collision-resolution pass has nudged, so a
  // deliberate placement that had to give way to un-stack survives a reload.
  const flushPinned = useCallback(() => {
    const d = dataRef.current
    if (!d) return
    const moved: Array<{ id: string; x: number; y: number }> = []
    for (const t of d.tags) {
      const n = nodesRef.current.get(t.id)
      if (!n || !n.pinned) continue
      if (t.graphX == null || t.graphY == null || Math.hypot((t.graphX ?? 0) - n.x, (t.graphY ?? 0) - n.y) > 1.5) {
        moved.push({ id: t.id, x: n.x, y: n.y })
      }
    }
    if (!moved.length) return
    for (const m of moved) void window.tagGraph.setTagPosition(m.id, m.x, m.y, true)
    const byId = new Map(moved.map((m) => [m.id, m]))
    setData((cur) => cur ? { ...cur, tags: cur.tags.map((t) => byId.has(t.id) ? { ...t, graphX: byId.get(t.id)!.x, graphY: byId.get(t.id)!.y } : t) } : cur)
  }, [])

  // ── Force sim rAF loop (shared by the mount effect and kick()) ──
  const runSim = useCallback(() => {
    if (rafRef.current != null || !data) return
    const center = { x: 600, y: 400 }
    const loop = () => {
      const disp = stepLayout([...nodesRef.current.values()], data.edges, { center })
      setFrame((f) => (f + 1) % 1_000_000)
      settleRef.current = disp < 0.4 ? settleRef.current + 1 : 0
      if (settleRef.current < 30) {
        rafRef.current = requestAnimationFrame(loop)
      } else {
        rafRef.current = null
        flushPinned()
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [data, flushPinned])

  useEffect(() => {
    if (!isActive || !data) return
    runSim()
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }
  }, [isActive, data, runSim])

  const kick = useCallback(() => {
    settleRef.current = 0
    runSim()
  }, [runSim])

  const tags = data?.tags ?? []
  const edges = data?.edges ?? []
  const coOccurrence: TagCoOccurrence[] = data?.coOccurrence ?? []
  const tagName = (id: string | null) => tags.find((t) => t.id === id)?.name ?? '?'

  // ── Graph search dim set ──
  const dimmedTagIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const matches = new Set(tags.filter((t) => t.name.toLowerCase().includes(q)).map((t) => t.id))
    return new Set(tags.filter((t) => !matches.has(t.id)).map((t) => t.id))
  }, [search, tags])

  useEffect(() => {
    const q = search.trim().toLowerCase()
    if (!q) return
    const ids = tags.filter((t) => t.name.toLowerCase().includes(q)).map((t) => t.id)
    if (ids.length) fitRef.current?.(ids)
  }, [search, tags])

  // ── Edge / node interactions ──
  const edgesWithDraft: TagEdge[] = useMemo(() => {
    if (!draft || draft.id) return edges
    return [...edges, {
      id: DRAFT_ID, source: draft.source, target: draft.target, arrows: draft.arrows,
      color: draft.color, dashed: true, note: draft.note, createdAt: 0, updatedAt: 0,
    }]
  }, [edges, draft])

  // Open the edge editor for src→tgt: edit the existing edge if there is one, else start a draft.
  const startEdgeBetween = useCallback((src: string, tgt: string) => {
    if (src === tgt) { setPendingSourceId(null); return }
    setPendingSourceId(null)
    setSelectedTagId(null)
    const existing = edges.find((e) => e.source === src && e.target === tgt)
    const s = nodesRef.current.get(src)
    const t = nodesRef.current.get(tgt)
    setEditorAt(s && t
      ? { x: view.x + ((s.x + t.x) / 2) * view.zoom, y: view.y + ((s.y + t.y) / 2) * view.zoom }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 })
    if (existing) {
      setSelectedEdgeId(existing.id)
      setDraft({ id: existing.id, source: existing.source, target: existing.target, arrows: existing.arrows, color: existing.color, dashed: existing.dashed, note: existing.note })
    } else {
      setSelectedEdgeId(null)
      setDraft({ source: src, target: tgt, arrows: 'none', color: null, dashed: false, note: '' })
    }
  }, [edges, view])

  function handleNodeClick(id: string) {
    setSelectedEdgeId(null)
    if (!pendingSourceId) {
      setPendingSourceId(id)
      setSelectedTagId(id)
      return
    }
    if (pendingSourceId === id) { setPendingSourceId(null); return }
    startEdgeBetween(pendingSourceId, id)
  }

  function handleEdgeClick(id: string) {
    if (id === DRAFT_ID) return
    const e = edges.find((x) => x.id === id)
    if (!e) return
    setPendingSourceId(null)
    setSelectedEdgeId(id)
    const s = nodesRef.current.get(e.source)
    const t = nodesRef.current.get(e.target)
    const at = s && t
      ? { x: view.x + ((s.x + t.x) / 2) * view.zoom, y: view.y + ((s.y + t.y) / 2) * view.zoom }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    setEditorAt(at)
    setDraft({ id: e.id, source: e.source, target: e.target, arrows: e.arrows, color: e.color, dashed: e.dashed, note: e.note })
  }

  async function commitDraft() {
    if (!draft || draft.id) return
    const res = await window.tagGraph.createEdge(draft.source, draft.target)
    if (res.created) {
      setData((d) => d ? { ...d, edges: [...d.edges, res.edge] } : d)
      setDraft({ ...draft, id: res.edge.id })
      setSelectedEdgeId(res.edge.id)
      kick()
    } else if ('conflict' in res && res.conflict) {
      setData((d) => d ? { ...d, edges: d.edges.some((e) => e.id === res.existing.id) ? d.edges : [...d.edges, res.existing] } : d)
      setDraft({ id: res.existing.id, source: res.existing.source, target: res.existing.target, arrows: res.existing.arrows, color: res.existing.color, dashed: res.existing.dashed, note: res.existing.note })
      setSelectedEdgeId(res.existing.id)
    }
  }

  async function patchEdge(patch: Partial<Pick<TagEdge, 'arrows' | 'color' | 'dashed' | 'note'>>) {
    if (!draft?.id) { setDraft((d) => d ? { ...d, ...patch } as EdgeDraft : d); return }
    setData((d) => d ? { ...d, edges: d.edges.map((e) => e.id === draft.id ? { ...e, ...patch } : e) } : d)
    setDraft((d) => d ? { ...d, ...patch } as EdgeDraft : d)
    try {
      const res = await window.tagGraph.updateEdge(draft.id, patch)
      if (res.edges) setData((d) => d ? { ...d, edges: res.edges! } : d)
    } catch { /* ignore */ }
  }

  async function deleteEdge() {
    if (!draft?.id) { setDraft(null); return }
    const res = await window.tagGraph.deleteEdge(draft.id)
    setData((d) => d ? { ...d, edges: res.edges } : d)
    setDraft(null)
    setSelectedEdgeId(null)
  }

  function closeEditor() { setDraft(null); setSelectedEdgeId(null) }

  // ── Tag CRUD (side panel) ──
  const refreshTags = useCallback((list: VerseTag[]) => {
    setVerseTags(list)
    setData((d) => d ? { ...d, tags: list } : d)
  }, [setVerseTags])

  const resetLayout = useCallback(async () => {
    await Promise.all(tags.filter((t) => t.graphPinned).map((t) => window.tagGraph.setTagPosition(t.id, null, null, false)))
    for (const n of nodesRef.current.values()) n.pinned = false
    await reload()
    kick()
    // also re-centre the view: let the re-seed settle a beat, then frame the whole graph
    setView({ x: 0, y: 0, zoom: 1 })
    window.setTimeout(() => fitRef.current?.(), 260)
  }, [tags, reload, kick])

  return (
    <div className="absolute inset-0 flex bg-[rgb(var(--color-surface-1))] native-buttons">
      <TabHeaderPortal active={isActive}>
        <span className="flex items-center gap-1.5 text-sm font-medium text-[rgb(var(--color-text-primary))]">
          <Waypoints size={14} className="text-[#b06fe8]" /> Tags
        </span>
      </TabHeaderPortal>

      <TagGraphSidePanel
        tags={tags}
        edges={edges}
        selectedTagId={selectedTagId}
        search={search}
        onSearch={setSearch}
        onSelectTag={(id) => { setSelectedTagId(id); setPendingSourceId(null) }}
        onCreateTag={async (name) => { refreshTags(await window.verseTags.create(name)) }}
        onRenameTag={async (id, name) => { refreshTags(await window.verseTags.rename(id, name)) }}
        onSetSlot={async (id, slot) => { refreshTags(await window.verseTags.setColorSlot(id, slot)) }}
        onMergeTag={async (fromId, intoId) => { refreshTags(await window.verseTags.merge(fromId, intoId)); setSelectedTagId(intoId); void reload() }}
        onDeleteTag={async (id) => {
          const res = await window.verseTags.delete(id)
          if (res.blocked && !window.confirm(`Delete “${res.name}”? It is referenced in ${res.noteRefCount} note(s).`)) return
          const done = res.deleted ? res : await window.verseTags.delete(id, true)
          if (done.list) refreshTags(done.list)
          setSelectedTagId(null)
          void reload()
        }}
      />

      <div className="relative flex-1">
        <TagGraphCanvas
          tags={tags}
          nodes={nodesRef.current}
          edges={edgesWithDraft}
          coOccurrence={coOccurrence}
          showCoOccurrence={showCoOccurrence}
          showLabels={showLabels}
          selectedTagId={selectedTagId}
          selectedEdgeId={selectedEdgeId}
          pendingSourceId={pendingSourceId}
          dimmedTagIds={dimmedTagIds}
          view={view}
          onViewChange={setView}
          onNodeClick={handleNodeClick}
          onNodeDrag={(id, x, y) => {
            const n = nodesRef.current.get(id)
            if (n) { n.x = x; n.y = y; n.vx = 0; n.vy = 0; setFrame((f) => f + 1) }
          }}
          onNodeDragEnd={(id, x, y) => {
            const n = nodesRef.current.get(id)
            if (n) { n.x = x; n.y = y; n.pinned = true }
            void window.tagGraph.setTagPosition(id, x, y, true)
            setData((d) => d ? { ...d, tags: d.tags.map((t) => t.id === id ? { ...t, graphX: x, graphY: y, graphPinned: true } : t) } : d)
            kick()
          }}
          onNodeConnect={(src, tgt) => startEdgeBetween(src, tgt)}
          onEdgeClick={handleEdgeClick}
          onBackgroundClick={() => { setPendingSourceId(null); setSelectedTagId(null); closeEditor() }}
          registerFitter={(fn) => { fitRef.current = fn }}
        />

        <TagGraphControls
          onZoomIn={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom * 1.2) }))}
          onZoomOut={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom / 1.2) }))}
          onFit={() => fitRef.current?.()}
          onResetLayout={resetLayout}
          showCoOccurrence={showCoOccurrence}
          showLabels={showLabels}
          onToggleCoOccurrence={() => setShowCoOccurrence((v) => !v)}
          onToggleLabels={() => setShowLabels((v) => !v)}
        />

        {data?.coOccurrenceOmitted && (
          <div className="absolute bottom-4 left-4 z-20 text-[11px] text-[rgb(var(--color-text-secondary))] rounded-shell glass-panel px-2.5 py-1.5">
            Shared-verse links omitted (large dataset)
          </div>
        )}

        {draft && (
          <TagEdgeEditorPopover
            draft={draft}
            at={editorAt}
            sourceName={tagName(draft.source)}
            targetName={tagName(draft.target)}
            onChange={patchEdge}
            onCommitDraft={commitDraft}
            onDelete={deleteEdge}
            onClose={closeEditor}
          />
        )}
      </div>
    </div>
  )
}
