import { useEffect } from 'react'
import { useAppStore } from '@/store'
import Sidebar from '@/components/shell/Sidebar'
import PanelLayout from '@/components/shell/PanelLayout'
import FloatingSearch from '@/components/shell/FloatingSearch'
import SettingsModal from '@/components/settings/SettingsModal'

export default function App() {
  const theme = useAppStore((s) => s.theme)
  const openSearch = useAppStore((s) => s.openSearch)
  const openSettings = useAppStore((s) => s.openSettings)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)

  // Sync theme class on <html>
  useEffect(() => {
    const html = document.documentElement
    if (theme === 'dark') {
      html.classList.add('dark')
      html.classList.remove('light')
    } else {
      html.classList.add('light')
      html.classList.remove('dark')
    }
  }, [theme])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 'k') {
        e.preventDefault()
        openSearch()
      } else if (meta && e.key === 't') {
        e.preventDefault()
        openSearch()
      } else if (meta && e.key === ',') {
        e.preventDefault()
        openSettings()
      } else if (meta && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openSearch, openSettings, toggleSidebar])

  return (
    <div className="flex h-screen overflow-hidden bg-[rgb(var(--color-surface-1))]">
      <Sidebar />
      <main className="flex-1 relative overflow-hidden">
        <PanelLayout />
      </main>
      <FloatingSearch />
      <SettingsModal />
    </div>
  )
}
