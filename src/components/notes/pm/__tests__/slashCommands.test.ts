import { describe, it, expect } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { SLASH_COMMANDS, filterSlashCommands } from '../slashCommands'
import { serializeToMarkdown } from '../serializer'

function makeView(text = '/') {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)),
  })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

function run(id: string, initialText = '/') {
  const view = makeView(initialText)
  const cmd = SLASH_COMMANDS.find((c) => c.id === id)!
  cmd.run(view, 1, 1 + initialText.length)
  return view
}

describe('filterSlashCommands', () => {
  it('empty query returns every command', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_COMMANDS.length)
  })
  it('filters by label substring', () => {
    const results = filterSlashCommands('head')
    expect(results.map((c) => c.id)).toEqual(['h1', 'h2', 'h3'])
  })
  it('filters by keyword', () => {
    const results = filterSlashCommands('todo')
    expect(results.map((c) => c.id)).toEqual(['task'])
  })
  it('no matches for gibberish', () => {
    expect(filterSlashCommands('zzzznotacommand')).toEqual([])
  })
  it('every command id is unique', () => {
    const ids = SLASH_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('slash command execution', () => {
  it('text: stays/becomes a plain paragraph, trigger text removed', () => {
    const view = run('text')
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.textContent).toBe('')
    view.destroy()
  })

  it('h1/h2/h3: converts the line into a real heading node at the right level', () => {
    for (const [id, level] of [['h1', 1], ['h2', 2], ['h3', 3]] as const) {
      const view = run(id)
      expect(view.state.doc.firstChild?.type.name).toBe('heading')
      expect(view.state.doc.firstChild?.attrs.level).toBe(level)
      view.destroy()
    }
  })

  it('bullet: wraps the line in a bullet_list with marker "*"', () => {
    const view = run('bullet')
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(view.state.doc.firstChild?.attrs.marker).toBe('*')
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('list_item')
    view.destroy()
  })

  it('numbered: wraps the line in an ordered_list', () => {
    const view = run('numbered')
    expect(view.state.doc.firstChild?.type.name).toBe('ordered_list')
    view.destroy()
  })

  it('task: wraps in a bullet_list with the list_item stamped checked:false', () => {
    const view = run('task')
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(view.state.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
    view.destroy()
  })

  it('quote: wraps the line in a blockquote', () => {
    const view = run('quote')
    expect(view.state.doc.firstChild?.type.name).toBe('blockquote')
    view.destroy()
  })

  it('code: converts the line into a code_block', () => {
    const view = run('code')
    expect(view.state.doc.firstChild?.type.name).toBe('code_block')
    view.destroy()
  })

  it('table: inserts a real 2x2 table (header row + body row)', () => {
    const view = run('table')
    expect(view.state.doc.firstChild?.type.name).toBe('table')
    const rows: string[] = []
    view.state.doc.firstChild?.forEach((row) => rows.push(row.type.name))
    expect(rows).toEqual(['table_row', 'table_row'])
    const firstRowCells: string[] = []
    view.state.doc.firstChild?.firstChild?.forEach((cell) => firstRowCells.push(cell.type.name))
    expect(firstRowCells).toEqual(['table_header', 'table_header'])
    view.destroy()
  })

  it('divider: inserts a horizontal_rule node', () => {
    const view = run('divider')
    expect(view.state.doc.firstChild?.type.name).toBe('horizontal_rule')
    view.destroy()
  })

  it('callout-note/tip/warning/important/caution: wraps the line in a callout with the right calloutType', () => {
    const cases: Array<[string, string]> = [
      ['callout-note', 'NOTE'], ['callout-tip', 'TIP'], ['callout-warning', 'WARNING'],
      ['callout-important', 'IMPORTANT'], ['callout-caution', 'CAUTION'],
    ]
    for (const [id, type] of cases) {
      const view = run(id)
      expect(view.state.doc.firstChild?.type.name).toBe('callout')
      expect(view.state.doc.firstChild?.attrs.calloutType).toBe(type)
      view.destroy()
    }
  })

  it('leaves any text typed AFTER the slash-command query out of the trigger deletion range only (round-trips cleanly for a heading)', () => {
    const view = run('h2', '/head')
    expect(serializeToMarkdown(view.state.doc)).toBe('## ')
    view.destroy()
  })
})
