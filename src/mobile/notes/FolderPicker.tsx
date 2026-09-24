import React, { useEffect, useState } from 'react'
import type { NoteFolder } from '@/types'
import { ListSection, Row } from '../primitives/Page'

/** Folder list used by "Move to folder…" (note editor menu) and the notes-list long-press
 *  "Move…" action. `null` = no folder. */
export function FolderPicker({ current, onPick }: { current: string | null; onPick: (id: string | null) => void }) {
  const [folders, setFolders] = useState<NoteFolder[]>([])
  useEffect(() => { window.notes.getFolders().then(setFolders).catch(() => setFolders([])) }, [])
  return (
    <ListSection>
      <Row title="No folder" right={current === null ? '✓' : undefined} onClick={() => onPick(null)} />
      {folders.map((f) => <Row key={f.id} title={f.name} right={current === f.id ? '✓' : undefined} onClick={() => onPick(f.id)} />)}
    </ListSection>
  )
}
