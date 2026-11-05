import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Spec §7.3: prompts, notes and keys are not logged. These files handle all three, so they log nothing.
const FILES = ['electron/ipc/aiLookup.ts', 'electron/ipc/aiProviders.ts', 'electron/modelGateway.ts', 'electron/ollama.ts', 'electron/secrets/providerKeys.ts', 'electron/secrets/providerSettings.ts', 'src/lib/research/providers.ts', 'src/lib/research/premise.ts']

describe('AI code paths', () => {
  it.each(FILES)('%s has no logging calls', (file) => {
    expect(readFileSync(resolve(__dirname, '../..', file), 'utf8')).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\(|\blog\.(info|warn|error|debug)\(/)
  })
})
