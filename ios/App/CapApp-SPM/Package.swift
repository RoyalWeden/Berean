// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2"),
        .package(name: "CapacitorApp", path: "../../../../Berean/node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../../Berean/node_modules/@capacitor/browser"),
        .package(name: "CapacitorClipboard", path: "../../../../Berean/node_modules/@capacitor/clipboard"),
        .package(name: "CapacitorFilesystem", path: "../../../../Berean/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorGeolocation", path: "../../../../Berean/node_modules/@capacitor/geolocation"),
        .package(name: "CapacitorHaptics", path: "../../../../Berean/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorKeyboard", path: "../../../../Berean/node_modules/@capacitor/keyboard"),
        .package(name: "CapacitorPreferences", path: "../../../../Berean/node_modules/@capacitor/preferences"),
        .package(name: "CapacitorShare", path: "../../../../Berean/node_modules/@capacitor/share"),
        .package(name: "CapacitorStatusBar", path: "../../../../Berean/node_modules/@capacitor/status-bar")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorClipboard", package: "CapacitorClipboard"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorGeolocation", package: "CapacitorGeolocation"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar")
            ]
        )
    ]
)
