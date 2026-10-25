// swift-tools-version: 6.0
// PulseKit: the iOS side of the Pulse kit (contract v1). It sends events to the app's own
// /__pulse/e collector; no identifier of any kind leaves the device.
import PackageDescription

let package = Package(
    name: "PulseKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "PulseKit", targets: ["PulseKit"]),
    ],
    targets: [
        .target(name: "PulseKit", path: "swift/Sources/PulseKit"),
        .executableTarget(name: "pulsekit-smoke", dependencies: ["PulseKit"], path: "swift/Sources/pulsekit-smoke"),
        // The tests mutate a captured clock; Swift 5 mode keeps that a warning. The library is Swift 6.
        .testTarget(name: "PulseKitTests", dependencies: ["PulseKit"], path: "swift/Tests/PulseKitTests", swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
