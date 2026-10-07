import { describe, it, expect, vi } from 'vitest'
import { maybeImportVault } from '../Onboarding'

// StepVault (Onboarding.tsx) previously only persisted vaultPath/vaultSync — it never imported
// the vault's existing notes, so connecting a plain Obsidian/Octarine vault (or restoring a
// previous Berean export) in onboarding left the user staring at an empty notes list until they
// separately found Settings → Vault Sync or restarted the app. maybeImportVault is the fix,
// called from both StepVault.pickFolder and StepVault.toggleSync; it mirrors
// SettingsModal.saveVaultPath's existing hasData-gated auto-import.
describe('maybeImportVault (Onboarding StepVault auto-import)', () => {
  it('imports when the vault has data', async () => {
    const hasData = vi.fn().mockResolvedValue(true)
    const importAll = vi.fn().mockResolvedValue({ success: true, notesCreated: 3 })
    await maybeImportVault({ hasData, importAll } as never)
    expect(hasData).toHaveBeenCalledTimes(1)
    expect(importAll).toHaveBeenCalledTimes(1)
  })

  it('does not import an empty vault', async () => {
    const hasData = vi.fn().mockResolvedValue(false)
    const importAll = vi.fn()
    await maybeImportVault({ hasData, importAll } as never)
    expect(importAll).not.toHaveBeenCalled()
  })

  it('swallows a hasData rejection (treated as false) and an importAll rejection, never throwing', async () => {
    const hasData = vi.fn().mockRejectedValue(new Error('ipc down'))
    const importAll = vi.fn()
    await expect(maybeImportVault({ hasData, importAll } as never)).resolves.toBeUndefined()
    expect(importAll).not.toHaveBeenCalled()

    const hasData2 = vi.fn().mockResolvedValue(true)
    const importAll2 = vi.fn().mockRejectedValue(new Error('import failed'))
    await expect(maybeImportVault({ hasData: hasData2, importAll: importAll2 } as never)).resolves.toBeUndefined()
  })

  it('is a no-op when no vault API is present (e.g. non-Electron renderer)', async () => {
    await expect(maybeImportVault(undefined)).resolves.toBeUndefined()
  })
})
