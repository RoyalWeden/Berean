import { describe, it, expect } from 'vitest'
import { chatModels, chooseLocalModel } from '../modelChoice'

const D = 'llama3.1:latest'

describe('chooseLocalModel', () => {
  it('automatic keeps the default while it is installed', () => {
    expect(chooseLocalModel('auto', ['llama3.1:latest', 'ministral-3:3b'], D)).toEqual({ model: D })
    expect(chooseLocalModel(undefined, ['llama3.1'], D)).toEqual({ model: D })
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
