import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PreTrainedTokenizer } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'

export const voices = [
  { accent: 'en-us', language: 'a', voice: 'af_heart' },
  { accent: 'en', language: 'b', voice: 'bf_emma' },
]

function fixtureTokenizer() {
  // Explicit test vocabulary. These IDs are not from the production tokenizer.
  const scalars = '$� abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?—…-()[]\'"ɐɑɒæɔəɚɛɜɝɡɪɫŋɹɾʃʊʌʒθðçʍʔɲˈˌː̩̃\n'
  const vocabulary = Object.fromEntries([...new Set(scalars)].map((scalar, id) => [scalar, id]))
  const maximumTokenCount = 512
  const boundary = { SpecialToken: { id: '$', type_id: 0 } }
  const sequence = { Sequence: { id: 'A', type_id: 0 } }
  const tokenizer = new PreTrainedTokenizer({
    added_tokens: [],
    normalizer: null,
    pre_tokenizer: { type: 'Split', pattern: { Regex: '[\\s\\S]' }, behavior: 'Isolated', invert: false },
    model: { vocab: vocabulary },
    post_processor: { type: 'TemplateProcessing', single: [boundary, sequence, boundary] },
    decoder: null,
  }, { bos_token: '$', eos_token: '$', unk_token: '�', model_max_length: maximumTokenCount })
  return { tokenizer, vocabulary, boundaryID: vocabulary.$, unknownID: vocabulary['�'], maximumTokenCount }
}

// The Swift reader handles only this exact production tokenizer's semantics.
// New revisions must be reviewed for normalizer and pre-tokenizer changes.
const productionRevision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
const productionChecksums = {
  'tokenizer.json': '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
  'tokenizer_config.json': 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
  'config.json': 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
}

function productionTokenizer(directory) {
  const assets = Object.fromEntries(Object.entries(productionChecksums).map(([name, expected]) => {
    const bytes = readFileSync(join(directory, name))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${name}: SHA-256 for Kokoro ${productionRevision}`)
    return [name, JSON.parse(bytes)]
  }))
  const definition = assets['tokenizer.json']
  const configuration = assets['tokenizer_config.json']
  const vocabulary = definition.model.vocab
  const boundaryID = definition.post_processor.special_tokens.$.ids[0]
  // This revision's normalizer deletes every scalar outside the vocabulary, before its isolated splits.
  // Swift sees the original phonemes and does that filtering itself.
  return {
    tokenizer: new PreTrainedTokenizer(definition, configuration),
    vocabulary, boundaryID, unknownID: null, maximumTokenCount: configuration.model_max_length,
  }
}

export async function checkModelInputs({ modelSamples, directory, scratch, simulator, sdk, run, tokenizerDirectory }) {
  const { tokenizer, ...settings } = tokenizerDirectory ? productionTokenizer(tokenizerDirectory) : fixtureTokenizer()

  const supplied = ['', ' ˈhɛloʊ! ', 'n̩ æ̃ 🧪é', 'ɑ\nɡ', ...[509, 510, 511, 600].map(n => 'ə'.repeat(n))]
  const cases = [...modelSamples, ...voices.flatMap(({ voice }) => supplied.map(phonemes => ({
    phonemes, voice, speed: voice === 'af_heart' ? 0.75 : 1.25,
  })))]

  const voiceFolder = join(directory, '../../../node_modules/kokoro-js/voices')
  for (const { voice } of voices) {
    const size = readFileSync(join(voiceFolder, voice + '.bin')).length
    assert.equal(size, 510 * 256 * 4, 'Installed ' + voice + ' style size changed')
  }
  const received = []
  // Run original Kokoro's tensor construction and local voice loader. The stub
  // captures the inputs at the ONNX boundary without loading a model.
  const oracle = new KokoroTTS(async ({ input_ids: ids, style, speed }) => {
    assert.deepEqual(ids.dims, [1, ids.data.length])
    assert.deepEqual(style.dims, [1, 256])
    assert.deepEqual(speed.dims, [1])
    const styleBits = new Uint32Array(style.data.buffer, style.data.byteOffset, style.data.length)
    received.push({ ids: Array.from(ids.data, Number), styleBits: Array.from(styleBits), speed: speed.data[0] })
    return { waveform: { data: new Float32Array(0) } }
  }, tokenizer)
  for (const { english, phonemes, voice, speed } of cases) {
    if (english !== undefined) await oracle.generate(english, { voice, speed })
    else await oracle.generate_from_ids(tokenizer(phonemes, { truncation: true }).input_ids, { voice, speed })
  }

  const executable = join(scratch, 'KokoroInputProbe')
  const build = ['-module-cache-path', join(scratch, 'modules'), join(directory, 'KokoroInputProbe.swift'), '-o', executable]
  if (simulator) build.push('-target', 'arm64-apple-ios18.0-simulator', '-sdk', sdk)
  run('swiftc', build)
  const input = JSON.stringify({ ...settings, samples: cases })
  const output = simulator
    ? run('xcrun', ['simctl', 'spawn', simulator, executable, voiceFolder], input)
    : run(executable, [voiceFolder], input)
  const actual = JSON.parse(output)
  assert.equal(actual.length, cases.length)
  assert.equal(received.length, cases.length)
  for (let i = 0; i < cases.length; i++) {
    const { english, phonemes, voice } = cases[i]
    const label = voice + ': ' + (english ?? JSON.stringify(phonemes.slice(0, 40)) + ' (' + [...phonemes].length + ' scalars)')
    assert.deepEqual(actual[i].ids, received[i].ids, label + ': input IDs')
    assert.deepEqual(actual[i].styleBits, received[i].styleBits, label + ': voice style bits')
    assert.equal(actual[i].speed, received[i].speed, label + ': speed')
  }
  console.log((simulator ? 'iOS Simulator' : 'Mac') + ': ' + actual.length
    + (tokenizerDirectory ? ' production' : ' fixture')
    + ' token-ID and installed voice-style cases match original Kokoro. No ONNX inference ran.')
}
