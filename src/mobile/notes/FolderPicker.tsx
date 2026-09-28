import React, { useEffect, useMemo, useState } from 'react'
import { Check, Folder } from 'lucide-react'
import type { NoteFolder } from '@/types'
import { ListSection, Row } from '../primitives/Page'
import { buildFolderTree, type FolderNode } from './notesHomeModel'

/** Folder list used by "Move to folder…" (note editor menu), the notes list's Move, and a folder's
 *  own Move. Nested folders show as an indented tree. `null` = no folder / the top level.
 *  `exclude` hides folders a folder cannot move into (itself and its descendants). */
export function FolderPicker({ current, onPick, exclude, noneLabel = 'No folder' }: {
  current: string | null | undefined; onPick: (id: string | null) => void; exclude?: ReadonlySet<string>; noneLabel?: string
}) {
  const [folders, setFolders] = useState<NoteFolder[]>([])
  useEffect(() => { window.notes.getFolders().then(setFolders).catch(() => setFolders([])) }, [])
  const rows = useMemo(() => {
    const out: FolderNode[] = []
    const walk = (ns: FolderNode[]) => { for (const n of ns) { if (exclude?.has(n.folder.id)) continue; out.push(n); walk(n.children) } }
    walk(buildFolderTree(folders, []))
    return out
  }, [folders, exclude])
  return (
    <ListSection>
      <Row title={noneLabel} right={current === null ? <Check size={18} aria-label="Current" /> : undefined} onClick={() => onPick(null)} />
      {rows.map((n) => (
        <Row key={n.folder.id} leading={<span className="m-folder-pick-indent" style={{ paddingLeft: n.depth * 18 }}><Folder size={18} aria-hidden /></span>}
          title={n.folder.name} right={current === n.folder.id ? <Check size={18} aria-label="Current" /> : undefined} onClick={() => onPick(n.folder.id)} />
      ))}
    </ListSection>
  )
}
