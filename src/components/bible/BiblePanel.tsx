import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { useAppStore } from '@/store'
import ChapterView from './ChapterView'
import type { Book, BibleTabState } from '@/types'

export default function BiblePanel() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const updateTabState = useAppStore((s) => s.updateTabState)

  const activeTab = tabs['scripture'].find((t) => t.id === activeTabId['scripture'])
  const tabState = (activeTab?.state ?? { bookId: 'GEN', chapter: 1, translation: 'KJV', showStrongs: false, scrollPosition: 0 }) as BibleTabState

  const [books, setBooks] = useState<Book[]>([])

  useEffect(() => {
    window.bible.getBooks().then(setBooks).catch(console.error)
  }, [])

  const currentBook = books.find((b) => b.id === tabState.bookId)
  const chapterCount = currentBook?.chapters_count ?? 50

  function navigate(bookId: string, chapter: number) {
    if (!activeTab) return
    updateTabState('scripture', activeTab.id, { bookId, chapter, scrollPosition: 0 })
    const book = books.find((b) => b.id === bookId)
    if (book) {
      // Update tab title — store doesn't have a dedicated action for this but we can use updateTabState with a title hack
      // For now the title stays as initialized
    }
  }

  function prevChapter() {
    if (tabState.chapter > 1) {
      navigate(tabState.bookId, tabState.chapter - 1)
    } else {
      // Go to last chapter of previous book
      const bookIdx = books.findIndex((b) => b.id === tabState.bookId)
      if (bookIdx > 0) {
        const prev = books[bookIdx - 1]
        navigate(prev.id, prev.chapters_count)
      }
    }
  }

  function nextChapter() {
    if (tabState.chapter < chapterCount) {
      navigate(tabState.bookId, tabState.chapter + 1)
    } else {
      const bookIdx = books.findIndex((b) => b.id === tabState.bookId)
      if (bookIdx < books.length - 1) {
        navigate(books[bookIdx + 1].id, 1)
      }
    }
  }

  const otBooks = books.filter((b) => b.testament === 'OT')
  const ntBooks = books.filter((b) => b.testament === 'NT')

  return (
    <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
      {/* Reference bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 bg-[rgb(var(--color-surface-2))]">
        {/* Book selector */}
        <select
          value={tabState.bookId}
          onChange={(e) => navigate(e.target.value, 1)}
          className="
            bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-primary))]
            border border-[rgb(var(--color-surface-4))] rounded-md px-2 py-1 text-sm
            cursor-default outline-none focus:border-[rgb(var(--color-accent))]
          "
        >
          <optgroup label="Old Testament">
            {otBooks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </optgroup>
          <optgroup label="New Testament">
            {ntBooks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </optgroup>
        </select>

        {/* Chapter selector */}
        <select
          value={tabState.chapter}
          onChange={(e) => navigate(tabState.bookId, Number(e.target.value))}
          className="
            bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-primary))]
            border border-[rgb(var(--color-surface-4))] rounded-md px-2 py-1 text-sm
            cursor-default outline-none focus:border-[rgb(var(--color-accent))]
            w-20
          "
        >
          {Array.from({ length: chapterCount }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        {/* Translation badge */}
        <span className="text-xs font-medium px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">
          {tabState.translation}
        </span>

        <div className="flex-1" />

        {/* Strong's toggle */}
        <button
          onClick={() => activeTab && updateTabState('scripture', activeTab.id, { showStrongs: !tabState.showStrongs })}
          title="Toggle Strong's numbers"
          className={`
            flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors cursor-default
            ${tabState.showStrongs
              ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
              : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'
            }
          `}
        >
          <Layers size={14} />
          <span>Strong's</span>
        </button>

        {/* Navigation arrows */}
        <button
          onClick={prevChapter}
          className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-default"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={nextChapter}
          className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-default"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Chapter content */}
      <div className="flex-1 overflow-y-auto">
        <ChapterView
          bookId={tabState.bookId}
          chapter={tabState.chapter}
          showStrongs={tabState.showStrongs}
        />
      </div>
    </div>
  )
}
