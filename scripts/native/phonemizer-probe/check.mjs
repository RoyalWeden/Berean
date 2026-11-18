import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { phonemize } from 'phonemizer'

const directory = dirname(fileURLToPath(import.meta.url))
const simulator = process.argv[2] === '--simulator' ? process.argv[3] : undefined
if (process.argv.length > 2 && (!simulator || !/^[0-9a-f-]{36}$/i.test(simulator) || process.argv.length !== 4)) {
  throw new Error('Usage: node check.mjs [--simulator <booted-simulator-UUID>]')
}
const scratch = mkdtempSync(join(tmpdir(), 'berean-phonemizer-check-'))
function run(command, args, input) {
  const result = spawnSync(command, args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.signal}):\n${result.stderr}\n${result.stdout}`)
  }
  return result.stdout
}
// Synthetic/public text only. No library, credentials, model weights or voice pack are read.
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
]
try {
  const build = ['build', '-c', 'release', '--package-path', directory, '--scratch-path', join(scratch, 'build')]
  if (simulator) {
    const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']).trim()
    build.push('--triple', 'arm64-apple-ios18.0-simulator', '--sdk', sdk)
  }
  run('swift', build)
  const bin = run('swift', [...build, '--show-bin-path']).trim()
  const executable = join(bin, 'Probe')
  const invoke = (args, input) => simulator
    ? run('xcrun', ['simctl', 'spawn', simulator, executable, ...args], input)
    : run(executable, args, input)
  const data = join(scratch, 'data')
  invoke(['compile', data])
  invoke(['dictionary', data])
  for (const voice of ['en-us', 'en']) {
    const actual = JSON.parse(invoke(['phonemize', data, voice], JSON.stringify(samples)))
    for (let i = 0; i < samples.length; i++) {
      assert.deepEqual(actual[i], await phonemize(samples[i], voice), `${voice}: ${samples[i]}`)
    }
  }
  console.log(`${simulator ? 'iOS Simulator' : 'Mac'} US/British phonemes match original phonemizer for ${samples.length * 2} cases. No audio synthesized.`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
