import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { EditorView } from 'prosemirror-view'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'
import { createChatEditorState, docToMarkdown, isDocEmpty, type ChatKeyHandlers } from './chatEditorState'
import './composer.css'

export interface ChatEditorHandle {
  focus: (opts?: { atEnd?: boolean }) => void
  blur: () => void
  hasFocus: () => boolean
  getMarkdown: () => string
  /** Replace the content (a fresh undo history) — a draft, an edited message, a handoff. */
  setMarkdown: (md: string, opts?: { focus?: boolean }) => void
  isEmpty: () => boolean
  /** Run a toolbar command against the live state (keeps / restores editor focus). */
  run: (cmd: Command, opts?: { focus?: boolean }) => boolean
  getState: () => EditorState | null
  getView: () => EditorView | null
}

export interface ChatEditorProps {
  initialMarkdown?: string
  placeholder: string
  ariaLabel: string
  /** Desktop: Return sends. iPhone: Return is a new line (the Send button sends), like Messages. */
  returnSends: boolean
  onSubmit: (asAi: boolean) => void
  /** Esc chain; return true when something was dismissed. */
  onEscape: () => boolean
  /** ⌘K with no address selected. */
  onOpenLink: () => void
  /** Every state change; `docChanged` for typing (drafts), any change for the toolbar. */
  onChange?: (state: EditorState, docChanged: boolean) => void
  onFocusChange?: (focused: boolean) => void
  enterKeyHint?: 'send' | 'enter'
  className?: string
  style?: CSSProperties
}

// Tests reach the live view through the editable element (no globals, no production cost).
const views = new WeakMap<Element, EditorView>()
export const chatEditorViewFor = (el: Element | null): EditorView | undefined => (el ? views.get(el) : undefined)

/**
 * The Berean Chat message field: a compact ProseMirror editor (see chatEditorState.ts) whose
 * value in and out is markdown. Formatting shows as formatting while composing; the stored
 * message stays markdown. Created once per mount; handlers are read through refs so the editor
 * is never rebuilt by a re-render.
 */
export const ChatEditor = forwardRef<ChatEditorHandle, ChatEditorProps>(function ChatEditor(props, ref) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const handlers: ChatKeyHandlers = {
    submit: (asAi) => propsRef.current.onSubmit(asAi),
    returnSends: () => propsRef.current.returnSends,
    escape: () => propsRef.current.onEscape(),
    openLink: () => propsRef.current.onOpenLink(),
  }
  const placeholder = () => propsRef.current.placeholder
  const attributes = () => ({
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': propsRef.current.ariaLabel,
    enterkeyhint: propsRef.current.enterKeyHint ?? (propsRef.current.returnSends ? 'send' : 'enter'),
    autocapitalize: 'sentences',
    spellcheck: 'true',
    class: 'chat-editor-pm',
  })

  useLayoutEffect(() => {
    const view = new EditorView(mountRef.current!, {
      state: createChatEditorState(propsRef.current.initialMarkdown ?? '', handlers, placeholder),
      attributes,
      dispatchTransaction(tr) {
        const v = viewRef.current
        if (!v) return
        const next = v.state.apply(tr)
        v.updateState(next)
        propsRef.current.onChange?.(next, tr.docChanged)
      },
      handleDOMEvents: {
        focus: () => { propsRef.current.onFocusChange?.(true); return false },
        blur: () => { propsRef.current.onFocusChange?.(false); return false },
      },
    })
    viewRef.current = view
    views.set(view.dom, view)
    // A shortcut the editor handled (⌘K link, ⌘B…) must not also reach the app's window-level
    // shortcuts (⌘K = floating search). Runs after ProseMirror's listener. (Esc: escapePlugin.)
    const stopHandled = (e: KeyboardEvent) => { if (e.defaultPrevented && (e.metaKey || e.ctrlKey)) e.stopPropagation() }
    view.dom.addEventListener('keydown', stopHandled)
    propsRef.current.onChange?.(view.state, false)
    return () => { view.dom.removeEventListener('keydown', stopHandled); views.delete(view.dom); view.destroy(); viewRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Label / placeholder / Return behaviour follow the props (decorations recompute on a no-op tr).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.setProps({ attributes })
    view.dispatch(view.state.tr.setMeta('chat-placeholder', props.placeholder))
  }, [props.ariaLabel, props.placeholder, props.returnSends, props.enterKeyHint]) // eslint-disable-line react-hooks/exhaustive-deps

  const focusView = (atEnd?: boolean) => {
    const view = viewRef.current
    if (!view) return
    if (atEnd) view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).scrollIntoView())
    view.focus()
  }

  useImperativeHandle(ref, () => ({
    focus: (opts) => focusView(opts?.atEnd),
    blur: () => { (viewRef.current?.dom as HTMLElement | undefined)?.blur() },
    hasFocus: () => !!viewRef.current?.hasFocus(),
    getMarkdown: () => (viewRef.current ? docToMarkdown(viewRef.current.state.doc) : ''),
    setMarkdown: (md, opts) => {
      const view = viewRef.current
      if (!view) return
      const state = createChatEditorState(md, handlers, placeholder)
      view.updateState(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))))
      propsRef.current.onChange?.(view.state, false)
      if (opts?.focus) focusView(true)
    },
    isEmpty: () => (viewRef.current ? isDocEmpty(viewRef.current.state.doc) : true),
    run: (cmd, opts) => {
      const view = viewRef.current
      if (!view) return false
      const ok = cmd(view.state, view.dispatch, view)
      if (opts?.focus !== false) view.focus()
      return ok
    },
    getState: () => viewRef.current?.state ?? null,
    getView: () => viewRef.current,
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  // A press in the field's padding (outside the text) still puts the caret in it, like a textarea.
  return (
    <div
      ref={mountRef}
      className={['chat-editor', props.className].filter(Boolean).join(' ')}
      style={props.style}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); focusView(true) } }}
    />
  )
})
