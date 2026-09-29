#!/usr/bin/env node
// Builds the Mac App Store iCloud helper (native/mac-icloud/berean_icloud.m) into
// build/native/berean_icloud.node. Node-API is ABI-stable, so the addon is compiled against the
// local Node's headers with clang and loads in Electron unchanged. Only the MAS build ships it
// (package.json → build.mas.extraResources); the DMG build never loads it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('build-native: not macOS — skipped')
  process.exit(0)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const src = join(root, 'native/mac-icloud/berean_icloud.m')
const outDir = join(root, 'build/native')
const out = join(outDir, 'berean_icloud.node')

const candidates = [
  join(dirname(dirname(process.execPath)), 'include/node'),
  join(root, 'node_modules/node-api-headers/include'),
]
const include = candidates.find((d) => existsSync(join(d, 'node_api.h')))
if (!include) {
  console.error(`build-native: node_api.h not found in ${candidates.join(', ')}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
execFileSync('xcrun', [
  'clang', '-ObjC', '-fobjc-arc', '-O2', '-Wall', '-Werror',
  '-arch', 'arm64', '-mmacosx-version-min=12.0',
  '-DNAPI_VERSION=8', `-I${include}`,
  '-bundle', '-undefined', 'dynamic_lookup',
  '-framework', 'Foundation',
  '-o', out, src,
], { stdio: 'inherit' })
console.log(`build-native: ${out}`)
