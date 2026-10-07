#!/usr/bin/env node
/**
 * iOS setup preflight (fast, read-only). Run automatically by `npm run ios:sync`, `ios:open` and
 * scripts/ios/build.sh; also `npm run ios:check`.
 *
 * It catches the failure Xcode reports as
 *   Missing package product 'app_CapacitorApp' (… 'share_CapacitorShare', 'status-bar_CapacitorStatusBar' …)
 * which is a checkout-setup problem, never something to fix in the Xcode project:
 *   - node_modules missing → nothing to resolve;
 *   - a Capacitor plugin package missing (no Package.swift) → that product is missing;
 *   - a plugin package that resolves OUTSIDE this checkout (a git worktree whose node_modules is
 *     main's) → Xcode loads a local package in only one open workspace, so whichever of main /
 *     the worktree opened second shows every plugin product as missing, and `cap sync` rewrites
 *     the tracked Package.swift to the other checkout's paths.
 *
 *   node scripts/ios/check-setup.mjs            → node_modules + generated Package.swift
 *   node scripts/ios/check-setup.mjs --pre-sync → node_modules only (Package.swift is about to be regenerated)
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPAIR_WORKTREE = 'npm run setup:worktree   (then: npm run ios:sync)'
const REPAIR_MAIN = 'npm install   (then: npm run ios:sync)'

const inside = (child, parent) => child === parent || child.startsWith(parent + sep)

/** Capacitor packages that are NOT local Swift packages (CLI, JS core, the iOS runtime — the
 *  runtime comes from the remote capacitor-swift-pm package). */
const NOT_SWIFT_PACKAGES = new Set(['@capacitor/cli', '@capacitor/core', '@capacitor/ios'])

/** iOS Capacitor plugins this project depends on (package.json) — each is a local Swift package. */
export function iosPluginPackages(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => n.startsWith('@capacitor/') && !NOT_SWIFT_PACKAGES.has(n))
}

/** Local package paths referenced by the generated CapApp-SPM/Package.swift. */
export function packageSwiftLocalPaths(packageSwift) {
  return [...packageSwift.matchAll(/\.package\(name:\s*"([^"]+)",\s*path:\s*"([^"]+)"\)/g)].map((m) => ({ name: m[1], path: m[2] }))
}

/** Returns a list of problems (empty = ready). `worktree`: is this a linked git worktree. */
export function checkIosSetup(root, { preSync = false, worktree = false } = {}) {
  const problems = []
  const repair = worktree ? REPAIR_WORKTREE : REPAIR_MAIN
  const realRoot = realpathSync(root)
  if (!existsSync(join(root, 'node_modules'))) {
    return [`node_modules is missing. Repair: ${repair}`]
  }
  for (const name of iosPluginPackages(root)) {
    const dir = join(root, 'node_modules', name)
    if (!existsSync(join(dir, 'Package.swift'))) { problems.push(`${name} is not installed (no Package.swift). Repair: ${repair}`); continue }
    const real = realpathSync(dir)
    if (!inside(real, realRoot)) problems.push(`${name} resolves to ${real}, outside this checkout — Xcode can open that package in only one workspace ("Missing package product"). Repair: ${repair}`)
  }
  if (preSync) return problems
  const spm = join(root, 'ios/App/CapApp-SPM/Package.swift')
  if (!existsSync(spm)) return [...problems, `ios/App/CapApp-SPM/Package.swift is missing. Repair: npm run ios:sync`]
  for (const { name, path } of packageSwiftLocalPaths(readFileSync(spm, 'utf8'))) {
    const abs = resolve(dirname(spm), path)
    if (!existsSync(join(abs, 'Package.swift'))) { problems.push(`Package.swift → ${name} at ${path} does not exist. Repair: ${worktree ? REPAIR_WORKTREE : 'npm run ios:sync'}`); continue }
    const real = realpathSync(abs)
    if (!inside(real, realRoot)) problems.push(`Package.swift → ${name} points outside this checkout (${relative(realRoot, real)}). Repair: ${worktree ? REPAIR_WORKTREE : 'npm run ios:sync'}`)
  }
  return problems
}

function isLinkedWorktree(root) {
  // A linked worktree's .git is a FILE ("gitdir: …/.git/worktrees/<name>").
  try { return readFileSync(join(root, '.git'), 'utf8').startsWith('gitdir:') } catch { return false }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const worktree = isLinkedWorktree(root)
  const problems = checkIosSetup(root, { preSync: process.argv.includes('--pre-sync'), worktree })
  if (problems.length) {
    console.error(`✗ iOS setup is incomplete${worktree ? ' (git worktree)' : ''}:`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('This is a checkout-setup problem — never edit App.xcodeproj or Package.swift by hand.')
    process.exit(1)
  }
  console.log(`✓ iOS setup: node_modules + ${iosPluginPackages(root).length} Capacitor plugin packages local to this checkout`)
}
