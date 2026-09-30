#!/usr/bin/env node
// Builds BEREAN DEV for the Mac (config/app-identity.json → development): the Mac App Store
// configuration signed with Apple Development, as its own app — com.berean.app.dev, "Berean Dev",
// iCloud.com.berean.app.dev, berean-dev:// — so it can run from release/mas-dev-arm64 next to the
// installed Berean without sharing its sandbox, database, iCloud container or URL schemes
// (docs/mac-app-store.md §10). Run through `npm run build:mas:dev`, which compiles the JavaScript
// with BEREAN_IDENTITY=development first.
//
// electron-builder merges arrays by union (protocols, platform sections) and mas-dev always
// inherits the production `mas` section, so a dev build cannot be layered onto package.json
// without inheriting production URL schemes. This script writes the complete dev configuration
// instead and passes it with --config (package.json "build" is then not read).
//
// Stops before building when: the JavaScript was not compiled for development, or the development
// provisioning profile (build/embedded.berean-dev.provisionprofile, gitignored) is missing or does
// not authorise com.berean.app.dev with iCloud.com.berean.app.dev.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { profileAuthorises, readProfileValue } from './profileAuthorises.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const identities = JSON.parse(readFileSync(join(root, 'config/app-identity.json'), 'utf8'))
const DEV = identities.identities.development
const TEAM = identities.teamId
export const DEV_PROFILE = 'build/embedded.berean-dev.provisionprofile'
export const DEV_ENTITLEMENTS = 'build/entitlements.mas.dev.plist'

/** The complete electron-builder configuration for Berean Dev (pure; tested). */
export function devBuildConfig(base) {
  const config = structuredClone(base)
  config.appId = DEV.bundleId
  config.productName = DEV.appName
  config.protocols = [{ name: `${DEV.appName} deep link`, schemes: [DEV.urlScheme, DEV.pdfUrlScheme] }]
  config.mac = { ...config.mac, target: [{ target: 'mas-dev', arch: ['arm64'] }], hardenedRuntime: false }
  config.mas = { ...config.mas, entitlements: DEV_ENTITLEMENTS, provisioningProfile: DEV_PROFILE }
  config.masDev = { provisioningProfile: DEV_PROFILE }
  delete config.publish
  return config
}

/** Why the development profile cannot sign Berean Dev, or null. */
export function devProfileProblem(profilePath) {
  if (!existsSync(profilePath)) return `${profilePath} not found — create a macOS App Development profile for ${DEV.bundleId} (docs/mac-app-store.md §10)`
  const dir = mkdtempSync(join(tmpdir(), 'berean-devprofile-'))
  try {
    const pf = join(dir, 'p.plist')
    writeFileSync(pf, execFileSync('security', ['cms', '-D', '-i', profilePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    const key = (k) => `Entitlements.${k.replace(/\./g, '\\.')}`
    const appId = readProfileValue(pf, key('com.apple.application-identifier'))
    if (appId !== `${TEAM}.${DEV.bundleId}`) return `${profilePath} is for ${appId}, not ${TEAM}.${DEV.bundleId}`
    if (!readProfileValue(pf, 'ProvisionedDevices')) return `${profilePath} is not a development profile (no devices)`
    for (const k of ['com.apple.developer.icloud-container-identifiers', 'com.apple.developer.ubiquity-container-identifiers']) {
      if (!profileAuthorises(readProfileValue(pf, key(k)), [DEV.cloudContainer])) return `${profilePath} does not authorise ${k} = ${DEV.cloudContainer}`
    }
    if (!profileAuthorises(readProfileValue(pf, key('com.apple.developer.icloud-services')), ['CloudDocuments'])) return `${profilePath} does not authorise iCloud Documents`
    return null
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

function main() {
  const mainJs = join(root, 'out/main/index.js')
  const built = existsSync(mainJs) ? /BUILD_IDENTITY\s*=\s*"(production|development)"/.exec(readFileSync(mainJs, 'utf8'))?.[1] : undefined
  if (built !== 'development') {
    console.error(`build-mas-dev: out/ was built for ${built ?? 'nothing'} — run BEREAN_IDENTITY=development npm run build (npm run build:mas:dev does)`)
    process.exit(1)
  }
  const problem = devProfileProblem(join(root, DEV_PROFILE))
  if (problem) { console.error(`build-mas-dev: ${problem}`); process.exit(1) }

  const dir = mkdtempSync(join(tmpdir(), 'berean-mas-dev-'))
  const configFile = join(dir, 'electron-builder.berean-dev.json')
  writeFileSync(configFile, JSON.stringify(devBuildConfig(pkg.build), null, 1))
  // The Apple Development certificate is chosen automatically; a CSC_NAME meant for the
  // distribution build would select the wrong one.
  const env = { ...process.env }
  delete env.CSC_NAME
  const r = spawnSync('npx', ['electron-builder', '--mac', '--config', configFile, '--publish', 'never'], { cwd: root, env, stdio: 'inherit' })
  rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
  const v = spawnSync('node', [join(root, 'scripts/mac/verify-mas.mjs'), '--identity', 'development'], { cwd: root, stdio: 'inherit' })
  process.exit(v.status ?? 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
