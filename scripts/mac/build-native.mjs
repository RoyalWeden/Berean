#!/usr/bin/env node
// Builds Berean's two small macOS Node-API modules into build/native/:
//   berean_icloud.node — the Mac App Store iCloud helper (native/mac-icloud). Only the MAS build
//                        ships it (package.json → build.mas.extraResources).
//   berean_glass.node  — the Liquid Glass bridge (native/mac-liquid-glass): NSGlassEffectView /
//                        NSGlassEffectContainerView, NSVisualEffectView before macOS 26. Shipped by
//                        every Mac build; the app runs unchanged (CSS materials) without it.
// Node-API is ABI-stable, so each addon is compiled against the local Node's headers with clang
// and loads in Electron unchanged. Usage: node scripts/mac/build-native.mjs [icloud|glass]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('build-native: not macOS — skipped')
  process.exit(0)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = join(root, 'build/native')

const candidates = [
  join(dirname(dirname(process.execPath)), 'include/node'),
  join(root, 'node_modules/node-api-headers/include'),
]
const include = candidates.find((d) => existsSync(join(d, 'node_api.h')))
if (!include) {
  console.error(`build-native: node_api.h not found in ${candidates.join(', ')}`)
  process.exit(1)
}

const MODULES = {
  icloud: { src: 'native/mac-icloud/berean_icloud.m', out: 'berean_icloud.node', frameworks: ['Foundation'], arch: ['arm64'] },
  // Built against the macOS 26+ SDK (NSGlassEffectView) but deployable to macOS 12: every glass
  // class is looked up at runtime (NSClassFromString), never linked.
  // Universal (arm64 + x86_64) so the Intel build (build:mac:x64) ships it too.
  glass: { src: 'native/mac-liquid-glass/berean_glass.m', out: 'berean_glass.node', frameworks: ['Foundation', 'AppKit'], arch: ['arm64', 'x86_64'] },
}
const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(MODULES)

mkdirSync(outDir, { recursive: true })
for (const name of wanted) {
  const m = MODULES[name]
  if (!m) { console.error(`build-native: unknown module ${name}`); process.exit(1) }
  const out = join(outDir, m.out)
  execFileSync('xcrun', [
    'clang', '-ObjC', '-fobjc-arc', '-O2', '-Wall', '-Werror',
    ...m.arch.flatMap((a) => ['-arch', a]), '-mmacosx-version-min=12.0',
    '-DNAPI_VERSION=8', `-I${include}`,
    '-bundle', '-undefined', 'dynamic_lookup',
    ...m.frameworks.flatMap((f) => ['-framework', f]),
    '-o', out, join(root, m.src),
  ], { stdio: 'inherit' })
  console.log(`build-native: ${out}`)
}
