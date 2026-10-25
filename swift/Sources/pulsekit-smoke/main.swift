// swift run pulsekit-smoke <endpoint> [app]: posts 5 events through PulseClient exactly as an iOS
// app would (source "ios"), to a real collector, and exits non-zero if any stayed queued.
import Foundation
import PulseKit

let args = CommandLine.arguments
guard args.count >= 2, let endpoint = URL(string: args[1]) else {
    FileHandle.standardError.write("usage: pulsekit-smoke <https://host/__pulse/e> [app]\n".data(using: .utf8)!)
    exit(2)
}
let app = args.count >= 3 ? args[2] : "pulse-kit-canary"
let storage = FileManager.default.temporaryDirectory.appendingPathComponent("pulsekit-smoke-\(UUID().uuidString).json")
let client = PulseClient(app: app, endpoint: endpoint, storage: storage)
for (i, name) in ["smoke_open", "smoke_view", "smoke_tap", "smoke_value", "smoke_close"].enumerated() {
    await client.track(name, path: "/smoke/\(i)", outcome: "smoke", value: Double(i + 1))
}
await client.flush()
let left = await client.queuedCount()
print(left == 0 ? "sent 5 events to \(endpoint) as \(app)" : "\(left) events still queued (the collector did not answer 2xx)")
try? FileManager.default.removeItem(at: storage)
exit(left == 0 ? 0 : 1)
