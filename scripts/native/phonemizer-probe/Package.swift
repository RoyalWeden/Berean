// swift-tools-version: 6.2
import PackageDescription

// Research executable only. Neither native application links this package.
let package = Package(name: "BereanPhonemizerProbe", platforms: [.macOS(.v15)], dependencies: [
    .package(url: "https://github.com/espeak-ng/espeak-ng-spm.git", revision: "fd28f6460cc4cdf631528c8e2f7bd825747aac5c"),
    .package(path: "../../../Packages/BereanKit")
], targets: [
    .executableTarget(name: "Probe", dependencies: [
        .product(name: "libespeak-ng", package: "espeak-ng-spm"),
        .product(name: "espeak-ng-data", package: "espeak-ng-spm"),
        .product(name: "BereanText", package: "BereanKit")
    ])
])
