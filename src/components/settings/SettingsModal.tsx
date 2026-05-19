import * as Dialog from '@radix-ui/react-dialog'
import { X, Monitor, Sun, Moon } from 'lucide-react'
import { useAppStore } from '@/store'

export default function SettingsModal() {
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const closeSettings = useAppStore((s) => s.closeSettings)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  return (
    <Dialog.Root open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="
            fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            z-50 w-full max-w-2xl max-h-[80vh] overflow-y-auto
            bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))]
            rounded-xl shadow-2xl
          "
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[rgb(var(--color-surface-4))]">
            <Dialog.Title className="text-base font-semibold text-[rgb(var(--color-text-primary))]">
              Settings
            </Dialog.Title>
            <button
              onClick={closeSettings}
              className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-default"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-6 space-y-8">
            {/* Appearance */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-4">
                Appearance
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-primary))]">Theme</p>
                  <p className="text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Choose your preferred color scheme</p>
                </div>
                <div className="flex gap-2">
                  {(['dark', 'light'] as const).map((t) => {
                    const Icon = t === 'dark' ? Moon : Sun
                    return (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={`
                          flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm capitalize
                          border transition-colors cursor-default
                          ${theme === t
                            ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/10] text-[rgb(var(--color-accent))]'
                            : 'border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
                          }
                        `}
                      >
                        <Icon size={14} />
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            {/* About */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-4">
                About
              </h3>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm text-[rgb(var(--color-text-primary))]">Berean</p>
                  <p className="text-xs text-[rgb(var(--color-text-muted))] mt-0.5">Desktop Bible study for Torah-observant believers</p>
                </div>
                <span className="text-xs text-[rgb(var(--color-text-muted))] font-mono">v0.1.0</span>
              </div>
              <div className="mt-2 p-3 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))]">
                <p className="text-xs text-[rgb(var(--color-text-muted))]">
                  More settings (fonts, texts, vault sync, YouTube) coming in Phase 2+.
                </p>
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
