import { describe, it, expect } from 'vitest'
import { chatModels, chooseLocalModel } from '../modelChoice'

const D = 'llama3.1:latest'

describe('chooseLocalModel', () => {
  it('automatic takes the measured default when installed, then the current one', () => {
    expect(chooseLocalModel('auto', [D, 'qwen3.5:2b-q4_K_M'], D)).toEqual({ model: 'qwen3.5:2b-q4_K_M' })
    expect(chooseLocalModel('auto', ['llama3.1:latest', 'ministral-3:3b'], D)).toEqual({ model: D })
    expect(chooseLocalModel(undefined, ['llama3.1'], D)).toEqual({ model: D })
  })
  it('Deep Search escalates to the larger installed model, says so, and only with the memory', () => {
    const installed = [D, 'gemma4:12b-it-qat']
    const roomy = { deepSearch: true, totalMemoryBytes: 32e9 }
    expect(chooseLocalModel('auto', installed, D, roomy)).toMatchObject({ model: 'gemma4:12b-it-qat', notice: expect.stringContaining('Deep Search used') })
    expect(chooseLocalModel('auto', installed, D, { ...roomy, totalMemoryBytes: 8e9 })).toEqual({ model: D })
    expect(chooseLocalModel('auto', installed, D, { totalMemoryBytes: 32e9 })).toEqual({ model: D })
    expect(chooseLocalModel('auto', [D], D, roomy)).toEqual({ model: D })
  })
  it('never escalates past a manual choice', () => {
    expect(chooseLocalModel(D, [D, 'gemma4:12b-it-qat'], D, { deepSearch: true, totalMemoryBytes: 32e9 })).toEqual({ model: D })
  })
  it('automatic moves to a measured compact model when the default is missing', () => {
    expect(chooseLocalModel('auto', ['llama3.2:3b', 'gemma3:4b'], D)).toEqual({ model: 'llama3.2:3b' })
  })
  it('a manual choice wins, and says so when it cannot', () => {
    expect(chooseLocalModel('gemma3:4b', ['gemma3:4b', D], D)).toEqual({ model: 'gemma3:4b' })
    expect(chooseLocalModel('gone:1b', [D], D)).toEqual({ model: D, notice: `gone:1b isn't installed, so this answer used ${D}.` })
  })
  it('changes nothing when the installed list is unknown', () => {
    expect(chooseLocalModel('gemma3:4b', [], D)).toEqual({ model: 'gemma3:4b' })
    expect(chooseLocalModel('auto', [], D)).toEqual({ model: D })
  })
  it('hides embedding models from the picker', () => {
    expect(chatModels(['mxbai-embed-large:latest', 'nomic-embed-text:latest', D])).toEqual([D])
  })
})
