// Recommended local models for Ask Berean (spec §8.3). Pure and shared: the Settings screen shows
// it and the main process validates download/delete requests against it.
//
// Sizes are the real download sizes Ollama reports (decimal GB). Memory is an ESTIMATE — weights
// plus the KV cache at Berean's 16,384-token window — and varies with the Mac and other apps.

export type ModelTier = 'compact' | 'standard' | 'large'

export interface CatalogModel {
  /** The exact Ollama model name. */
  id: string
  label: string
  tier: ModelTier
  /** Download size in bytes. */
  sizeBytes: number
  /** Estimated memory while loaded, in bytes. An estimate, not a measurement. */
  estimatedMemoryBytes: number
  license: string
  purpose: string
}

const GB = 1_000_000_000
const UNKNOWN_LICENSE = "See the model's license"

/** The one list to edit when the benchmark settles which models to recommend. */
export const RECOMMENDED_MODELS: readonly CatalogModel[] = [
  { id: 'llama3.2:3b', label: 'Llama 3.2 3B', tier: 'compact', sizeBytes: 2.0 * GB, estimatedMemoryBytes: 3.5 * GB,
    license: 'Llama 3.2 Community License', purpose: 'Smallest option. Fast, for Macs with limited memory.' },
  { id: 'ministral-3:3b', label: 'Ministral 3 3B', tier: 'compact', sizeBytes: 3.0 * GB, estimatedMemoryBytes: 4.5 * GB,
    license: UNKNOWN_LICENSE, purpose: 'Small and quick, a little more capable than the smallest option.' },
  { id: 'llama3.1:latest', label: 'Llama 3.1 8B', tier: 'standard', sizeBytes: 4.9 * GB, estimatedMemoryBytes: 7 * GB,
    license: 'Llama 3.1 Community License', purpose: 'The model Ask Berean has been tuned on.' },
  { id: 'qwen3.5:9b-q4_K_M', label: 'Qwen 3.5 9B', tier: 'standard', sizeBytes: 6.6 * GB, estimatedMemoryBytes: 8.5 * GB,
    license: 'Apache-2.0', purpose: 'Larger and more accurate, slower to answer.' },
  { id: 'gemma4:12b-it-qat', label: 'Gemma 4 12B', tier: 'large', sizeBytes: 7.2 * GB, estimatedMemoryBytes: 9.5 * GB,
    license: 'Apache-2.0', purpose: 'The largest option. Best for Macs with plenty of memory.' },
]

export const TIER_LABEL: Record<ModelTier, string> = { compact: 'Compact', standard: 'Standard', large: 'Large' }

export function catalogModel(id: string): CatalogModel | undefined {
  return RECOMMENDED_MODELS.find((m) => m.id === id)
}

// A plain Ollama name: letters, digits and . _ - : / only, so nothing odd reaches the runtime.
const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/

/** True only for a well-formed id that is in the catalog or already installed. Used for every
 *  download and delete request from the renderer. */
export function isAllowedModelId(id: unknown, installed: readonly string[]): id is string {
  return typeof id === 'string' && MODEL_NAME_RE.test(id) && (!!catalogModel(id) || installed.includes(id))
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
}
