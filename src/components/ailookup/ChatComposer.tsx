import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { Sparkles, Maximize2, Minimize2, Pencil, X } from 'lucide-react'
import type { EditorState } from 'prosemirror-state'
import { useAppStore } from '@/store'
import { IconButton, cx } from '@/components/ui'
import { mentionsCurrentTab, type ChatMsg } from './chatModel'
import { ChatReplyBar } from './ChatReplyQuote'
import { ChatModeMenu, ChatContextToggle, ComposerPopoverContext } from './ChatComposerControls'
import { chatModeFlags, chatModeOf } from './chatModes'
import type { ChatSendOptions } from './useChatController'
import { ChatEditor, type ChatEditorHandle } from './composer/ChatEditor'
import { FormatToolbar } from './composer/FormatToolbar'
import { activeFormats, NO_FORMATS, sameFormats, type ActiveFormats } from './composer/chatEditorState'
import { useComposerDraft } from './composer/useComposerDraft'

/** A message being edited in the composer (its id, owner and original text). */
export interface ChatEditTarget { id: string; chatId: string | null; text: string; isRequest: boolean }

export interface ChatComposerHandle {
  focus: () => void
  /** Load a sent message into the field for editing (the draft is put aside and comes back after). */
  beginEdit: (target: ChatEditTarget) => void
  /** Put `text` in the field with Ask Berean armed (a plain message → a question about it). */
  askAbout: (text: string) => void
  /** The unsent draft as markdown (carried to / from the chat window). */
  getDraft: () => string
  setDraft: (text: string) => void
}

/** Auto-grow stops at about five lines; past that the field scrolls (or the user expands it). */
const MAX_HEIGHT = 100
/** The expanded field takes this share of the chat surface's height. */
const EXPANDED_SHARE = 0.55

/**
 * Message composer. A rich-text field (ProseMirror, composer/ChatEditor.tsx) whose value is the
 * message's markdown: **bold** shows as bold while typing, never as asterisks. Plain "Message" is
 * the default and is never sent to the AI. The sparkle button arms "Ask Berean" for the NEXT send
 * only (tinted field, "Ask Berean…" placeholder). While composing, the conversation selector
 * (`destination`) sits in the typing line just left of expand; with Ask Berean armed a slim
 * accessory row inside the field shows the mode (Commentary / Deep Search / Passages Only,
 * chatModes.ts) and the separate Include This Tab toggle, which names what it will send. Return sends (there is no Send
 * button on desktop; inside a code block Return is a new line), Shift+Return is a new line,
 * ⌘Return sends as Ask Berean. A quiet formatting row opens above the text while the field is
 * focused or expanded. The field is never user-resizable: it grows to ~5 lines and then scrolls;
 * the expand button makes it a tall editor (and back). Drafts are kept per conversation
 * (`draftKey`, device-local, survive relaunch — composer/chatDrafts.ts), and typing never
 * re-renders the transcript.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, {
  onSend: (text: string, opts: ChatSendOptions) => Promise<boolean> | boolean
  /** Ask Berean can run here (local model found). */
  aiAvailable: boolean
  /** Why it can't, shown as the disabled toggle's tooltip / caption. */
  aiUnavailableReason?: string
  aiBusy: boolean
  /** Where the message will go — the conversation selector (accessory row). */
  destination?: ReactNode
  /** Keep the accessory row visible even while idle (All Messages / a day: the destination is
   *  not otherwise visible there). */
  destinationAlwaysVisible?: boolean
  /** What "This Tab" would send right now ("John 3"), null when the tab has nothing usable;
   *  undefined = not known yet. */
  tabContextLabel?: string | null
  /** Ask the host to re-read the active tab (on arming / focus — it can change while open). */
  onRefreshTabContext?: () => void
  /** Floating glass capsule (window / phone) vs. the panel's in-flow bar. */
  floating?: boolean
  /** Return while editing: save the edited text (a note) or ask again (a question). */
  onEditSubmit?: (target: ChatEditTarget, text: string) => void
  onEditingChange?: (id: string | null) => void
  /** Which conversation the draft belongs to (chat id, or 'new' for an unsaved one) — drafts are
   *  kept per conversation (device-local). Without it the draft lives only in the field. */
  draftKey?: string
  /** The message the next send replies to ("Replying to …" bar; Esc / × cancels). */
  replyingTo?: ChatMsg | null
  onCancelReply?: () => void
}>(function ChatComposer({ onSend, aiAvailable, aiUnavailableReason, aiBusy, destination, destinationAlwaysVisible, tabContextLabel, onRefreshTabContext, floating, onEditSubmit, onEditingChange, draftKey, replyingTo, onCancelReply }, ref) {
  const [plain, setPlain] = useState('')
  const [formats, setFormats] = useState<ActiveFormats>(NO_FORMATS)
  const [focused, setFocused] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [fmtMenuOpen, setFmtMenuOpen] = useState(false)
  const [accPopover, setAccPopover] = useState(false)
  const capsuleRef = useRef<HTMLDivElement | null>(null)
  const accCtx = useMemo(() => ({ report: setAccPopover, anchor: capsuleRef }), [])
  const [askArmed, setAskArmed] = useState(false)
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null)
  const expanded = expandedHeight != null
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<ChatEditorHandle | null>(null)
  const sendingRef = useRef(false)
  const [editTarget, setEditTarget] = useState<ChatEditTarget | null>(null)
  const stashRef = useRef<string | null>(null)
  const editRef = useRef(editTarget)
  editRef.current = editTarget
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const drafts = useComposerDraft({
    draftKey,
    editor: editorRef,
    isEditing: () => !!editRef.current,
    leaveEdit: () => {
      if (!editRef.current) return null
      const stash = stashRef.current ?? ''
      stashRef.current = null
      editRef.current = null
      setEditTarget(null)
      onEditingChange?.(null)
      return stash
    },
  })
  const [initialMarkdown] = useState(drafts.initial)

  const md = () => editorRef.current?.getMarkdown() ?? ''
  const load = (value: string, focus = true) => editorRef.current?.setMarkdown(value, { focus })

  const endEdit = () => {
    setEditTarget(null)
    editRef.current = null
    load(stashRef.current ?? '')
    stashRef.current = null
    onEditingChange?.(null)
  }
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    beginEdit: (target) => {
      if (!editRef.current) { drafts.flush(); stashRef.current = md() }
      editRef.current = target
      setEditTarget(target)
      load(target.text)
      setAskArmed(false)
      onEditingChange?.(target.id)
    },
    askAbout: (value) => {
      if (editRef.current) endEdit()
      load(value)
      drafts.changed()
      setAskArmed(true)
    },
    getDraft: () => (editRef.current ? stashRef.current ?? '' : md()),
    setDraft: (value) => {
      if (editRef.current) { stashRef.current = value; if (value.trim()) drafts.saveStash(value); return }
      load(value)
      drafts.adopted(value)
    },
  }), [onEditingChange]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = () => {
    if (expanded) { setExpandedHeight(null) }
    else {
      const surface = wrapRef.current?.parentElement
      setExpandedHeight(Math.max(160, Math.round((surface?.clientHeight ?? 400) * EXPANDED_SHARE)))
    }
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const commentaryOn = useAppStore((s) => s.aiLookupCommentaryOn)
  const setCommentaryOn = useAppStore((s) => s.setAiLookupCommentaryOn)
  const deepOn = useAppStore((s) => s.aiLookupAgenticOn)
  const setDeepOn = useAppStore((s) => s.setAiLookupAgenticOn)
  const tabOn = useAppStore((s) => s.aiLookupUseTabContext)
  const setTabOn = useAppStore((s) => s.setAiLookupUseTabContext)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)

  const ai = askArmed && aiAvailable
  const mode = chatModeOf(commentaryOn, deepOn)
  const setMode = (m: ReturnType<typeof chatModeOf>) => { const f = chatModeFlags(m); setCommentaryOn(f.commentary); setDeepOn(f.deepSearch) }
  const mentioned = mentionsCurrentTab(plain)
  // Re-read the active tab whenever Ask Berean is armed (it may have changed since).
  useEffect(() => { if (askArmed) onRefreshTabContext?.() }, [askArmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // The editor's key handlers outlive any one render: they read the latest values here.
  const live = { askArmed, aiAvailable, aiBusy, commentaryOn, deepOn, tabOn, wordReplacerEnabled, wordReplacerRules, onSend, onEditSubmit, linkOpen, expanded, replying: !!replyingTo, onCancelReply }
  const liveRef = useRef(live)
  liveRef.current = live

  const submit = async (modAi: boolean) => {
    const l = liveRef.current
    // ⌘Return always asks; plain Return asks when ✦ is armed (for this one send).
    const asAi = modAi || (l.askArmed && l.aiAvailable)
    const value = md().trim()
    const target = editRef.current
    if (target) {
      if (value && value !== target.text.trim()) l.onEditSubmit?.(target, value)
      endEdit()
      return
    }
    if (!value || sendingRef.current) return
    if (asAi && (!l.aiAvailable || l.aiBusy)) return
    sendingRef.current = true
    try {
      const rules = l.wordReplacerEnabled ? l.wordReplacerRules.filter((r) => r.enabled && !r.strongsNum).map((r) => ({ queries: r.queries, replacement: r.replacement })) : []
      const opts: ChatSendOptions = asAi
        ? { ai: { commentary: l.commentaryOn, deepSearch: l.deepOn, tabContext: l.tabOn }, wordReplacerRules: rules }
        : {}
      load('')
      drafts.sent()
      setExpandedHeight(null)
      setLinkOpen(false)
      if (asAi) setAskArmed(false) // one send per arming — messaging is the default again
      const ok = await l.onSend(value, opts)
      if (!ok && editorRef.current?.isEmpty()) { load(value); drafts.changed() }
    } finally {
      sendingRef.current = false
    }
  }

  const escape = () => {
    const l = liveRef.current
    if (l.linkOpen) { setLinkOpen(false); return true }
    if (editRef.current) { endEdit(); return true }
    if (l.askArmed) { setAskArmed(false); return true }
    if (l.replying && l.onCancelReply) { l.onCancelReply(); return true }
    if (l.expanded) { setExpandedHeight(null); return true }
    return false
  }

  const onChange = (state: EditorState, docChanged: boolean) => {
    const f = activeFormats(state)
    setFormats((prev) => (sameFormats(prev, f) ? prev : f))
    setPlain(state.doc.textContent)
    if (docChanged) drafts.changed()
  }
  const onFocusChange = (f: boolean) => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
    // A short delay so a click moving between the field and its toolbar never flickers the row.
    if (f) { setFocused(true); setLinkOpen(false) } else blurTimer.current = setTimeout(() => setFocused(false), 120)
  }
  const editing = !!editTarget
  // A composer popover (conversation / mode) takes focus, but the formatting row stays put.
  const toolbarOpen = focused || expanded || linkOpen || fmtMenuOpen || accPopover
  // React 18's DOM types predate `inert`; a hidden row must not take Tab focus.
  const hiddenRow = toolbarOpen ? {} : ({ inert: '', 'aria-hidden': true } as Record<string, unknown>)
  // The accessory row while composing (or always where the destination is otherwise invisible).
  const composing = focused || expanded || !!plain.trim() || fmtMenuOpen || accPopover || ai
  // The conversation selector sits in the typing line, just left of expand; the mode and This
  // Tab ride in the accessory row only while Ask Berean is armed.
  const showDestination = !editing && !!destination && (composing || !!destinationAlwaysVisible)
  const showAccessory = !editing && ai

  return (
    <div ref={wrapRef} className={cx(floating ? 'w-full max-w-[860px] mx-auto px-4 pb-4 pt-1' : 'px-2.5 pb-2.5 pt-2 border-t border-separator')}>
      {editing && (
        <div className="flex items-center gap-1.5 px-2 pb-1 text-caption2 select-none min-h-[16px] text-accent">
          <Pencil size={10} aria-hidden />
          <span className="flex-1 truncate">{editTarget!.isRequest ? 'Editing Question — Return asks again' : 'Editing Message — Return saves'}</span>
          <IconButton icon={X} label="Cancel Editing" size={20} tooltip={{ shortcut: 'esc' }} onClick={endEdit} className="text-text-muted" />
        </div>
      )}
      {!editing && replyingTo && onCancelReply && <ChatReplyBar quoted={replyingTo} onCancel={() => { onCancelReply(); editorRef.current?.focus() }} />}
      <ComposerPopoverContext.Provider value={accCtx}>
      <div
        ref={capsuleRef}
        data-ai={ai ? 'true' : 'false'}
        className={cx(
          'chat-composer flex flex-col rounded-[20px] px-1 py-1 transition-shadow duration-base',
          floating ? 'material-popover shadow-lg' : 'bg-field',
        )}
      >
        <div className="chat-fmt-reveal" data-open={toolbarOpen ? 'true' : 'false'} {...hiddenRow}>
          <div className="pl-7">
            <FormatToolbar editor={editorRef} active={formats} variant="desktop" linkOpen={linkOpen} onLinkOpenChange={setLinkOpen} onMenuOpenChange={setFmtMenuOpen} />
          </div>
        </div>
        <div className="flex items-end gap-1">
          <div className="flex items-center flex-shrink-0 self-end">
            {/* A disabled button gets no hover, so the reason rides on the wrapper's native tooltip. */}
            <span title={aiAvailable ? undefined : (aiUnavailableReason ?? 'Ask Berean is unavailable')} className={cx('inline-flex', editing && 'opacity-40 pointer-events-none')}>
              <IconButton
                icon={Sparkles}
                label={aiAvailable ? (ai ? 'Ask Berean is on for the next message' : 'Ask Berean') : (aiUnavailableReason ?? 'Ask Berean is unavailable')}
                tooltip={aiAvailable ? { shortcut: '⌘↩' } : false}
                size={28}
                active={ai}
                disabled={!aiAvailable}
                aria-pressed={ai}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setAskArmed((v) => !v); editorRef.current?.focus() }}
              />
            </span>
          </div>
          <ChatEditor
            ref={editorRef}
            initialMarkdown={initialMarkdown}
            returnSends
            placeholder={editing ? 'Edit Message' : ai ? 'Ask Berean…' : 'Message'}
            ariaLabel={editing ? 'Edit message' : ai ? 'Ask Berean' : 'Message'}
            onSubmit={(asAi) => { void submit(asAi) }}
            onEscape={escape}
            onOpenLink={() => setLinkOpen(true)}
            onChange={onChange}
            onFocusChange={onFocusChange}
            style={expanded ? { height: expandedHeight!, maxHeight: expandedHeight! } : { maxHeight: MAX_HEIGHT }}
            className={cx('flex-1 min-w-0 px-1.5 py-1 text-footnote leading-snug', expanded ? 'self-stretch' : 'self-center')}
          />
          {showDestination && <span className="chat-composer-dest flex-shrink min-w-0 self-start mt-0.5">{destination}</span>}
          <IconButton
            icon={expanded ? Minimize2 : Maximize2}
            label={expanded ? 'Collapse Message Field' : 'Expand Message Field'}
            size={24}
            strokeWidth={1.75}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleExpanded}
            className="flex-shrink-0 self-start mt-0.5 text-text-muted"
            aria-expanded={expanded}
          />
        </div>
        {showAccessory && (
          <div className="chat-composer-accessory">
            <ChatModeMenu mode={mode} onChange={setMode} disabled={aiBusy} />
            <ChatContextToggle
              state={{ label: tabContextLabel ?? null, on: tabOn, mentioned }}
              onToggle={() => setTabOn(!tabOn)}
            />
          </div>
        )}
      </div>
      </ComposerPopoverContext.Provider>
    </div>
  )
})

