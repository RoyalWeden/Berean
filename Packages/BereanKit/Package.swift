// swift-tools-version: 6.0
// BereanKit — shared, UI-free Swift modules for the native Berean apps (BereanMac, BereanIOS).
// See docs/native-migration/MASTER-SPECIFICATION.md §3 and DECISIONS.md.
import PackageDescription

let package = Package(
    name: "BereanKit",
    // Trial deployment floor (spec C2: owner decision pending — trial iOS 18 / macOS 15).
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "BereanCore", targets: ["BereanCore"]),
        .library(name: "BereanSync", targets: ["BereanSync"]),
        .library(name: "BereanReference", targets: ["BereanReference"]),
        .library(name: "BereanSQLite", targets: ["BereanSQLite"]),
        .library(name: "BereanBible", targets: ["BereanBible"]),
        .library(name: "BereanText", targets: ["BereanText"]),
    ],
    targets: [
        // JavaScript-compatible JSON value model: UTF-16 strings, JS property order,
        // JSON.parse / JSON.stringify fidelity (the sync hashes are computed over that text).
        .target(name: "BereanCore"),
        // Sync wire format: record/field hashes, hybrid logical clock, journal files,
        // fractional order keys. TypeScript (src/platform/sync) is the oracle.
        .target(name: "BereanSync", dependencies: ["BereanCore"]),
        // Book catalogue and reference grammar (src/lib/parseRef.ts). Tables are generated from
        // the TypeScript (Generated/ReferenceTables.swift).
        .target(name: "BereanReference", dependencies: ["BereanCore"]),
        // System SQLite (ADR-0006): read-only bundled corpora now, the user store in M3.
        .target(name: "BereanSQLite", linkerSettings: [.linkedLibrary("sqlite3")]),
        // Read-only Scripture services (src/platform/services/bibleService.ts).
        .target(name: "BereanBible", dependencies: ["BereanCore", "BereanSQLite", "BereanReference", "BereanText"]),
        // Verse text: tagged tokens, italic/red-letter ranges, annotation stripping, offset maps.
        .target(name: "BereanText", dependencies: ["BereanCore"]),
        .testTarget(name: "BereanCoreTests", dependencies: ["BereanCore"]),
        // Golden-corpus conformance: fixtures exported from the TypeScript implementation
        // by `npm run golden:export` (scripts/golden). Never hand-edit Golden/*.json.
        .testTarget(
            name: "BereanConformanceTests",
            dependencies: ["BereanCore", "BereanSync", "BereanReference", "BereanSQLite", "BereanBible", "BereanText"],
            resources: [.copy("Golden")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
