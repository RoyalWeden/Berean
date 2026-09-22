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
 *  5. a "Copy Bundled Databases" run-script build phase (scripts/ios/copy-data.sh);
 *  6. a "Finalize Info.plist" run-script build phase (scripts/ios/finalize-info-plist.sh) that keys
 *     NSUbiquitousContainers by the BEREAN_ICLOUD_CONTAINER build setting;
 *  7. App/BereanIntents.swift (App Intents) in the App target;
 *  8. the ShareExtension target (ios/App/ShareExtension) embedded in the App target.
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
  finalizePlistPhase: 'BE4EA00000000000000000D2',
  intentsFileRef: 'BE4EA00000000000000000E1',
  intentsBuildFile: 'BE4EA00000000000000000E2',
  // Share Extension target (step 8)
  shareTarget: 'BE4EA00000000000000000F1',
  shareProduct: 'BE4EA00000000000000000F2',
  shareGroup: 'BE4EA00000000000000000F3',
  shareSrcRef: 'BE4EA00000000000000000F4',
  shareSrcBuild: 'BE4EA00000000000000000F5',
  sharePlistRef: 'BE4EA00000000000000000F6',
  shareEntRef: 'BE4EA00000000000000000F7',
  shareSourcesPhase: 'BE4EA00000000000000000F8',
  shareFrameworksPhase: 'BE4EA00000000000000000F9',
  shareResourcesPhase: 'BE4EA0000000000000000F10',
  shareConfigList: 'BE4EA0000000000000000F11',
  shareDebugConfig: 'BE4EA0000000000000000F12',
  shareReleaseConfig: 'BE4EA0000000000000000F13',
  shareEmbedPhase: 'BE4EA0000000000000000F14',
  shareEmbedBuildFile: 'BE4EA0000000000000000F15',
  shareDependency: 'BE4EA0000000000000000F16',
  shareContainerProxy: 'BE4EA0000000000000000F17',
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

// 6. Finalize Info.plist run-script phase (after Copy Bundled Databases) --------------------------
if (!s.includes(ID.finalizePlistPhase)) {
  // Declaring the built Info.plist as an input makes Xcode's build system run this phase AFTER
  // ProcessInfoPlistFile (which otherwise runs last and would overwrite the edit).
  const phase = `\t\t${ID.finalizePlistPhase} /* Finalize Info.plist */ = {\n\t\t\tisa = PBXShellScriptBuildPhase;\n\t\t\talwaysOutOfDate = 1;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\tinputPaths = (\n\t\t\t\t"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)",\n\t\t\t);\n\t\t\tname = "Finalize Info.plist";\n\t\t\toutputPaths = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t\tshellPath = /bin/bash;\n\t\t\tshellScript = "\\"$SRCROOT/../../scripts/ios/finalize-info-plist.sh\\"\\n";\n\t\t};\n`
  insertAfter('/* Begin PBXShellScriptBuildPhase section */\n', phase)
  replaceOnce(`\t\t\t\t${ID.copyDataPhase} /* Copy Bundled Databases */,\n`, `\t\t\t\t${ID.copyDataPhase} /* Copy Bundled Databases */,\n\t\t\t\t${ID.finalizePlistPhase} /* Finalize Info.plist */,\n`)
}

// 7. App/BereanIntents.swift (App Intents / Shortcuts; must live in the app target, not the package) --
if (!s.includes(ID.intentsFileRef)) {
  insertAfter('/* Begin PBXFileReference section */\n',
    `\t\t${ID.intentsFileRef} /* BereanIntents.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BereanIntents.swift; sourceTree = "<group>"; };\n`)
  insertAfter('/* Begin PBXBuildFile section */\n',
    `\t\t${ID.intentsBuildFile} /* BereanIntents.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ID.intentsFileRef} /* BereanIntents.swift */; };\n`)
  const grp = s.indexOf(`${APP_GROUP_ID} /* App */ = {`)
  const ch = s.indexOf('children = (\n', grp)
  s = s.slice(0, ch + 'children = (\n'.length) + `\t\t\t\t${ID.intentsFileRef} /* BereanIntents.swift */,\n` + s.slice(ch + 'children = (\n'.length)
  const src = s.indexOf(`${SOURCES_PHASE_ID} /* Sources */ = {`)
  const f = s.indexOf('files = (\n', src)
  s = s.slice(0, f + 'files = (\n'.length) + `\t\t\t\t${ID.intentsBuildFile} /* BereanIntents.swift in Sources */,\n` + s.slice(f + 'files = (\n'.length)
}

// 8. Share Extension target ------------------------------------------------------------------------
if (!s.includes(ID.shareTarget)) {
  const PROJECT_ID = '504EC2FC1FED79650016851F'
  const PRODUCTS_GROUP_ID = '504EC3051FED79650016851F'
  // The extension inherits BEREAN_* ids, deployment target, device family, Swift version and the
  // marketing/build versions from the same xcconfigs as the App target.
  const cfg = (id, name, extra) => `\t\t${id} /* ${name} */ = {\n\t\t\tisa = XCBuildConfiguration;\n` +
    `\t\t\tbaseConfigurationReference = ${name === 'Debug' ? ID.debugXcconfig : ID.releaseXcconfig} /* Berean${name}.xcconfig */;\n\t\t\tbuildSettings = {\n` +
    `\t\t\t\tCODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExtension.entitlements;\n\t\t\t\tCODE_SIGN_STYLE = Automatic;\n` +
    `\t\t\t\tDEVELOPMENT_TEAM = "$(BEREAN_TEAM_ID)";\n` +
    `\t\t\t\tGENERATE_INFOPLIST_FILE = NO;\n\t\t\t\tINFOPLIST_FILE = ShareExtension/Info.plist;\n` +
    `\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"@executable_path/Frameworks",\n\t\t\t\t\t"@executable_path/../../Frameworks",\n\t\t\t\t);\n` +
    `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "$(BEREAN_BUNDLE_ID).share";\n\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";\n` +
    `\t\t\t\tSKIP_INSTALL = YES;\n${extra}\t\t\t};\n\t\t\tname = ${name};\n\t\t};\n`
  // file references + group
  insertAfter('/* Begin PBXFileReference section */\n',
    `\t\t${ID.shareProduct} /* ShareExtension.appex */ = {isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = ShareExtension.appex; sourceTree = BUILT_PRODUCTS_DIR; };\n` +
    `\t\t${ID.shareSrcRef} /* ShareViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ShareViewController.swift; sourceTree = "<group>"; };\n` +
    `\t\t${ID.sharePlistRef} /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };\n` +
    `\t\t${ID.shareEntRef} /* ShareExtension.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = ShareExtension.entitlements; sourceTree = "<group>"; };\n`)
  insertAfter('/* Begin PBXBuildFile section */\n',
    `\t\t${ID.shareSrcBuild} /* ShareViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${ID.shareSrcRef} /* ShareViewController.swift */; };\n` +
    `\t\t${ID.shareEmbedBuildFile} /* ShareExtension.appex in Embed Foundation Extensions */ = {isa = PBXBuildFile; fileRef = ${ID.shareProduct} /* ShareExtension.appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };\n`)
  insertAfter('/* Begin PBXGroup section */\n',
    `\t\t${ID.shareGroup} /* ShareExtension */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t${ID.shareSrcRef} /* ShareViewController.swift */,\n\t\t\t\t${ID.sharePlistRef} /* Info.plist */,\n\t\t\t\t${ID.shareEntRef} /* ShareExtension.entitlements */,\n\t\t\t);\n\t\t\tpath = ShareExtension;\n\t\t\tsourceTree = "<group>";\n\t\t};\n`)
  // root group child + product
  {
    const root = s.indexOf(`${ROOT_GROUP_ID} = {`)
    const ch = s.indexOf('children = (\n', root)
    s = s.slice(0, ch + 'children = (\n'.length) + `\t\t\t\t${ID.shareGroup} /* ShareExtension */,\n` + s.slice(ch + 'children = (\n'.length)
    const prod = s.indexOf(`${PRODUCTS_GROUP_ID} /* Products */ = {`)
    const pch = s.indexOf('children = (\n', prod)
    s = s.slice(0, pch + 'children = (\n'.length) + `\t\t\t\t${ID.shareProduct} /* ShareExtension.appex */,\n` + s.slice(pch + 'children = (\n'.length)
  }
  // build phases
  insertAfter('/* Begin PBXSourcesBuildPhase section */\n',
    `\t\t${ID.shareSourcesPhase} /* Sources */ = {\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t${ID.shareSrcBuild} /* ShareViewController.swift in Sources */,\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`)
  insertAfter('/* Begin PBXFrameworksBuildPhase section */\n',
    `\t\t${ID.shareFrameworksPhase} /* Frameworks */ = {\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`)
  insertAfter('/* Begin PBXResourcesBuildPhase section */\n',
    `\t\t${ID.shareResourcesPhase} /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`)
  // configurations
  insertAfter('/* Begin XCBuildConfiguration section */\n',
    cfg(ID.shareDebugConfig, 'Debug', '\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;\n\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";\n') +
    cfg(ID.shareReleaseConfig, 'Release', '\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-O";\n'))
  insertAfter('/* Begin XCConfigurationList section */\n',
    `\t\t${ID.shareConfigList} /* Build configuration list for PBXNativeTarget "ShareExtension" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t${ID.shareDebugConfig} /* Debug */,\n\t\t\t\t${ID.shareReleaseConfig} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};\n`)
  // the target
  insertAfter('/* Begin PBXNativeTarget section */\n',
    `\t\t${ID.shareTarget} /* ShareExtension */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = ${ID.shareConfigList} /* Build configuration list for PBXNativeTarget "ShareExtension" */;\n` +
    `\t\t\tbuildPhases = (\n\t\t\t\t${ID.shareSourcesPhase} /* Sources */,\n\t\t\t\t${ID.shareFrameworksPhase} /* Frameworks */,\n\t\t\t\t${ID.shareResourcesPhase} /* Resources */,\n\t\t\t);\n` +
    `\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = ShareExtension;\n\t\t\tproductName = ShareExtension;\n` +
    `\t\t\tproductReference = ${ID.shareProduct} /* ShareExtension.appex */;\n\t\t\tproductType = "com.apple.product-type.app-extension";\n\t\t};\n`)
  // project: targets + attributes
  replaceOnce('\t\t\ttargets = (\n\t\t\t\t504EC3031FED79650016851F /* App */,\n', `\t\t\ttargets = (\n\t\t\t\t504EC3031FED79650016851F /* App */,\n\t\t\t\t${ID.shareTarget} /* ShareExtension */,\n`)
  replaceOnce('\t\t\t\tTargetAttributes = {\n', `\t\t\t\tTargetAttributes = {\n\t\t\t\t\t${ID.shareTarget} = {\n\t\t\t\t\t\tCreatedOnToolsVersion = 26.0;\n\t\t\t\t\t\tProvisioningStyle = Automatic;\n\t\t\t\t\t};\n`)
  // app target: dependency + embed phase
  s = s.replace('/* Begin PBXNativeTarget section */', `/* Begin PBXContainerItemProxy section */\n\t\t${ID.shareContainerProxy} /* PBXContainerItemProxy */ = {\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = ${PROJECT_ID} /* Project object */;\n\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = ${ID.shareTarget};\n\t\t\tremoteInfo = ShareExtension;\n\t\t};\n/* End PBXContainerItemProxy section */\n\n/* Begin PBXCopyFilesBuildPhase section */\n\t\t${ID.shareEmbedPhase} /* Embed Foundation Extensions */ = {\n\t\t\tisa = PBXCopyFilesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tdstPath = "";\n\t\t\tdstSubfolderSpec = 13;\n\t\t\tfiles = (\n\t\t\t\t${ID.shareEmbedBuildFile} /* ShareExtension.appex in Embed Foundation Extensions */,\n\t\t\t);\n\t\t\tname = "Embed Foundation Extensions";\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n/* End PBXCopyFilesBuildPhase section */\n\n/* Begin PBXNativeTarget section */`)
  s = s.replace('/* Begin PBXTargetDependency section */', '/* Begin PBXTargetDependency section */')
  if (!s.includes('/* Begin PBXTargetDependency section */')) {
    s = s.replace('/* Begin PBXVariantGroup section */', `/* Begin PBXTargetDependency section */\n\t\t${ID.shareDependency} /* PBXTargetDependency */ = {\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = ${ID.shareTarget} /* ShareExtension */;\n\t\t\ttargetProxy = ${ID.shareContainerProxy} /* PBXContainerItemProxy */;\n\t\t};\n/* End PBXTargetDependency section */\n\n/* Begin PBXVariantGroup section */`)
  } else {
    insertAfter('/* Begin PBXTargetDependency section */\n', `\t\t${ID.shareDependency} /* PBXTargetDependency */ = {\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = ${ID.shareTarget} /* ShareExtension */;\n\t\t\ttargetProxy = ${ID.shareContainerProxy} /* PBXContainerItemProxy */;\n\t\t};\n`)
  }
  // The embed phase must precede the run-script phases: "Finalize Info.plist" consumes the built
  // Info.plist, and Xcode orders the appex copy before Info.plist processing (otherwise: "Cycle
  // inside App").
  replaceOnce(`\t\t\t\t504EC3021FED79650016851F /* Resources */,\n\t\t\t\t${ID.copyDataPhase} /* Copy Bundled Databases */,\n`,
    `\t\t\t\t504EC3021FED79650016851F /* Resources */,\n\t\t\t\t${ID.shareEmbedPhase} /* Embed Foundation Extensions */,\n\t\t\t\t${ID.copyDataPhase} /* Copy Bundled Databases */,\n`)
  replaceOnce(`\t\t\t\t${ID.finalizePlistPhase} /* Finalize Info.plist */,\n\t\t\t);\n\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = App;`,
    `\t\t\t\t${ID.finalizePlistPhase} /* Finalize Info.plist */,\n\t\t\t);\n\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t\t${ID.shareDependency} /* PBXTargetDependency */,\n\t\t\t);\n\t\t\tname = App;`)
}

if (s !== before) {
  writeFileSync(PBX, s)
  console.log('[ios] project.pbxproj patched')
} else {
  console.log('[ios] project.pbxproj already up to date')
}
