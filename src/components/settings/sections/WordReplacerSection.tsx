import { ToggleLeft, ToggleRight } from 'lucide-react'
import Switch from '@/components/shell/Switch'
import type { WordReplacerRule } from '@/store'

interface WordReplacerSectionProps {
  enabled: boolean
  rules: WordReplacerRule[]
  onToggleEnabled: (v: boolean) => void
  onToggleRule: (id: string) => void
}

export default function WordReplacerSection({ enabled, rules, onToggleEnabled, onToggleRule }: WordReplacerSectionProps) {
  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Word replacer</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Substitute archaic or Latinised names in scripture text with more recognisable forms.
            Only applies to the Scripture tab — never to notes, lexicon, or YouTube.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={() => onToggleEnabled(!enabled)} />
      </div>

      {/* Divine name rules (Strong's-number-based, KJVA only) */}
      {(() => {
        const strongsRules = rules.filter(r => r.strongsNum)
        const textRules = rules.filter(r => !r.strongsNum)
        const RuleRow = (rule: WordReplacerRule) => (
          <div
            key={rule.id}
            className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${
              rule.enabled && enabled
                ? 'border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))]'
                : 'border-[rgb(var(--color-surface-4))/50] bg-[rgb(var(--color-surface-3))/50] opacity-60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <code className="text-[11px] font-mono text-[rgb(var(--color-text-muted))] truncate">
                {rule.strongsNum ?? rule.queries.join(' / ')}
              </code>
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">→</span>
              <span className="text-[11px] text-[rgb(var(--color-text-primary))] font-medium truncate">{rule.replacement}</span>
              {rule.strongsNum && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 flex-shrink-0 font-semibold">KJVA</span>
              )}
              {rule.wholeWord && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] flex-shrink-0">whole word</span>
              )}
            </div>
            <button
              onClick={() => onToggleRule(rule.id)}
              title={rule.enabled ? 'Disable this rule' : 'Enable this rule'}
              className="flex-shrink-0 ml-2 cursor-pointer"
            >
              {rule.enabled
                ? <ToggleRight size={18} className="text-[rgb(var(--color-accent))]" />
                : <ToggleLeft size={18} className="text-[rgb(var(--color-text-muted))]" />
              }
            </button>
          </div>
        )
        return (
          <>
            {strongsRules.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">Divine Name</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">KJVA only</span>
                </div>
                <p className="text-[10px] text-[rgb(var(--color-text-muted))] mb-2 leading-relaxed">
                  Matches by Strong's number — precise per-word replacement regardless of how the word is spelled in English. Only applies where Strong's tags are available (KJVA).
                </p>
                <div className="space-y-1">
                  {strongsRules.map(RuleRow)}
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-2">Text rules</p>
              <div className="space-y-1">
                {textRules.map(RuleRow)}
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
