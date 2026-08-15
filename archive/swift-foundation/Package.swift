// swift-tools-version: 6.1
import PackageDescription

// Atlas Ascend — modular core.
//
// The shipping product is an iOS app. macOS is declared as a supported platform
// for one reason only: it lets the design system and feature modules be
// type-checked and unit-tested from the command line without a full Xcode
// install. Nothing in these modules may depend on UIKit or an iOS-only API
// without an `#if os(iOS)` guard, or that verification path breaks.
let package = Package(
    name: "AtlasAscend",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "AtlasDesign", targets: ["AtlasDesign"]),
        .library(name: "AtlasMap", targets: ["AtlasMap"]),
        .library(name: "AtlasCommandCenter", targets: ["AtlasCommandCenter"]),
    ],
    targets: [
        // Design system: tokens, materials, motion, primitive components.
        // Depends on nothing. Every other module draws from it.
        .target(name: "AtlasDesign"),

        // Map provider abstraction. Owns the camera/annotation contract that
        // the Mapbox implementation will satisfy. Deliberately knows nothing
        // about Mapbox so the vendor stays swappable.
        .target(name: "AtlasMap", dependencies: ["AtlasDesign"]),

        // The hero surface: full-bleed map with Atlas floating above it.
        .target(name: "AtlasCommandCenter", dependencies: ["AtlasDesign", "AtlasMap"]),

        .testTarget(
            name: "AtlasDesignTests",
            dependencies: ["AtlasDesign", "AtlasMap", "AtlasCommandCenter"]
        ),
    ]
)
