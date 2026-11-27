import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { phonemize } from 'phonemizer'
import { checkModelInputs, voices } from './check-inputs.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
// Compare the full pipeline to the exact original implementation. This test-only
// extraction injects the installed phonemizer and never loads the ONNX model.
const source = readFileSync(join(directory, '../../../node_modules/kokoro-js/dist/kokoro.js'), 'utf8')
const start = source.indexOf('function o('), end = source.indexOf('function p(', start)
if (start < 0 || end < 0 || !source.slice(start, end).includes('async function m(')) {
  throw new Error('Original Kokoro English oracle boundaries changed')
}
const originalKokoro = new Function('l', source.slice(start, end) + ';return m;')(phonemize)
let simulator, compiledResources = false, inputsOnly = false
const args = process.argv.slice(2)
while (args.length) {
  const option = args.shift()
  if (option === '--simulator' && /^[0-9a-f-]{36}$/i.test(args[0] ?? '')) simulator = args.shift()
  else if (option === '--compiled-resources') compiledResources = true
  else if (option === '--inputs-only') inputsOnly = true
  else {
    console.error('Usage: node check.mjs [--simulator <booted-simulator-UUID>] [--compiled-resources | --inputs-only]')
    process.exit(2)
  }
}
if (compiledResources && inputsOnly) throw new Error('--compiled-resources requires the phonemizer checks')
const scratch = mkdtempSync(join(tmpdir(), 'berean-phonemizer-check-'))
function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.signal}):\n${result.stderr}\n${result.stdout}`)
  }
  return result.stdout
}

function originalResources(destination) {
  // Research only: recover the exact original English data from its installed
  // Emscripten bundle. Do not replace original voice data with newly compiled
  // upstream tables and assume that matching the first few phrases is enough.
  const source = readFileSync(join(directory, '../../../node_modules/phonemizer/dist/phonemizer.js'), 'utf8')
  const payload = source.match(/"(H4sI[A-Za-z0-9+/=]+)"/)
  const descriptor = source.match(/\{files:\[.*?\],remote_package_size:\d+\}/)
  assert.ok(payload && descriptor, 'Original phonemizer resource format changed')
  const root = '/usr/share/espeak-ng-data'
  const manifest = new Function('e', 'C', 'a', `return (${descriptor[0]});`)(root, `${root}/lang`, `${root}/voices`)
  const data = gunzipSync(Buffer.from(payload[1], 'base64'))
  assert.equal(data.length, manifest.remote_package_size)
  for (const file of manifest.files) {
    assert.ok(file.filename.startsWith(`${root}/`) && !file.filename.split('/').includes('..'))
    assert.ok(Number.isInteger(file.start) && Number.isInteger(file.end)
      && file.start >= 0 && file.end >= file.start && file.end <= data.length)
    const path = join(destination, 'espeak-ng-data', file.filename.slice(root.length + 1))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data.subarray(file.start, file.end))
  }
}
// Synthetic/public text only. No library, credentials or model weights are read.
const samples = [
  'In the beginning God created the heaven and the earth.',
  'Yehovuh said unto Yeshuwa.',
  'seven hundred and forty-two',
  'I am the way, the truth, and the life.',
  'Blessed are the meek: for they shall inherit the earth.',
  'Faith, hope, and charity; these three.',
  'First sentence. Second sentence! Third sentence?',
  'Peace—be still.',
  'ninety-nine, one hundred, one thousand.',
  'the Word was with God, and the Word was God.',
  'righteousness, mercy, judgment, Jerusalem, Bethlehem',
  'forty days and forty nights',
  'Let there be light.',
  'Alpha and Omega; the beginning and the ending.',
  'A question? An answer! A pause… another clause.',
  '  leading and doubled  spaces  ',
  'Dr. Smith met Mr. Jones.',
  'etc. then etc. Then ETC. next',
  'In 1905 and 2026, at 1:05 and 12:00.',
  '$1.01 and £2.50; 10-20 and 3.14.',
  '$3 MILLION and £4 HUNDRED',
  '(First) [second] {third}; “fourth”.',
  'one\n   \ntwo',
  'yeah, Yeah; yea YEAH!',
  'one   two   three',
  'word z\n',
]
async function checkPhonemes(sdk) {
  const build = ['build', '-c', 'release', '--package-path', directory, '--scratch-path', join(scratch, 'build')]
  if (simulator) build.push('--triple', 'arm64-apple-ios18.0-simulator', '--sdk', sdk)
  run('swift', build)
  const bin = run('swift', [...build, '--show-bin-path']).trim()
  const executable = join(bin, 'Probe')
  const invoke = (args, input) => simulator
    ? run('xcrun', ['simctl', 'spawn', simulator, executable, ...args], input)
    : run(executable, args, input)
  const data = join(scratch, 'data')
  if (compiledResources) {
    invoke(['compile', data])
    invoke(['dictionary', data])
  } else {
    originalResources(data)
  }
  const modelSamples = []
  const differences = []
  let rawDifferences = 0, preparedDifferences = 0
  for (const { accent, language, voice } of voices) {
    const actual = JSON.parse(invoke(['phonemize', data, accent], JSON.stringify(samples)))
    for (let i = 0; i < samples.length; i++) {
      try {
        assert.deepEqual(actual[i], await phonemize(samples[i], accent), accent + ': ' + samples[i])
      } catch (error) {
        rawDifferences++
        differences.push(error.message)
      }
    }
    const prepared = JSON.parse(invoke(['kokoro', data, accent], JSON.stringify(samples)))
    for (let i = 0; i < samples.length; i++) {
      try {
        const english = samples[i]
        assert.equal(prepared[i], await originalKokoro(english, language), 'Kokoro ' + accent + ': ' + english)
        modelSamples.push({ english, phonemes: prepared[i], voice, speed: 1 })
      } catch (error) {
        preparedDifferences++
        differences.push(error.message)
      }
    }
  }
  assert.equal(differences.length, 0,
    `${rawDifferences} raw / ${preparedDifferences} complete Kokoro mismatches:\n${differences.join('\n\n')}`)
  console.log(`${simulator ? 'iOS Simulator' : 'Mac'}: ${samples.length * 2} raw and ${samples.length * 2} complete Kokoro English cases match the original. No audio played or Kokoro model loaded.`)
  return modelSamples
}

async function originalModelSamples() {
  const modelSamples = []
  for (const { language, voice } of voices) {
    for (const english of samples) {
      modelSamples.push({ english, phonemes: await originalKokoro(english, language), voice, speed: 1 })
    }
  }
  return modelSamples
}

try {
  const sdk = simulator ? run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']).trim() : null
  const modelSamples = inputsOnly ? await originalModelSamples() : await checkPhonemes(sdk)
  await checkModelInputs({ modelSamples, directory, scratch, simulator, sdk, run })
} catch (error) {
  // Emscripten's uncaught-error handler otherwise prints its entire minified
  // module (including embedded resources) before the useful comparison failure.
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
