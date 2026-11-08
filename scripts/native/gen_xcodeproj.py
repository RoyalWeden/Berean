#!/usr/bin/env python3
"""Generates apple/Berean.xcodeproj/project.pbxproj (ADR-0001).

Sources live in file-system-synchronized folders, so adding or removing Swift files never needs
this script. Run it only to add a target or a BereanKit product:

    python3 scripts/native/gen_xcodeproj.py > apple/Berean.xcodeproj/project.pbxproj

Build settings belong in apple/Config/*.xcconfig, not here. Object ids are deterministic.
"""
import itertools, sys
c = itertools.count(1)
def nid(): return "BE7EA0%018X" % next(c)
P = {k: nid() for k in "project mainGroup productsGroup configGroup grpMac grpIOS grpShared refMacApp refIOSApp refBase refMacCfg refIOSCfg pkg projList projDebug projRelease".split()}
T = {}
PRODUCTS = ["BereanCore", "BereanSync", "BereanReference"]
for t in ("BereanMac", "BereanIOS"):
    T[t] = {k: nid() for k in "target src fw res list debug release".split()}
for t in ("BereanMac", "BereanIOS"):
    for prod in PRODUCTS:
        T[t]["dep" + prod] = nid()
        T[t]["bf" + prod] = nid()
o = []
def obj(id_, isa, body, comment=""):
    o.append((isa, id_, comment, body))

common_debug = """ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_TESTABILITY = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				ONLY_ACTIVE_ARCH = YES;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";"""
common_release = """ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_OPTIMIZATION_LEVEL = "-O";"""

lines = []
w = lines.append
w("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 77;\n\tobjects = {\n")
def section(name, items):
    w(f"\n/* Begin {name} section */\n")
    for it in items: w(it)
    w(f"/* End {name} section */\n")

bf = []
for t, d in T.items():
    for prod in PRODUCTS:
        bf.append(f"\t\t{d['bf' + prod]} /* {prod} in Frameworks */ = {{isa = PBXBuildFile; productRef = {d['dep' + prod]} /* {prod} */; }};\n")
section("PBXBuildFile", bf)

section("PBXFileReference", [
    f"\t\t{P['refMacApp']} /* BereanMac.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = BereanMac.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n",
    f"\t\t{P['refIOSApp']} /* BereanIOS.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = BereanIOS.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n",
    f"\t\t{P['refBase']} /* Base.xcconfig */ = {{isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Base.xcconfig; sourceTree = \"<group>\"; }};\n",
    f"\t\t{P['refMacCfg']} /* BereanMac.xcconfig */ = {{isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = BereanMac.xcconfig; sourceTree = \"<group>\"; }};\n",
    f"\t\t{P['refIOSCfg']} /* BereanIOS.xcconfig */ = {{isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = BereanIOS.xcconfig; sourceTree = \"<group>\"; }};\n",
])

section("PBXFileSystemSynchronizedRootGroup", [
    f"\t\t{P['grpMac']} /* BereanMac */ = {{isa = PBXFileSystemSynchronizedRootGroup; path = BereanMac; sourceTree = \"<group>\"; }};\n",
    f"\t\t{P['grpIOS']} /* BereanIOS */ = {{isa = PBXFileSystemSynchronizedRootGroup; path = BereanIOS; sourceTree = \"<group>\"; }};\n",
    f"\t\t{P['grpShared']} /* Shared */ = {{isa = PBXFileSystemSynchronizedRootGroup; path = Shared; sourceTree = \"<group>\"; }};\n",
])

fw = []
for t, d in T.items():
    fw.append(f"""\t\t{d['fw']} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
{"".join(f"				{d['bf' + p]} /* {p} in Frameworks */,\n" for p in PRODUCTS)}			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
""")
section("PBXFrameworksBuildPhase", fw)

section("PBXGroup", [
f"""\t\t{P['mainGroup']} = {{
			isa = PBXGroup;
			children = (
				{P['grpMac']} /* BereanMac */,
				{P['grpIOS']} /* BereanIOS */,
				{P['grpShared']} /* Shared */,
				{P['configGroup']} /* Config */,
				{P['productsGroup']} /* Products */,
			);
			sourceTree = "<group>";
		}};
""",
f"""\t\t{P['configGroup']} /* Config */ = {{
			isa = PBXGroup;
			children = (
				{P['refBase']} /* Base.xcconfig */,
				{P['refMacCfg']} /* BereanMac.xcconfig */,
				{P['refIOSCfg']} /* BereanIOS.xcconfig */,
			);
			path = Config;
			sourceTree = "<group>";
		}};
""",
f"""\t\t{P['productsGroup']} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{P['refMacApp']} /* BereanMac.app */,
				{P['refIOSApp']} /* BereanIOS.app */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
"""])

tg = []
for t, d in T.items():
    own = P['grpMac'] if t == "BereanMac" else P['grpIOS']
    ref = P['refMacApp'] if t == "BereanMac" else P['refIOSApp']
    tg.append(f"""\t\t{d['target']} /* {t} */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {d['list']} /* Build configuration list for PBXNativeTarget "{t}" */;
			buildPhases = (
				{d['src']} /* Sources */,
				{d['fw']} /* Frameworks */,
				{d['res']} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			fileSystemSynchronizedGroups = (
				{own} /* {t} */,
				{P['grpShared']} /* Shared */,
			);
			name = {t};
			packageProductDependencies = (
{"".join(f"				{d['dep' + p]} /* {p} */,\n" for p in PRODUCTS)}			);
			productName = {t};
			productReference = {ref} /* {t}.app */;
			productType = "com.apple.product-type.application";
		}};
""")
section("PBXNativeTarget", tg)

attrs = "".join(f"\t\t\t\t\t{d['target']} = {{\n\t\t\t\t\t\tCreatedOnToolsVersion = 27.2;\n\t\t\t\t\t}};\n" for d in T.values())
section("PBXProject", [f"""\t\t{P['project']} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 2720;
				LastUpgradeCheck = 2720;
				TargetAttributes = {{
{attrs}				}};
			}};
			buildConfigurationList = {P['projList']} /* Build configuration list for PBXProject "Berean" */;
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = {P['mainGroup']};
			minimizedProjectReferenceProxies = 1;
			packageReferences = (
				{P['pkg']} /* XCLocalSwiftPackageReference "../Packages/BereanKit" */,
			);
			preferredProjectObjectVersion = 77;
			productRefGroup = {P['productsGroup']} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{T['BereanMac']['target']} /* BereanMac */,
				{T['BereanIOS']['target']} /* BereanIOS */,
			);
		}};
"""])

phase = lambda id_, isa, name: f"""\t\t{id_} /* {name} */ = {{
			isa = {isa};
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
"""
section("PBXResourcesBuildPhase", [phase(d['res'], "PBXResourcesBuildPhase", "Resources") for d in T.values()])
section("PBXSourcesBuildPhase", [phase(d['src'], "PBXSourcesBuildPhase", "Sources") for d in T.values()])

cfg = []
cfg.append(f"""\t\t{P['projDebug']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				{common_debug}
			}};
			name = Debug;
		}};
""")
cfg.append(f"""\t\t{P['projRelease']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				{common_release}
			}};
			name = Release;
		}};
""")
for t, d in T.items():
    ref = P['refMacCfg'] if t == "BereanMac" else P['refIOSCfg']
    for k, n in (("debug", "Debug"), ("release", "Release")):
        extra = "VALIDATE_PRODUCT = YES;\n\t\t\t\t" if (t == "BereanIOS" and n == "Release") else ""
        cfg.append(f"""\t\t{d[k]} /* {n} */ = {{
			isa = XCBuildConfiguration;
			baseConfigurationReference = {ref} /* {t}.xcconfig */;
			buildSettings = {{
				{extra}PRODUCT_NAME = "$(TARGET_NAME)";
			}};
			name = {n};
		}};
""")
section("XCBuildConfiguration", cfg)

lists = [f"""\t\t{P['projList']} /* Build configuration list for PBXProject "Berean" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{P['projDebug']} /* Debug */,
				{P['projRelease']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
"""]
for t, d in T.items():
    lists.append(f"""\t\t{d['list']} /* Build configuration list for PBXNativeTarget "{t}" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{d['debug']} /* Debug */,
				{d['release']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
""")
section("XCConfigurationList", lists)

section("XCLocalSwiftPackageReference", [f"""\t\t{P['pkg']} /* XCLocalSwiftPackageReference "../Packages/BereanKit" */ = {{
			isa = XCLocalSwiftPackageReference;
			relativePath = ../Packages/BereanKit;
		}};
"""])

deps = []
for t, d in T.items():
    for n in PRODUCTS:
        k = "dep" + n
        deps.append(f"""\t\t{d[k]} /* {n} */ = {{
			isa = XCSwiftPackageProductDependency;
			productName = {n};
		}};
""")
section("XCSwiftPackageProductDependency", deps)

w(f"\t}};\n\trootObject = {P['project']} /* Project object */;\n}}\n")
sys.stdout.write("".join(lines))
