#!/usr/bin/env node
/**
 * Idempotently wires Berean's additions into the Capacitor-generated Xcode project
 * (ios/App/App.xcodeproj/project.pbxproj). `cap add ios` produces a stock project; this script
 * adds what Berean needs and can be re-run any time (each edit checks for its own marker first):
 *
 *  1. the local Swift package ios/App/BereanNative (Berean's Capacitor plugins) as a package
 *     dependency of the App target;
 *  2. App/BereanBridgeViewController.swift in the App target's sources;
 *  3. BereanDebug/BereanRelease.xcconfig as the App target's base configurations (they pull in
 *     Capacitor's debug.xcconfig, Version.xcconfig and the developer's gitignored Signing.xcconfig);
 *  4. target-level settings that must come from the xcconfigs instead of being hard-coded
 *     (bundle id, team, deployment target, version numbers, device family);
 *  5. a "Copy Bundled Databases" run-script build phase (scripts/ios/copy-data.sh).
 *
 * Run: node scripts/ios/patch-xcodeproj.mjs   (also invoked by `npm run ios:sync`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PBX = resolve(process.cwd(), 'ios/App/App.xcodeproj/project.pbxproj')
let s = readFileSync(PBX, 'utf8')
const before = s

// Fixed 24-hex object ids (Xcode only needs uniqueness within the file).
const ID = {
  pkgRef: 'BE4EA00000000000000000A1',
  productDep: 'BE4EA00000000000000000A2',
  frameworksBuildFile: 'BE4EA00000000000000000A3',
  bridgeFileRef: 'BE4EA00000000000000000B1',
  bridgeBuildFile: 'BE4EA00000000000000000B2',
  debugXcconfig: 'BE4EA00000000000000000C1',
  releaseXcconfig: 'BE4EA00000000000000000C2',
  copyDataPhase: 'BE4EA00000000000000000D1',
}
const TARGET_ID = '504EC3031FED79650016851F'
const APP_GROUP_ID = '504EC3061FED79650016851F'
const ROOT_GROUP_ID = '504EC2FB1FED79650016851F'
const SOURCES_PHASE_ID = '504EC3001FED79650016851F'
const FRAMEWORKS_PHASE_ID = '504EC3011FED79650016851F'
const RESOURCES_PHASE_ID = '504EC3021FED79650016851F'

function insertAfter(marker, text) {
  const i = s.indexOf(marker)
  if (i < 0) throw new Error(`marker not found: ${marker}`)
  const j = i + marker.length
  s = s.slice(0, j) + text + s.slice(j)
}
function replaceOnce(from, to) {
  if (!s.includes(from)) throw new Error(`text not found: ${from}`)
  s = s.replace(from, to)
}

// 1. BereanNative local package ---------------------------------------------------------------
if (!s.includes(ID.pkgRef)) {
  insertAfter('/* Begin XCLocalSwiftPackageReference section */\n',
    `\t\t${ID.pkgRef} /* XCLocalSwiftPackageReference "BereanNative" */ = {\n\t\t\tisa = XCLocalSwiftPackageReference;\n\t\t\trelativePath = BereanNative;\n\t\t};\n`)
  insertAfter('/* Begin XCSwiftPackageProductDependency section */\n',
    `\t\t${ID.productDep} /* BereanNative */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = ${ID.pkgRef} /* XCLocalSwiftPackageReference "BereanNative" */;\n\t\t\tproductName = BereanNative;\n\t\t};\n`)
  insertAfter('/* Begin PBXBuildFile section */\n',
    `\t\t${ID.frameworksBuildFile} /* BereanNative in Frameworks */ = {isa = PBXBuildFile; productRef = ${ID.productDep} /* BereanNative */; };\n`)
  // project packageReferences
  replaceOnce('\t\t\tpackageReferences = (\n', `\t\t\tpackageReferences = (\n\t\t\t\t${ID.pkgRef} /* XCLocalSwiftPackageReference "BereanNative" */,\n`)
  // target packageProductDependencies
  replaceOnce('\t\t\tpackageProductDependencies = (\n', `\t\t\tpackageProductDependencies = (\n\t\t\t\t${ID.productDep} /* BereanNative */,\n`)
  // frameworks phase files
  const fw = s.indexOf(`${FRAMEWORKS_PHASE_ID} /* Frameworks */ = {`)
  const filesIdx = s.indexOf('files = (\n', fw)
  s = s.slice(0, filesIdx + 'files = (\n'.length) + `\t\t\t\t${ID.frameworksBuildFile} /* BereanNative in Frameworks */,\n` + s.slice(filesIdx + 'files = (\n'.length)
}

// 2. BereanBridgeViewController.swift ----------------------------------------------------------
if (!s.includes(ID.bridgeFileRef)) {
  insertAfter('/* Begin PBXFileReference section */\n',
    `\t\t${ID.bridgeFileRef} /* BereanBridgeViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BereanBridgeViewController.swift; sourceTree = "<group>"; };\n`)
  insertAfter('/* Begin PBXBuildFile section */\n',
    `\t\t${ID.bridgeBuildFile} /* BereanBridgeViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ID.bridgeFileRef} /* BereanBridgeViewController.swift */; };\n`)
  const grp = s.indexOf(`${APP_GROUP_ID} /* App */ = {`)
  const ch = s.indexOf('children = (\n', grp)
  s = s.slice(0, ch + 'children = (\n'.length) + `\t\t\t\t${ID.bridgeFileRef} /* BereanBridgeViewController.swift */,\n` + s.slice(ch + 'children = (\n'.length)
  const src = s.indexOf(`${SOURCES_PHASE_ID} /* Sources */ = {`)
  const f = s.indexOf('files = (\n', src)
  s = s.slice(0, f + 'files = (\n'.length) + `\t\t\t\t${ID.bridgeBuildFile} /* BereanBridgeViewController.swift in Sources */,\n` + s.slice(f + 'files = (\n'.length)
}

// 3. xcconfig base configurations --------------------------------------------------------------
if (!s.includes(ID.debugXcconfig)) {
  insertAfter('/* Begin PBXFileReference section */\n',
    `\t\t${ID.debugXcconfig} /* BereanDebug.xcconfig */ = {isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = BereanDebug.xcconfig; sourceTree = "<group>"; };\n` +
    `\t\t${ID.releaseXcconfig} /* BereanRelease.xcconfig */ = {isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = BereanRelease.xcconfig; sourceTree = "<group>"; };\n`)
  const root = s.indexOf(`${ROOT_GROUP_ID} = {`)
  const ch = s.indexOf('children = (\n', root)
  s = s.slice(0, ch + 'children = (\n'.length) + `\t\t\t\t${ID.debugXcconfig} /* BereanDebug.xcconfig */,\n\t\t\t\t${ID.releaseXcconfig} /* BereanRelease.xcconfig */,\n` + s.slice(ch + 'children = (\n'.length)
  // Target Debug config: swap debug.xcconfig → BereanDebug.xcconfig (which includes it)
  replaceOnce('\t\t504EC3171FED79650016851F /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbaseConfigurationReference = 958DCC722DB07C7200EA8C5F /* debug.xcconfig */;',
    `\t\t504EC3171FED79650016851F /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbaseConfigurationReference = ${ID.debugXcconfig} /* BereanDebug.xcconfig */;`)
  replaceOnce('\t\t504EC3181FED79650016851F /* Release */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {',
    `\t\t504EC3181FED79650016851F /* Release */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbaseConfigurationReference = ${ID.releaseXcconfig} /* BereanRelease.xcconfig */;\n\t\t\tbuildSettings = {`)
}

// 4. settings that must flow from the xcconfigs --------------------------------------------------
// (target-level values override xcconfig values, so the hard-coded ones are removed/redirected)
s = s.replace(/\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com\.berean\.app;\n/g, '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "$(BEREAN_BUNDLE_ID)";\n\t\t\t\tDEVELOPMENT_TEAM = "$(BEREAN_TEAM_ID)";\n')
s = s.replace(/\t\t\t\tMARKETING_VERSION = 1\.0;\n/g, '')
s = s.replace(/\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n/g, '')
s = s.replace(/\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";\n/g, '')
s = s.replace(/IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 17.0;')
// `armv7` is meaningless for a 17.0+ arm64-only app and makes App Store Connect complain
s = s.replace(/\t\t\t\tSWIFT_VERSION = 5\.0;\n/g, '')

// 5. Copy Bundled Databases run-script phase ------------------------------------------------------
if (!s.includes(ID.copyDataPhase)) {
  const phase = `\t\t${ID.copyDataPhase} /* Copy Bundled Databases */ = {\n\t\t\tisa = PBXShellScriptBuildPhase;\n\t\t\talwaysOutOfDate = 1;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\tinputPaths = (\n\t\t\t);\n\t\t\tname = "Copy Bundled Databases";\n\t\t\toutputPaths = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t\tshellPath = /bin/bash;\n\t\t\tshellScript = "\\"$SRCROOT/../../scripts/ios/copy-data.sh\\"\\n";\n\t\t};\n`
  if (s.includes('/* Begin PBXShellScriptBuildPhase section */')) {
    insertAfter('/* Begin PBXShellScriptBuildPhase section */\n', phase)
  } else {
    replaceOnce('/* Begin PBXSourcesBuildPhase section */', `/* Begin PBXShellScriptBuildPhase section */\n${phase}/* End PBXShellScriptBuildPhase section */\n\n/* Begin PBXSourcesBuildPhase section */`)
  }
  replaceOnce(`\t\t\t\t${RESOURCES_PHASE_ID} /* Resources */,\n`, `\t\t\t\t${RESOURCES_PHASE_ID} /* Resources */,\n\t\t\t\t${ID.copyDataPhase} /* Copy Bundled Databases */,\n`)
}

if (s !== before) {
  writeFileSync(PBX, s)
  console.log('[ios] project.pbxproj patched')
} else {
  console.log('[ios] project.pbxproj already up to date')
}
