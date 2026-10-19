import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cx } from '@/components/ui'
import { useChatNavigate, type ChatNavigate } from './chatNav'
import { parseChatMarkdown, safeHref, type MdNode } from './chatMarkdownParse'
import './chatContent.css'

/**
 * A chat message's markdown — the same markdown the notes editor writes, so a message copied into
 * a note reads the same — rendered as React elements (markdown-it tokens → elements; nothing is
 * ever HTML-parsed, so message text can never inject markup; raw HTML shows as literal text).
 *
 * Paragraphs, **bold** *italic* <u>underline</u> ~~strike~~ ==highlight== `code`, fenced code
 * (with Copy), quotes, restrained headings, bullet / numbered / task lists, rules, tables (in a
 * horizontal scroller so a narrow iPhone never overflows), http(s)/mailto links. Verse references
 * ("John 3:16", "Isaiah 66:3 LXX", "Ps 23") and Strong's numbers ("H7225") in plain text become
 * links that open in the reader / lexicon — never inside code or links. Remote images never load.
 */

export type ChatTone = 'accent' | 'plain'

interface Ctx { tone: ChatTone; nav: ChatNavigate }

function CodeBlock({ code: raw, lang }: { code: string; lang: string }) {
  const code = raw.replace(/\n$/, '')
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <div className="chat-pre-wrap">
      <button type="button" className="chat-pre-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy code'} title={copied ? 'Copied' : 'Copy code'}>
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      <pre className="chat-pre" data-lang={lang || undefined}><code>{code}</code></pre>
    </div>
  )
}

function linkClass(tone: ChatTone, extra?: string) {
  return cx('chat-link', tone === 'accent' && 'is-on-accent', extra)
}

function renderText(n: MdNode, key: string, c: Ctx): ReactNode {
  if (!n.segs) return n.content
  if (n.segs.length === 1 && n.segs[0].kind === 'text') return n.segs[0].text
  return n.segs.map((s, i) => {
    const k = `${key}s${i}`
    if (s.kind === 'text') return s.text
    if (s.kind === 'verse') {
      const result = s.result
      return (
        <button key={k} type="button" className={linkClass(c.tone)} title={`Open ${s.text}`}
          onClick={(e) => { e.stopPropagation(); c.nav({ kind: 'verse', result }) }}>{s.text}</button>
      )
    }
    const num = s.num
    return (
      <button key={k} type="button" className={linkClass(c.tone, 'is-strongs')} title={`Open Strong's ${num}`}
        onClick={(e) => { e.stopPropagation(); c.nav({ kind: 'lexicon', strongsNum: num }) }}>{num}</button>
    )
  })
}

function alignOf(n: MdNode): React.CSSProperties | undefined {
  const m = /text-align:\s*(left|right|center)/.exec(n.attrs.style ?? '')
  return m ? { textAlign: m[1] as 'left' | 'right' | 'center' } : undefined
}

function renderNodes(nodes: MdNode[], key: string, c: Ctx): ReactNode[] {
  return nodes.map((n, i) => renderNode(n, `${key}.${i}`, c))
}

function renderNode(n: MdNode, k: string, c: Ctx): ReactNode {
  const kids = () => renderNodes(n.children, k, c)
  switch (n.type) {
    // ── Block ──
    case 'paragraph':
      return n.hidden ? <span key={k} className="chat-p-tight">{kids()}</span> : <p key={k} className="chat-p">{kids()}</p>
    case 'inline': return <Fragment key={k}>{kids()}</Fragment>
    case 'heading': {
      const level = Number(n.tag.slice(1)) || 3
      const Tag = (`h${Math.min(Math.max(level, 1), 6)}`) as 'h1'
      return <Tag key={k} className={cx('chat-h', level <= 2 ? 'chat-h-lg' : 'chat-h-sm')}>{kids()}</Tag>
    }
    case 'bullet_list': {
      const task = n.children.some((li) => li.meta?.task)
      return <ul key={k} className={cx('chat-list', task ? 'chat-task-list' : 'list-disc')}>{kids()}</ul>
    }
    case 'ordered_list': {
      const start = Number(n.attrs.start ?? 1)
      return <ol key={k} className="chat-list list-decimal" start={Number.isFinite(start) ? start : 1}>{kids()}</ol>
    }
    case 'list_item':
      if (n.meta?.task) {
        const done = !!n.meta.checked
        return (
          <li key={k} className={cx('chat-task', done && 'is-done')}>
            <span className="chat-task-box" role="img" aria-label={done ? 'Done' : 'Not done'}>{done && <Check size={9} strokeWidth={3} />}</span>
            <span className="chat-task-body">{kids()}</span>
          </li>
        )
      }
      return <li key={k}>{kids()}</li>
    case 'blockquote': return <blockquote key={k} className="chat-quote">{kids()}</blockquote>
    case 'fence':
    case 'code_block': return <CodeBlock key={k} code={n.content} lang={(n.info ?? '').trim().split(/\s+/)[0] ?? ''} />
    case 'hr': return <hr key={k} className="chat-hr" />
    case 'table':
      return (
        <div key={k} className="chat-table-wrap">
          <table className="chat-table">{kids()}</table>
        </div>
      )
    case 'thead': return <thead key={k}>{kids()}</thead>
    case 'tbody': return <tbody key={k}>{kids()}</tbody>
    case 'tr': return <tr key={k}>{kids()}</tr>
    case 'th': return <th key={k} style={alignOf(n)}>{kids()}</th>
    case 'td': return <td key={k} style={alignOf(n)}>{kids()}</td>
    // ── Inline ──
    case 'text': return <Fragment key={k}>{renderText(n, k, c)}</Fragment>
    case 'softbreak':
    case 'hardbreak': return <br key={k} />
    case 'strong': return <strong key={k} className="font-semibold">{kids()}</strong>
    case 'em': return <em key={k}>{kids()}</em>
    case 's': return <s key={k}>{kids()}</s>
    case 'u': return <u key={k}>{kids()}</u>
    case 'mark': return <mark key={k} className="chat-mark">{kids()}</mark>
    case 'code_inline': return <code key={k} className="chat-code">{n.content}</code>
    case 'link': {
      const href = safeHref(n.attrs.href)
      if (!href) return <Fragment key={k}>{kids()}</Fragment>
      return (
        <a key={k} href={href} target="_blank" rel="noreferrer noopener" className={linkClass(c.tone, 'chat-a')}
          onClick={(e) => e.stopPropagation()}>{kids()}</a>
      )
    }
    case 'image': {
      // Never load remote images in chat — show the image as a link (or its alt text).
      const href = safeHref(n.attrs.src)
      const label = n.content || n.attrs.src || 'image'
      if (!href) return <span key={k}>{label}</span>
      return (
        <a key={k} href={href} target="_blank" rel="noreferrer noopener" className={linkClass(c.tone, 'chat-a')}
          onClick={(e) => e.stopPropagation()}>{label}</a>
      )
    }
    default:
      // html_inline / html_block can't occur (html: false); anything unknown shows its source text.
      return n.children.length ? <Fragment key={k}>{kids()}</Fragment> : (n.content || null)
  }
}

export const ChatMarkdown = memo(function ChatMarkdown(
  { text, tone = 'plain', streaming = false, className }: { text: string; tone?: ChatTone; streaming?: boolean; className?: string },
) {
  const nav = useChatNavigate()
  const tree = useMemo(() => parseChatMarkdown(text, streaming), [text, streaming])
  const body = useMemo(() => renderNodes(tree, 'm', { tone, nav }), [tree, tone, nav])
  return <div className={cx('chat-rich chat-md', tone === 'accent' && 'is-accent', className)}>{body}</div>
})

export default ChatMarkdown
