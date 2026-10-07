import { LayoutGrid } from 'lucide-react'
import { useLiquidGlassControls } from '@/platform/liquidGlass'
import { useAnyPageHasBack } from '../primitives/Page'
import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useAppStore } from '@/store'
import { haptic } from '../primitives/haptics'
import { useChromeState } from './chromeState'
import { EXPERIENCES, otherExperiences, runExperience, tabTypeFace } from './experiences'
import { useCalendarOverlay } from '../calendar/CalendarOverlay'
import './experiences.css'

/**
 * The floating top-left tab-type switcher (TEST25-NAV-001): a glass circle showing what the
 * current tab is; tapping it fans out the OTHER major experiences (experiences.ts) as glass
 * capsules — choosing one CHANGES this tab into it (store.transformTab: same place in the tab
 * order, same history; ‹ returns to what it was). Collapses after a choice, on a tap outside (a
 * transparent scrim), and on scroll. The circle itself slides away while scrolling down and
 * returns on scroll up — chromeState: Scripture views drive `collapsed` (the same signal as their
 * header), every other page `pageCollapsed` (the shell's scroll watcher).
 *
 * Placement: top-left, vertically centred on the header row, clear of the island / notch and of
 * the centred Scripture passage capsule. While it is visible it sets html[data-floating-left]
 * so the shell's central rule pads every page header row by its footprint (header buttons —
 * back, the Notes calendar — are never covered). Hidden under More; sheets sit above it.
 */
export function TabTypeSwitcher({ hidden }: { hidden?: boolean }) {
  const tab = useAppStore((s) => s.tabs[s.activeSpace]?.find((t) => t.id === s.activeTabId[s.activeSpace]) ?? null)
  const activeKey = useAppStore((s) => `${s.activeSpace}:${s.activeTabId[s.activeSpace] ?? ''}`)
  const chrome = useChromeState()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const present = !hidden && !!tab
  // Steps aside on pages with a Back button (Back owns the leading edge).
  const pageHasBack = useAnyPageHasBack()
  const shown = present && !pageHasBack && !(chrome.overlay ? chrome.collapsed : chrome.pageCollapsed)

  useEffect(() => { if (!shown) setOpen(false) }, [shown])
  useEffect(() => { setOpen(false) }, [activeKey])
  useEffect(() => {
    const root = document.documentElement
    if (shown) root.dataset.floatingLeft = '1'; else delete root.dataset.floatingLeft
    return () => { delete root.dataset.floatingLeft }
  }, [shown])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const openCalendar = useCalendarOverlay()
  // Native Liquid Glass control while closed; its open menu (and scrim) cover it, which hides the
  // native twin so the web button (with its open state) shows under the menu as before.
  const buttonRef = useRef<HTMLButtonElement>(null)
  const glass = useLiquidGlassControls('tab-switcher', [
    { id: 'grid', ref: buttonRef, symbol: 'square.grid.2x2', label: `${tab ? tabTypeFace(tab).label : ''} tab. Change this tab to…`, iconSize: 18, onPress: () => { void haptic.selection(); setOpen((o) => !o) } },
  ], { role: 'navigation', visible: shown })

  if (!present) return null
  const face = tabTypeFace(tab)
  const items = otherExperiences(tab)
  const close = () => setOpen(false)
  // Calendar here is CONTEXTUAL (SEP27-CAL-004): an overlay over this tab, not a tab change —
  // dismissing it leaves the tab untouched; choosing a day opens that day's daily note.
  const choose = (id: (typeof items)[number]) => {
    void haptic.light(); setOpen(false)
    if (id === 'calendar') { openCalendar(); return }
    runExperience(id, 'current-tab')
  }

  return (
    <>
      {open && <div className="m-tabswitch-scrim" aria-hidden onClick={close} onTouchMove={close} onWheel={close} />}
      <div className={`m-tabswitch${shown ? '' : ' is-away'}`} aria-hidden={!shown || undefined}>
        <button ref={buttonRef} type="button" className={`m-tabswitch-button${open ? ' is-open' : ''}${glass.isNative('grid') ? ' is-native-glass' : ''}`} aria-expanded={open} aria-haspopup="menu"
          aria-label={`${face.label} tab. Change this tab to…`} tabIndex={shown && !glass.isNative('grid') ? 0 : -1} aria-hidden={glass.isNative('grid') || undefined}
          onClick={() => { void haptic.selection(); setOpen((o) => !o) }}>
          {/* One stable "experiences" glyph (the current type is already named by the page / the
              passage capsule — repeating its icon beside it read as a duplicate). */}
          <LayoutGrid size={19} aria-hidden />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div className="m-tabswitch-menu" role="menu" aria-label="Change this tab to" key="menu"
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, transition: reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 36 } }}
              exit={{ opacity: 0, scale: reduce ? 1 : 0.94, transition: { duration: reduce ? 0 : 0.12 } }}>
              {items.map((id, i) => {
                const e = EXPERIENCES[id]
                return (
                  <motion.button key={id} type="button" role="menuitem" className="m-tabswitch-item"
                    aria-label={`Change this tab to ${e.label}`} onClick={() => choose(id)}
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0, transition: reduce ? { duration: 0 } : { delay: 0.02 + i * 0.015, duration: 0.16 } }}>
                    <e.icon size={18} aria-hidden />
                    <span>{e.label}</span>
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

