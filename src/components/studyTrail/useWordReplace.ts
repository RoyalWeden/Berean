import { useAppStore } from '@/store'
import { applyWordReplacer } from '@/lib/wordReplacer'

/**
 * Study Trail shows a lot of free text pulled from elsewhere in the app — verse previews,
 * Strong's glosses, search queries, note titles, AI Lookup questions, generated recaps — none
 * of which previously ran through the app-wide Word Replacer (the user-configurable text
 * substitution used everywhere actual Bible/note content is displayed, e.g. VerseRow.tsx).
 * This window is a separate renderer, but useAppStore's wordReplacer settings persist via the
 * same localStorage the theme setting already relies on (see StudyTrailApp.tsx's theme sync
 * comment), so reading them here works the same way with no extra plumbing.
 */
export function useWordReplace(): (text: string) => string {
  const enabled = useAppStore((s) => s.wordReplacerEnabled)
  const rules = useAppStore((s) => s.wordReplacerRules)
  return (text: string) => (enabled && rules.length > 0 ? applyWordReplacer(text, rules) : text)
}
