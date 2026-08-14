import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

// ─── Lightweight code-block syntax highlighting (round 12 item 1) ──────────
//
// No @lezer LANGUAGE grammar packages (@lezer/javascript, @lezer/python, etc.) are actually
// installed in this project — only @lezer/highlight itself is a dependency, and that's a
// tagging/theming UTILITY with no parser of its own (it consumes tokens a real lezer parser
// produces; it doesn't produce them). Adding real lezer language packages purely for this one
// feature would be exactly the "heavy new dep for a narrow win" the task brief said to avoid
// when only a few languages are realistically available. Instead this is a small, hand-rolled
// regex tokenizer covering the languages actual note-taking code blocks realistically use
// (JS/TS, JSON, Python, Bash, SQL, CSS, HTML) — line/block comments, strings, numbers, and a
// per-language keyword list — falling back to NO highlighting (plain monospace text, still
// perfectly readable) for any other/unset language tag. This is a deliberate simplification,
// not full language-aware parsing: it can't distinguish a keyword used as an identifier from
// a real keyword, doesn't understand nesting/scoping, etc. — good enough for note-taking code
// snippets, not a substitute for a real editor's syntax highlighter.
//
// Implemented as DECORATIONS from a plugin's `decorations(state)` prop — recomputed fresh
// from `state.doc` on every doc-changing transaction, exactly blockDecorations.ts's own
// pattern — NEVER as imperative DOM mutation from inside a plugin's `view().update()` hook.
// See blockHandles.ts's file header for the full story on why that specific pattern (not
// NodeViews mutating their own non-content DOM, which codeBlockNodeView in nodeViews.ts does
// safely) previously OOM'd the renderer via an infinite MutationObserver->updateState loop.

export const codeBlockHighlightKey = new PluginKey<DecorationSet>('berean-code-block-highlight')

// code_block's `params` attr (schema.ts) is the raw fence-info string the user typed after
// ``` — aliased here so "js"/"ts"/"py"/"sh" (what people actually type) resolve to the same
// keyword table as their full names, matching codeBlockNodeView's preset list in nodeViews.ts.
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', py3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  json5: 'json', jsonc: 'json',
  htm: 'html',
}

export function normalizeLang(params: string): string {
  const p = params.trim().toLowerCase()
  return LANG_ALIASES[p] ?? p
}

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'class', 'extends', 'new', 'this', 'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'import', 'export', 'from', 'as', 'null', 'undefined', 'true', 'false', 'void', 'delete', 'static', 'get', 'set', 'super'],
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'class', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'pass', 'lambda', 'yield', 'global', 'nonlocal', 'not', 'and', 'or', 'in', 'is', 'None', 'True', 'False', 'async', 'await', 'del', 'assert'],
  bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'local', 'export', 'readonly', 'shift', 'break', 'continue', 'in', 'echo', 'exit', 'set'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter', 'drop', 'join', 'inner', 'left', 'right', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'and', 'or', 'not', 'null', 'as', 'distinct', 'union', 'primary', 'key', 'foreign', 'references', 'index', 'default'],
}
// TypeScript is JavaScript's keyword set plus its own type-system vocabulary.
LANGUAGE_KEYWORDS.typescript = [...LANGUAGE_KEYWORDS.javascript, 'interface', 'type', 'enum', 'implements', 'private', 'public', 'protected', 'readonly', 'namespace', 'declare', 'abstract', 'is', 'keyof', 'infer']

const LINE_COMMENT: Record<string, string> = { javascript: '//', typescript: '//', python: '#', bash: '#', sql: '--' }
const BLOCK_COMMENT: Record<string, [string, string]> = { javascript: ['/*', '*/'], typescript: ['/*', '*/'], css: ['/*', '*/'], html: ['<!--', '-->'] }

// Every language this highlighter has ANY support for, even ones with no keyword list of
// their own (css/json/html still get string/number/comment highlighting) — used to decide
// "highlight this code_block at all" vs. "leave it as plain, unstyled monospace text."
const KNOWN_LANGS = new Set(['javascript', 'typescript', 'python', 'bash', 'sql', 'css', 'json', 'html'])

interface Token { start: number; end: number; type: 'comment' | 'string' | 'number' | 'keyword' }

function tokenizeCode(text: string, lang: string): Token[] {
  const keywords = new Set(LANGUAGE_KEYWORDS[lang] ?? [])
  const lineComment = LINE_COMMENT[lang]
  const blockComment = BLOCK_COMMENT[lang]
  const tokens: Token[] = []
  // Comment/string ranges get blanked out of this working copy as they're found, so later
  // stages (numbers, keywords) never re-match text that's already inside one of them —
  // e.g. the digits in `// v2 note` or the word `select` inside a string literal.
  const masked = text.split('')
  function markRange(start: number, end: number, type: Token['type']) {
    tokens.push({ start, end, type })
    for (let i = start; i < end; i++) masked[i] = ' '
  }

  if (lineComment) {
    let idx = 0
    while ((idx = text.indexOf(lineComment, idx)) !== -1) {
      const end = text.indexOf('\n', idx)
      markRange(idx, end === -1 ? text.length : end, 'comment')
      idx = end === -1 ? text.length : end
    }
  }
  if (blockComment) {
    const [open, close] = blockComment
    let idx = 0
    while ((idx = text.indexOf(open, idx)) !== -1) {
      const closeIdx = text.indexOf(close, idx + open.length)
      const end = closeIdx === -1 ? text.length : closeIdx + close.length
      markRange(idx, end, 'comment')
      idx = end
    }
  }

  // Strings, then numbers, then keywords — each stage scans a FRESH snapshot of `masked`
  // taken right before its own loop, so it sees every earlier stage's blanking (but a
  // stage's own matches don't need to be re-visible to itself; RegExp.exec's lastIndex
  // already tracks forward-only progress through that one frozen snapshot string).
  let m: RegExpExecArray | null
  const STRING_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g
  let snapshot = masked.join('')
  while ((m = STRING_RE.exec(snapshot))) markRange(m.index, m.index + m[0].length, 'string')

  const NUMBER_RE = /\b\d+(\.\d+)?\b/g
  snapshot = masked.join('')
  while ((m = NUMBER_RE.exec(snapshot))) markRange(m.index, m.index + m[0].length, 'number')

  if (keywords.size) {
    const WORD_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g
    snapshot = masked.join('')
    while ((m = WORD_RE.exec(snapshot))) {
      if (keywords.has(m[0])) tokens.push({ start: m.index, end: m.index + m[0].length, type: 'keyword' })
    }
  }

  return tokens
}

// Exported for staticRender.ts, mirroring blockDecorations.ts's own buildBlockDecorations —
// the read-only print/version-history/daily-scroll/Presenter renderer reuses this exact
// tokenizer so a code block highlighted in the live editor looks identical everywhere else.
export function buildCodeBlockDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true
    const lang = normalizeLang(node.attrs.params || '')
    if (!KNOWN_LANGS.has(lang)) return false
    const textStart = pos + 1 // +1: past the code_block node's own opening boundary, to its text content
    for (const tok of tokenizeCode(node.textContent, lang)) {
      decorations.push(Decoration.inline(textStart + tok.start, textStart + tok.end, { class: `pm-code-tok-${tok.type}` }))
    }
    return false // code_block's content is `text*` — nothing further to recurse into
  })
  return DecorationSet.create(doc, decorations)
}

export function createCodeBlockHighlightPlugin() {
  return new Plugin({
    key: codeBlockHighlightKey,
    state: {
      init: (_, state) => buildCodeBlockDecorations(state.doc),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old.map(tr.mapping, tr.doc)
        return buildCodeBlockDecorations(newState.doc)
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}
