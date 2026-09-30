import { useLongPress } from '../primitives/useLongPress'
import React, { useReducer, useState } from 'react'
import { ChevronRight, ChevronLeft, ChevronDown, Search, History as HistoryIcon, Settings as SettingsIcon } from 'lucide-react'
import { useAppStore, tabCanGoBack } from '@/store'
import { runExperience } from '../navigation/experiences'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { Segmented, Stepper, Toggle } from '../settings/SettingsControls'
import type { CaretCommand, CaretScope } from './caretRegistry'

/**
 * The caret sheet (TEST-033/034): the commands of whatever is on screen, structured as
 *   heading (what it acts on) → a row of large TILES for the most frequent actions (Arc-style,
 *   S2 screenshot) → titled GROUPS of rows with inline controls (toggles, steppers, segmented).
 * Rows that open something close the caret; inline controls keep it open so several reading
 * settings can be adjusted in one go. No low detent (brief §16).
 */
export function CaretSheet({ scope, api }: { scope: () => CaretScope; api: SheetApi }) {
  // Inline controls mutate the store; re-read the scope after each so values stay current.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const s = scope()
  const act = (c: Extract<CaretCommand, { kind: 'action' }>) => () => {
    if (c.disabled) return
    void haptic.light()
    if (!c.keepOpen) api.close()
    c.run()
    if (c.keepOpen) bump()
  }
  // A `view` command replaces this sheet's content (same surface, "‹ <this title>" at the top).
  const open = (c: Extract<CaretCommand, { kind: 'view' }>) => () => {
    if (c.disabled) return
    const v = c.view()
    api.push({
      key: c.id, title: v.title,
      render: (a) => ('scope' in v ? <CaretSheet scope={v.scope} api={a} /> : v.render(a)),
    })
  }
  const nested = api.depth > 0
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  return (
    <div className="mobile-caret">
      {/* In a pushed view the sheet's own nav bar names it; the heading would repeat it. */}
      {!nested && (s.location ? (
        <CaretLocationBar location={s.location} api={api} onChanged={bump} />
      ) : (
        <div className="mobile-caret-head">
          <div className="mobile-caret-title">{s.title}</div>
          {s.subtitle && <div className="mobile-caret-subtitle">{s.subtitle}</div>}
        </div>
      ))}
      {!nested && <CaretGoToRow api={api} />}
      {s.sections.map((sec) => sec.collapsible ? (
        <section key={sec.id} className="mobile-caret-group" aria-label={sec.collapsible.label}>
          <div className="mobile-caret-group-body">
            <button type="button" className="mobile-caret-row mobile-caret-disclosure" aria-expanded={!!expanded[sec.id]}
              onClick={() => { void haptic.selection(); setExpanded((e) => ({ ...e, [sec.id]: !e[sec.id] })) }}>
              {sec.collapsible.icon && <sec.collapsible.icon size={20} aria-hidden className="mobile-caret-row-icon" />}
              <span className="mobile-caret-row-label">{sec.collapsible.label}</span>
              {!expanded[sec.id] && sec.collapsible.summary && <span className="mobile-caret-row-value">{sec.collapsible.summary}</span>}
              <ChevronDown size={16} aria-hidden className={`mobile-caret-row-chevron mobile-caret-disclosure-chevron${expanded[sec.id] ? ' is-open' : ''}`} />
            </button>
            {expanded[sec.id] && (
              <div className="mobile-caret-disclosure-body">
                {sec.commands.map((c) => c.kind === 'content'
                  ? <div key={c.id} className="mobile-caret-content">{c.render(api)}</div>
                  : <CaretRow key={c.id} c={c} onAction={act} onView={open} onChanged={bump} />)}
              </div>
            )}
          </div>
        </section>
      ) : sec.style === 'tiles' ? (
        <div key={sec.id} className="mobile-caret-tiles" role="group" aria-label={sec.title ?? 'Quick actions'}>
          {sec.commands.map((c) => {
            const Icon = c.icon
            if (c.kind === 'toggle') {
              return (
                <button key={c.id} type="button" className={`mobile-caret-tile${c.value ? ' is-on' : ''}`} aria-pressed={c.value}
                  onClick={() => { void haptic.selection(); c.set(!c.value); bump() }}>
                  {Icon && <Icon size={22} aria-hidden />}<span>{c.label}</span>
                </button>
              )
            }
            if (c.kind === 'view') {
              return (
                <button key={c.id} type="button" className="mobile-caret-tile" disabled={c.disabled} onClick={open(c)}>
                  {Icon && <Icon size={22} aria-hidden />}<span>{c.label}</span>{c.value && <small>{c.value}</small>}
                </button>
              )
            }
            if (c.kind !== 'action') return null
            return <ActionTile key={c.id} c={c} onClick={act(c)} onLongPress={c.longPress ? () => { api.close(); c.longPress!() } : undefined} />
          })}
        </div>
      ) : (
        <section key={sec.id} className="mobile-caret-group" aria-label={sec.title}>
          {sec.title && <h3 className="mobile-caret-group-title">{sec.title}</h3>}
          <div className="mobile-caret-group-body">
            {sec.commands.map((c) => c.kind === 'content'
              ? <div key={c.id} className="mobile-caret-content">{c.render(api)}</div>
              : <CaretRow key={c.id} c={c} onAction={act} onView={open} onChanged={bump} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function CaretRow({ c, onAction, onView, onChanged }: {
  c: CaretCommand
  onAction: (c: Extract<CaretCommand, { kind: 'action' }>) => () => void
  onView: (c: Extract<CaretCommand, { kind: 'view' }>) => () => void
  onChanged: () => void
}) {
  const Icon = c.icon
  const lead = Icon ? <Icon size={20} aria-hidden className="mobile-caret-row-icon" /> : null
  if (c.kind === 'view') {
    return (
      <button type="button" className="mobile-caret-row" disabled={c.disabled} onClick={onView(c)} aria-label={c.value ? `${c.label}, ${c.value}` : c.label}>
        {lead}<span className="mobile-caret-row-label">{c.label}{c.detail && <small>{c.detail}</small>}</span>
        {c.value && <span className="mobile-caret-row-value">{c.value}</span>}
        <ChevronRight size={16} aria-hidden className="mobile-caret-row-chevron" />
      </button>
    )
  }
  if (c.kind === 'action') {
    return (
      <button type="button" className={`mobile-caret-row${c.destructive ? ' is-destructive' : ''}`} disabled={c.disabled} onClick={onAction(c)}>
        {lead}<span className="mobile-caret-row-label">{c.label}{c.detail && <small>{c.detail}</small>}</span>
        {c.value && <span className="mobile-caret-row-value">{c.value}</span>}
        {!c.keepOpen && <ChevronRight size={16} aria-hidden className="mobile-caret-row-chevron" />}
      </button>
    )
  }
  if (c.kind === 'toggle') {
    return (
      <div className="mobile-caret-row">
        {lead}<span className="mobile-caret-row-label">{c.label}{c.detail && <small>{c.detail}</small>}</span>
        <Toggle checked={c.value} onChange={(v) => { c.set(v); onChanged() }} label={c.label} />
      </div>
    )
  }
  if (c.kind === 'stepper') {
    return (
      <div className="mobile-caret-row">
        {lead}<span className="mobile-caret-row-label">{c.label}</span>
        <Stepper value={c.value} min={c.min} max={c.max} label={c.unit} onChange={(v) => { c.set(v); onChanged() }} />
      </div>
    )
  }
  if (c.kind === 'content') return null
  return (
    <div className="mobile-caret-row is-stacked">
      <span className="mobile-caret-row-label">{lead}{c.label}</span>
      <Segmented full value={c.value} options={c.options} onChange={(v) => { c.set(v); onChanged() }} />
    </div>
  )
}

/**
 * The caret's navigation header (SEP24-008): [ current location / search ]  [ ‹ ] [ › ].
 * Back / forward move the CURRENT tab through its own history (database / translation, book,
 * chapter, verse; note; lexicon entry …) — the shared per-tab nav stack, the same one the Mac's
 * Cmd+[ / Cmd+] use — without a new tab or another sheet.
 */
function CaretLocationBar({ location, api, onChanged }: { location: NonNullable<CaretScope['location']>; api: SheetApi; onChanged: () => void }) {
  const nav = useAppStore((s) => {
    const id = s.activeTabId[s.activeSpace]
    const st = id ? s.tabNavStacks[id] : undefined
    // One rule with the edge swipe and the store's navTabBack (tabCanGoBack).
    return { back: !!id && tabCanGoBack(s, s.activeSpace, id), forward: !!st && st.idx < st.stack.length - 1 }
  }, (a, b) => a.back === b.back && a.forward === b.forward)
  const openLocation = () => {
    if (location.run) { api.close(); location.run(); return }
    if (!location.view) return
    const v = location.view()
    void haptic.light()
    api.push({ key: 'location', title: v.title, render: (a) => ('scope' in v ? <CaretSheet scope={v.scope} api={a} /> : v.render(a)) })
  }
  const step = (dir: 'back' | 'forward') => {
    const s = useAppStore.getState()
    void haptic.selection()
    if (dir === 'back') s.navTabBack(); else s.navTabForward()
    setTimeout(onChanged, 60)
  }
  return (
    <div className="mobile-caret-nav">
      <button type="button" className="mobile-caret-nav-field" onClick={openLocation} disabled={!location.view && !location.run} aria-label={`${location.label}. ${location.placeholder ?? 'Go somewhere else'}`}>
        <Search size={15} aria-hidden />
        <span className="mobile-caret-nav-label">{location.label}</span>
      </button>
      <span className="mobile-caret-nav-pair" role="group" aria-label="Tab history">
        <button type="button" className="mobile-caret-nav-btn" aria-label="Back" disabled={!nav.back} onClick={() => step('back')}><ChevronLeft size={20} aria-hidden /></button>
        <button type="button" className="mobile-caret-nav-btn" aria-label="Forward" disabled={!nav.forward} onClick={() => step('forward')}><ChevronRight size={20} aria-hidden /></button>
      </span>
    </div>
  )
}

/** An action tile; an optional long press (e.g. Today → the calendar) closes the caret first. */
function ActionTile({ c, onClick, onLongPress }: { c: Extract<CaretCommand, { kind: 'action' }>; onClick: () => void; onLongPress?: () => void }) {
  const Icon = c.icon
  const lp = useLongPress(() => { if (onLongPress) { void haptic.medium(); onLongPress() } })
  return (
    <button type="button" className="mobile-caret-tile" disabled={c.disabled} onClick={onClick} aria-label={c.a11yLabel}
      {...(onLongPress ? lp : {})}>
      {Icon && <Icon size={22} aria-hidden />}<span>{c.label}</span>{c.detail && <small>{c.detail}</small>}
    </button>
  )
}

/**
 * Every caret can turn the CURRENT tab into History or Settings (TEST 2026-09-29) — the same
 * transform the tab-type switcher uses (runExperience 'current-tab': the tab keeps its place and
 * its history, so ‹ returns). The entry for the tab's own type is omitted.
 */
function CaretGoToRow({ api }: { api: SheetApi }) {
  const type = useAppStore((s) => s.tabs[s.activeSpace]?.find((t) => t.id === s.activeTabId[s.activeSpace])?.type)
  const items = ([
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ] as const).filter((it) => it.id !== type)
  if (!items.length) return null
  return (
    <div className="mobile-caret-goto" role="group" aria-label="Switch this tab">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className="mobile-caret-goto-btn" aria-label={`Show ${label} in this tab`}
          onClick={() => { void haptic.light(); api.close(); runExperience(id, 'current-tab') }}>
          <Icon size={17} aria-hidden /><span>{label}</span>
        </button>
      ))}
    </div>
  )
}
