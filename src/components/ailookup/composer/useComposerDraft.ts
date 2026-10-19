import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { ChatEditorHandle } from './ChatEditor'
import { clearDraft, onDraftsChanged, readDraft, writeDraft } from './chatDrafts'

const SAVE_DELAY = 300
/** How long a handed-over draft (panel ⇄ window) follows the conversation switch that comes with it. */
const HANDOFF_CARRY_MS = 1500
/** How long text typed right after the first send of a new conversation waits for its real id. */
const SENT_CARRY_MS = 10_000

interface Carry {
  kind: 'handoff' | 'sent'
  until: number
  /** Stored drafts the carried text overwrote, put back when it moves on. */
  originals: Map<string, string>
}

/**
 * Durable per-conversation drafts for a composer (desktop ChatComposer and the iPhone thread):
 * restores the draft for `draftKey`, saves typing (debounced 300 ms, flushed on switch / unmount
 * / page hide), switches drafts when the conversation changes, clears on send, and follows the
 * text when a brand-new conversation gets its id or a handed-over draft arrives with a
 * conversation switch. Edit mode never writes the edited message into the store.
 */
export function useComposerDraft(opts: {
  draftKey: string | undefined
  editor: RefObject<ChatEditorHandle | null>
  isEditing: () => boolean
  /** The conversation changed: leave edit mode silently; return the stashed draft, if editing. */
  leaveEdit: () => string | null
}) {
  const { draftKey, editor } = opts
  const optsRef = useRef(opts)
  optsRef.current = opts
  const keyRef = useRef(draftKey)
  const pending = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const carry = useRef<Carry | null>(null)

  const cancel = () => { if (pending.current) { clearTimeout(pending.current.timer); pending.current = null } }
  const flush = () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    if (editor.current && !optsRef.current.isEditing()) writeDraft(p.key, editor.current.getMarkdown())
  }

  /** The editor's content changed by typing / formatting. */
  const changed = () => {
    const key = keyRef.current
    if (!key || optsRef.current.isEditing()) return
    if (carry.current?.kind === 'handoff') carry.current = null
    cancel()
    pending.current = { key, timer: setTimeout(flush, SAVE_DELAY) }
  }

  // Conversation switch: save the old draft, show the new one (or carry the text across).
  useLayoutEffect(() => {
    const prev = keyRef.current
    keyRef.current = draftKey
    if (prev === draftKey) return
    const ed = editor.current
    if (!ed || !draftKey) { cancel(); return }
    const c = carry.current && carry.current.until > Date.now() ? carry.current : null
    if (!c) carry.current = null
    const stash = optsRef.current.leaveEdit()
    if (c && (c.kind === 'handoff' || prev === 'new')) {
      cancel()
      const md = stash ?? ed.getMarkdown()
      if (prev && c.originals.has(prev)) writeDraft(prev, c.originals.get(prev)!)
      if (!c.originals.has(draftKey)) c.originals.set(draftKey, readDraft(draftKey))
      writeDraft(draftKey, md)
      if (stash != null) ed.setMarkdown(stash)
      if (c.kind === 'sent') carry.current = null
      return
    }
    flush()
    if (stash != null && prev) writeDraft(prev, stash)
    ed.setMarkdown(readDraft(draftKey), { focus: ed.hasFocus() })
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Another window changed the drafts (panel ⇄ chat window): follow it while not typing here.
  useEffect(() => onDraftsChanged(() => {
    const key = keyRef.current
    const ed = editor.current
    if (!key || !ed || ed.hasFocus() || pending.current || optsRef.current.isEditing()) return
    const md = readDraft(key)
    if (md !== ed.getMarkdown()) ed.setMarkdown(md)
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => { window.removeEventListener('pagehide', onHide); window.removeEventListener('beforeunload', onHide); flush() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    /** The stored draft to open with. */
    initial: () => (draftKey ? readDraft(draftKey) : ''),
    changed,
    flush,
    /** A message was sent from the field: its draft is gone. */
    sent: () => {
      cancel()
      const key = keyRef.current
      if (!key) return
      clearDraft(key)
      if (key === 'new') carry.current = { kind: 'sent', until: Date.now() + SENT_CARRY_MS, originals: new Map() }
    },
    /** Text put in the field from outside (a handoff, Ask About): saved at once; it follows a
     *  conversation switch that arrives right after it. An empty value just empties the field
     *  (a draft that moved to the other window stays stored for it). */
    adopted: (md: string) => {
      cancel()
      const key = keyRef.current
      if (!key || !md.trim()) return
      const originals = new Map<string, string>([[key, readDraft(key)]])
      writeDraft(key, md)
      carry.current = { kind: 'handoff', until: Date.now() + HANDOFF_CARRY_MS, originals }
    },
    /** Save the stash (the draft put aside while editing a message) for the current key. */
    saveStash: (md: string) => { const key = keyRef.current; if (key) writeDraft(key, md) },
  }
}
