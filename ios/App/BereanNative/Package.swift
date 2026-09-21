// swift-tools-version: 5.9
import PackageDescription

// Berean's local Capacitor plugins (docs/mobile/architecture.md §4). Added to the App target as a
// local Swift package (scripts/ios/patch-xcodeproj.mjs) and registered at runtime by
// ios/App/App/BereanBridgeViewController.swift. Kept out of CapApp-SPM/ because that package is
// rewritten by `cap sync`.
let package = Package(
    name: "BereanNative",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "BereanNative", targets: ["BereanNative"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "BereanNative",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources/BereanNative",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .testTarget(
            name: "BereanNativeTests",
            dependencies: ["BereanNative"],
            path: "Tests/BereanNativeTests"
        )
    ]
)
