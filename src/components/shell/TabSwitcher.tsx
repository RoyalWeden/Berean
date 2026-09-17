import { useEffect, useRef, useState } from 'react'
import type { SpaceId, Tab, BibleTabState, NoteTabState, LexiconTabState, YouTubeTabState, SearchTabState } from '@/types'
import { motion } from 'framer-motion'
import { SPRING_GENTLE } from '@/lib/motion'

export interface SwitcherTab {
  spaceId: SpaceId
  tabId: string
  title: string
  tab: Tab
}

interface TabSwitcherProps {
  tabs: SwitcherTab[]
  selectedIndex: number
  /** Called when the user clicks or hover-selects a card. Index changes the keyboard highlight. */
  onHoverIndex: (index: number) => void
  /** Called when the user clicks a tab card to navigate immediately. */
  onSelectTab: (spaceId: SpaceId, tabId: string) => void
  /** Called when the user clicks the backdrop or presses Escape — closes without switching. */
  onClose: () => void
}

const SPACE_CONFIG: Record<SpaceId, { abbrev: string; color: string; label: string }> = {
  scripture: { abbrev: 'S',  color: 'rgb(var(--color-accent))',  label: 'Scripture' },
  notes:     { abbrev: 'N',  color: 'rgb(234,179,8)',            label: 'Notes'     },
  lexicon:   { abbrev: 'L',  color: 'rgb(52,211,153)',           label: 'Lexicon'   },
  youtube:   { abbrev: 'Y',  color: 'rgb(239,68,68)',            label: 'YouTube'   },
  search:    { abbrev: '⌕', color: 'rgb(167,139,250)',          label: 'Search'    },
}

// ── Mini content preview rendered inside each tab card ──────────────────────

function BiblePreview({ state }: { state: BibleTabState }) {
  return (
    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
      {/* Translation badge */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-micro font-bold tracking-wide px-1 py-0.5 rounded-chip bg-accent-muted text-accent leading-none">
          {state.translation?.toUpperCase() ?? 'KJVA'}
        </span>
        {state.compareMode && (
          <span className="text-micro font-bold tracking-wide px-1 py-0.5 rounded-chip bg-surface-4 text-text-muted leading-none">
            CMP
          </span>
        )}
      </div>
      {/* Simulated verse lines */}
      <div className="flex flex-col gap-[3px] mt-0.5 flex-1 overflow-hidden">
        {[70, 90, 55, 80, 65].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full bg-text-muted opacity-30" style={{ width: `${w}%` }} />
        ))}
        <div className="h-[3px] rounded-full bg-text-muted opacity-20" style={{ width: '40%' }} />
      </div>
    </div>
  )
}

function NotePreview({ state }: { state: NoteTabState }) {
  return (
    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
      {/* Title line */}
      <div className="h-[4px] rounded-full bg-text-primary opacity-40" style={{ width: '80%' }} />
      {/* Note lines */}
      <div className="flex flex-col gap-[3px] mt-1 flex-1 overflow-hidden">
        {[95, 85, 70, 90, 60].map((w, i) => (
          <div key={i} className="h-[3px] rounded-full bg-text-muted opacity-25" style={{ width: `${w}%` }} />
        ))}
        <div className="h-[3px] rounded-full bg-text-muted opacity-15" style={{ width: '50%' }} />
      </div>
      {/* Verse tag if applicable — literal color matches this space's identity hue
          (SPACE_CONFIG.notes), same accepted-literal treatment as TabBar.tsx's
          per-type tab icon colors. */}
      {state.verseRef && (
        <div className="flex-shrink-0 h-[3px] rounded-full bg-[rgb(234,179,8)] opacity-40" style={{ width: '55%' }} />
      )}
    </div>
  )
}

function LexiconPreview({ state }: { state: LexiconTabState }) {
  const isHebrew = state.strongsNum?.startsWith('H')
  const color = isHebrew ? 'rgb(251,191,36)' : 'rgb(99,102,241)'
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 overflow-hidden">
      {state.strongsNum ? (
        <>
          <span
            className="text-caption font-bold leading-none"
            style={{ color }}
          >
            {state.strongsNum}
          </span>
          {/* Simulated definition lines */}
          <div className="flex flex-col gap-[3px] w-full">
            <div className="h-[3px] rounded-full" style={{ background: color, opacity: 0.35, width: '90%' }} />
            <div className="h-[3px] rounded-full" style={{ background: color, opacity: 0.2, width: '65%' }} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-[3px] w-full items-center">
          <div className="h-[3px] rounded-full bg-[rgb(52,211,153)] opacity-30" style={{ width: '70%' }} />
          <div className="h-[3px] rounded-full bg-[rgb(52,211,153)] opacity-20" style={{ width: '50%' }} />
        </div>
      )}
    </div>
  )
}

function YouTubePreview() {
  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      {/* Mini video thumbnail placeholder */}
      <div className="w-full h-full rounded-card bg-surface-4 flex items-center justify-center relative overflow-hidden">
        {/* 16:9 letterbox lines */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-black/30" />
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-black/30" />
        {/* Play button */}
        <div className="w-0 h-0 border-l-[7px] border-l-[rgb(239,68,68)] border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent" />
      </div>
    </div>
  )
}

function SearchPreview({ state }: { state: SearchTabState }) {
  return (
    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
      {/* Search bar line */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <div className="w-[6px] h-[6px] rounded-full border border-[rgb(167,139,250)] opacity-50 flex-shrink-0" />
        <div className="flex-1 h-[3px] rounded-full bg-[rgb(167,139,250)] opacity-25" />
      </div>
      {/* Result lines */}
      <div className="flex flex-col gap-[3px] mt-0.5 flex-1 overflow-hidden">
        {[75, 60, 85, 55].map((w, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="w-[3px] h-[3px] rounded-full bg-[rgb(167,139,250)] opacity-40 flex-shrink-0" />
            <div className="h-[2.5px] rounded-full bg-text-muted opacity-20" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TabPreview({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'bible':   return <BiblePreview   state={tab.state as BibleTabState}   />
    case 'note':    return <NotePreview    state={tab.state as NoteTabState}    />
    case 'lexicon': return <LexiconPreview state={tab.state as LexiconTabState} />
    case 'youtube': return <YouTubePreview />
    case 'search':  return <SearchPreview  state={tab.state as SearchTabState}  />
    default:        return null
  }
}

// ────────────────────────────────────────────────────────────────────────────

// Cards are a per-tab visual preview — fine for a handful of tabs, but
// unreadable/unbounded once dozens are open (the old version just kept
// wrapping onto more rows forever). `tabs` is already MRU-ordered (most
// recent first), so the first MAX_CARDS stay as cards and everything past
// that renders as a plain, compact list instead — most-recent-first still,
// just without the preview real estate.
const MAX_CARDS = 5

export default function TabSwitcher({ tabs, selectedIndex, onHoverIndex, onSelectTab, onClose }: TabSwitcherProps) {
  // The overlay opens centered on screen, often directly under wherever the cursor
  // already happens to be resting (no trackpad/mouse touched at all) — Chromium still
  // fires mouseenter for whatever card appears under a stationary pointer, which was
  // silently overriding the keyboard-driven selection the instant the switcher opened.
  // Require one genuine mousemove after mount before any hover can drive selection.
  const [mouseActive, setMouseActive] = useState(false)
  useEffect(() => {
    function onMove() { setMouseActive(true) }
    window.addEventListener('mousemove', onMove, { once: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])
  function handleHover(i: number) {
    if (mouseActive) onHoverIndex(i)
  }

  // Keyboard cycling (Ctrl+Tab held, repeatedly pressed) can land selectedIndex on a
  // row in the scrollable "rest of the tabs" list below the cards, which the fixed-
  // height list div doesn't auto-reveal on its own — scroll it into view whenever the
  // selection moves there.
  const selectedListItemRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedListItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (tabs.length === 0) return null

  const selected = tabs[selectedIndex]
  const cardTabs = tabs.slice(0, MAX_CARDS)
  const listTabs = tabs.slice(MAX_CARDS)

  return (
    // Outer overlay: pointer-events-auto so backdrop click closes the switcher.
    <div
      className="fixed inset-0 z-critical flex items-center justify-center pointer-events-auto"
      onMouseDown={onClose}
    >
      {/* Backdrop — a plain scrim, not a "material" surface, so it keeps its own
          inline blur rather than adopting one of the named `.material-*` recipes. */}
      <motion.div
        className="absolute inset-0 bg-black/40" style={{ backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12 }}
      />

      {/* Switcher card — stop propagation so clicks inside don't trigger backdrop close */}
      <motion.div
        className="relative pointer-events-auto material-sheet rounded-sheet px-5 py-4 flex flex-col items-center gap-4 min-w-[240px] max-w-[min(90vw,760px)]"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={SPRING_GENTLE}
      >

        {/* Tab cards row — only the MAX_CARDS most recent */}
        <div className="flex flex-wrap justify-center gap-2.5">
          {cardTabs.map((tab, i) => {
            const cfg = SPACE_CONFIG[tab.spaceId]
            const isSelected = i === selectedIndex
            return (
              <motion.button
                key={`${tab.spaceId}-${tab.tabId}`}
                type="button"
                onClick={() => onSelectTab(tab.spaceId, tab.tabId)}
                onMouseEnter={() => handleHover(i)}
                initial={{ opacity: 0, y: 6, scale: 1 }}
                animate={{ opacity: 1, y: 0, scale: isSelected ? 1.04 : 1 }}
                transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.15 }}
                whileHover={{ scale: isSelected ? 1.04 : 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`flex flex-col w-[96px] rounded-card overflow-hidden cursor-pointer focus:outline-none ${
                  isSelected
                    ? 'bg-surface-selected'
                    : 'bg-surface-3 hover:bg-surface-hover'
                }`}
                style={isSelected ? { outline: `2px solid ${cfg.color}`, outlineOffset: '-2px' } : undefined}
              >
                {/* Visual preview area */}
                <div
                  className="w-full h-[60px] px-2 pt-2 pb-1.5 relative overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${cfg.color}08 0%, ${cfg.color}03 100%)` }}
                >
                  <TabPreview tab={tab.tab} />
                </div>

                {/* Footer: badge + title */}
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-separator">
                  {/* Space badge pill — literal per-space identity color (SPACE_CONFIG),
                      same accepted-literal treatment as TabBar.tsx's tab icon colors. */}
                  <div
                    className="w-4 h-4 rounded-chip flex items-center justify-center text-micro font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: cfg.color }}
                  >
                    {cfg.abbrev}
                  </div>
                  {/* Tab title */}
                  <p
                    className={`text-micro leading-tight truncate flex-1 min-w-0 ${
                      isSelected
                        ? 'text-text-primary font-medium'
                        : 'text-text-muted'
                    }`}
                  >
                    {tab.title}
                  </p>
                </div>
              </motion.button>
            )
          })}
        </div>

        {/* Remaining tabs (beyond the MAX_CARDS most recent) — plain rows, no
            preview, still most-recent-first and part of the same keyboard
            cycle/selection as the cards above (index continues from cardTabs). */}
        {listTabs.length > 0 && (
          <div className="w-full max-h-[180px] overflow-y-auto flex flex-col gap-0.5 border-t border-separator pt-2">
            {listTabs.map((tab, j) => {
              const i = MAX_CARDS + j
              const cfg = SPACE_CONFIG[tab.spaceId]
              const isSelected = i === selectedIndex
              return (
                <button
                  key={`${tab.spaceId}-${tab.tabId}`}
                  ref={isSelected ? selectedListItemRef : undefined}
                  type="button"
                  onClick={() => onSelectTab(tab.spaceId, tab.tabId)}
                  onMouseEnter={() => handleHover(i)}
                  className={`flex items-center gap-2 px-2 py-1 rounded-row text-left cursor-pointer transition-colors ${
                    isSelected ? 'bg-surface-selected hover:bg-accent-muted' : 'hover:bg-surface-hover'
                  }`}
                >
                  <div
                    className="w-4 h-4 rounded-chip flex items-center justify-center text-micro font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: cfg.color }}
                  >
                    {cfg.abbrev}
                  </div>
                  <p className={`text-caption leading-tight truncate flex-1 min-w-0 ${
                    isSelected ? 'text-text-primary font-medium' : 'text-text-muted'
                  }`}>
                    {tab.title}
                  </p>
                </button>
              )
            })}
          </div>
        )}

        {/* Selected tab status bar */}
        {selected && (
          <div className="text-footnote text-text-secondary border-t border-separator pt-3 w-full text-center">
            <span className="font-medium" style={{ color: SPACE_CONFIG[selected.spaceId].color }}>
              {SPACE_CONFIG[selected.spaceId].label}
            </span>
            {' · '}
            <span className="text-text-primary font-medium">{selected.title}</span>
          </div>
        )}
      </motion.div>
    </div>
  )
}
