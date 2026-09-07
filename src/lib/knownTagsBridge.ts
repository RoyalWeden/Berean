/**
 * Keeps refDecorations.ts's module-level known-tags cache in sync with the Zustand store, so the
 * greedy "#tag" matcher always sees the current verse-tag names (spaces included) and their
 * palette slots. Imported once for its side effect from App.tsx.
 */
import { useAppStore } from '@/store'
import { setKnownTags } from '@/components/notes/pm/refDecorations'
import type { VerseTag } from '@/types'

function push(tags: VerseTag[]) {
  setKnownTags(tags.map((t) => ({ name: t.name, colorSlot: t.colorSlot ?? null })))
}

let prev = useAppStore.getState().verseTags
push(prev)
useAppStore.subscribe((state) => {
  if (state.verseTags !== prev) {
    prev = state.verseTags
    push(prev)
  }
})
