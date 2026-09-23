import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import type { ScriptureLayout } from '@/types'
import { OptionCard, SectionLabel, Button } from '@/components/ui'

// ─── Layout metadata ─────────────────────────────────────────────────────────

interface LayoutDef {
  id: ScriptureLayout
  label: string
  description: string
}

export const LAYOUT_DEFS: LayoutDef[] = [
  { id: 'standard',         label: 'Classic',            description: 'Scripture with side panel (Notes, Lexicon, Cross Refs)' },
  { id: 'reading',          label: 'Reading',            description: 'Full-width scripture, no side panel' },
  { id: 'scripture-focus',  label: 'Centered',           description: 'Centered, max-width scripture — distraction-free reading' },
  { id: 'notes-right',      label: 'Companion Notes',    description: 'Scripture on left, dedicated full-height notes editor on right' },
  { id: 'notes-bottom',     label: 'Notes Below',        description: 'Scripture on top, notes editor spanning the bottom' },
  { id: 'notes-top',        label: 'Notes Above',        description: 'Notes editor above scripture' },
  { id: 'commentary',       label: 'Commentary',         description: 'Wide notes on left (no tab strip), scripture on right — side-by-side study' },
  { id: 'panel-bottom',     label: 'Panel Below',        description: 'Scripture on top, full side panel (Notes/Lexicon/CrossRefs) below' },
  { id: 'panel-left',       label: 'Panel Left',         description: 'Side panel on left, scripture on right' },
  { id: 'notes-wide',       label: 'Notes Focus',        description: 'Narrow scripture, wide notes panel' },
  { id: 'scripture-wide',   label: 'Scripture Focus',    description: 'Wide scripture, slim side panel' },
  { id: 'study-grid',       label: 'Deep Study',         description: 'Scripture on left, Lexicon stacked above Cross Refs on right' },
  { id: 'lexicon-crossref', label: 'Quad Study',         description: '2×2 grid — Scripture, Lexicon, Notes, Cross Refs all visible at once (independently resizable)' },
  { id: 'split-bottom',     label: 'Split Bottom',       description: 'Scripture on top; Notes and Lexicon side-by-side in the bottom row' },
  { id: 'triple-col',       label: 'Triple Column',      description: 'Three equal columns — Notes, Scripture, Lexicon' },
  { id: 'compare-notes',    label: 'Compare + Notes',    description: 'Translation compare view with notes panel below' },
]

// ─── Visual thumbnails ───────────────────────────────────────────────────────

const S = 'rounded-[2px] bg-accent/35'        // scripture
const N = 'rounded-[2px] bg-surface-4'         // notes / panel
const L = 'rounded-[2px] bg-warning/30'                            // lexicon
const C = 'rounded-[2px] bg-info/25'                               // crossrefs
const DIVH = 'w-px bg-surface-4 flex-shrink-0' // vertical divider
const DIVV = 'h-px bg-surface-4 flex-shrink-0' // horizontal divider

function LayoutThumb({ id }: { id: ScriptureLayout }) {
  const w = 'w-full h-full flex'

  switch (id) {
    case 'standard':
      return <div className={w}><div className={`flex-[3] ${S} mr-0.5`} /><div className={`flex-[2] ${N}`} /></div>
    case 'panel-bottom':
      return <div className={`${w} flex-col`}><div className={`flex-[3] ${S} mb-0.5`} /><div className={`flex-[2] ${N}`} /></div>
    case 'notes-bottom':
      return <div className={`${w} flex-col`}><div className={`flex-[3] ${S} mb-0.5`} /><div className={`flex-1 ${N}`} /></div>
    case 'lexicon-crossref':
      return (
        <div className={`${w} flex-col`}>
          <div className="flex-1 flex mb-0.5">
            <div className={`flex-[3] ${S} mr-0.5`} />
            <div className={`flex-[2] ${L}`} />
          </div>
          <div className="flex-1 flex">
            <div className={`flex-[3] ${N} mr-0.5`} />
            <div className={`flex-[2] ${C}`} />
          </div>
        </div>
      )
    case 'reading':
      return <div className={w}><div className={`flex-1 ${S}`} /></div>
    case 'panel-left':
      return <div className={w}><div className={`flex-[2] ${N} mr-0.5`} /><div className={`flex-[3] ${S}`} /></div>
    case 'notes-wide':
      return <div className={w}><div className={`flex-[2] ${S} mr-0.5`} /><div className={`flex-[3] ${N}`} /></div>
    case 'scripture-wide':
      return <div className={w}><div className={`flex-[3] ${S} mr-0.5`} /><div className={`flex-1 ${N}`} /></div>
    case 'compare-notes':
      return (
        <div className={`${w} flex-col`}>
          <div className="flex-[3] flex mb-0.5 gap-0.5">
            <div className={`flex-1 ${S}`} />
            <div className={`flex-1 ${S}`} />
          </div>
          <div className={`flex-1 ${N}`} />
        </div>
      )
    case 'study-grid':
      return (
        <div className={w}>
          <div className={`flex-[3] ${S} mr-0.5`} />
          <div className="flex-[2] flex flex-col gap-0.5">
            <div className={`flex-1 ${L}`} />
            <div className={`flex-1 ${C}`} />
          </div>
        </div>
      )
    case 'scripture-focus':
      return (
        <div className={`${w} items-stretch`}>
          <div className="flex-1" />
          <div className={`flex-[3] ${S}`} />
          <div className="flex-1" />
        </div>
      )
    case 'notes-right':
      return <div className={w}><div className={`flex-[3] ${S} mr-0.5`} /><div className={`flex-[2] ${N}`} /></div>
    case 'notes-top':
      return <div className={`${w} flex-col`}><div className={`flex-1 ${N} mb-0.5`} /><div className={`flex-[3] ${S}`} /></div>
    case 'triple-col':
      return <div className={w}><div className={`flex-1 ${N} mr-0.5`} /><div className={`flex-[2] ${S} mr-0.5`} /><div className={`flex-1 ${L}`} /></div>
    case 'commentary':
      return <div className={w}><div className={`flex-1 ${N} mr-0.5`} /><div className={`flex-1 ${S}`} /></div>
    case 'split-bottom':
      return (
        <div className={`${w} flex-col`}>
          <div className={`flex-[2] ${S} mb-0.5`} />
          <div className="flex-1 flex gap-0.5">
            <div className={`flex-1 ${N}`} />
            <div className={`flex-1 ${L}`} />
          </div>
        </div>
      )
    default:
      return <div className={`flex-1 ${S}`} />
  }
}

// ─── Picker popover ──────────────────────────────────────────────────────────

interface LayoutPickerProps {
  current: ScriptureLayout
  onSelect: (layout: ScriptureLayout) => void
  onClose: () => void
  /** If provided, shows a "Save as default" action */
  defaultLayout?: ScriptureLayout
  onSaveDefault?: (layout: ScriptureLayout) => void
}

export default function LayoutPicker({ current, onSelect, onClose, defaultLayout, onSaveDefault }: LayoutPickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      // Placed and layered by its MenuPositioner (BiblePanel) — no own position / z-index.
      className="w-[420px] material-popover rounded-menu p-3"
    >
      <SectionLabel className="mb-2 px-1">Panel Layout</SectionLabel>
      <div className="grid grid-cols-3 gap-1.5">
        {LAYOUT_DEFS.map((def) => {
          const isActive = current === def.id
          const isDefault = defaultLayout === def.id
          return (
            <OptionCard
              key={def.id}
              selected={isActive}
              onClick={() => { onSelect(def.id); onClose() }}
              title={
                <span className="flex items-center gap-1 min-w-0 w-full">
                  <span className="truncate flex-1">{def.label}</span>
                  {isActive && <Check size={10} className="text-accent flex-shrink-0" />}
                  {isDefault && !isActive && (
                    <span className="text-micro px-1 py-0.5 rounded-chip bg-surface-4 text-text-muted flex-shrink-0 leading-none">
                      default
                    </span>
                  )}
                </span>
              }
              aria-label={def.description}
              className="gap-1.5"
              preview={
                <div className="w-full h-[42px] rounded-card overflow-hidden">
                  <LayoutThumb id={def.id} />
                </div>
              }
            />
          )
        })}
      </div>

      {/* Save as default */}
      {onSaveDefault && current !== defaultLayout && (
        <div className="mt-2 pt-2 border-t border-separator flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => { onSaveDefault(current); onClose() }}>
            Save as default layout
          </Button>
        </div>
      )}
    </div>
  )
}
