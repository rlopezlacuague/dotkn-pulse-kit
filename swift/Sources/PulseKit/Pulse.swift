import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The app-facing API.
///
///     Pulse.configure(app: "habitants", endpoint: URL(string: "https://habitants.app/__pulse/e")!)
///     Pulse.track("paywall_viewed", path: "/onboarding/paywall")
///
/// Sends no identifier of any kind (no IDFV, IDFA or user id). App Store privacy label to declare:
/// "Product Interaction, not linked to identity".
public enum Pulse {
    private static let holder = Holder()

    public static func configure(app: String, endpoint: URL, key: String? = nil) {
        let client = PulseClient(app: app, endpoint: endpoint, transport: URLSessionTransport(key: key))
        holder.set(client)
        holder.startTimer(client)
        #if canImport(UIKit)
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { _ in
                Task { await client.didEnterBackground() }
            }
        }
        #endif
    }

    public static func track(_ event: String, path: String? = nil, outcome: String? = nil, campaign: String? = nil, value: Double = 1, duration: Double? = nil) {
        guard let client = holder.get() else { return }
        Task { await client.track(event, path: path, outcome: outcome, campaign: campaign, value: value, duration: duration) }
    }

    public static func flush() async {
        await holder.get()?.flush()
    }

    private final class Holder: @unchecked Sendable {
        private let lock = NSLock()
        private var client: PulseClient?
        private var timer: Task<Void, Never>?

        func set(_ c: PulseClient) { lock.withLock { client = c } }
        func get() -> PulseClient? { lock.withLock { client } }

        func startTimer(_ c: PulseClient) {
            lock.withLock {
                timer?.cancel()
                timer = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 5_000_000_000)
                        await c.tick()
                    }
                }
            }
        }
    }
}
