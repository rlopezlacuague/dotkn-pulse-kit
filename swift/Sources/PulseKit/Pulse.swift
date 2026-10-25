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

    /// Idempotent: the same app, endpoint and key keep the running client (one queue, one timer,
    /// one set of observers). Different ones replace it, removing the old timer and observers.
    public static func configure(app: String, endpoint: URL, key: String? = nil) {
        let identity = "\(app)|\(endpoint.absoluteString)|\(key ?? "")"
        guard !holder.isConfigured(as: identity) else { return }
        let client = PulseClient(app: app, endpoint: endpoint, transport: URLSessionTransport(key: key))
        var observers: [NSObjectProtocol] = []
        #if canImport(UIKit)
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { _ in
                Task { await client.didEnterBackground() }
            })
        }
        #endif
        holder.replace(client, identity: identity, observers: observers)
    }

    /// The configured client (tests).
    static func current() -> PulseClient? { holder.get() }

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
        private var identity: String?
        private var timer: Task<Void, Never>?
        private var observers: [NSObjectProtocol] = []

        func get() -> PulseClient? { lock.withLock { client } }
        func isConfigured(as id: String) -> Bool { lock.withLock { identity == id && client != nil } }

        func replace(_ c: PulseClient, identity id: String, observers new: [NSObjectProtocol]) {
            let old: [NSObjectProtocol] = lock.withLock {
                timer?.cancel()
                let previous = observers
                client = c
                identity = id
                observers = new
                timer = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 5_000_000_000)
                        await c.tick()
                    }
                }
                return previous
            }
            for o in old { NotificationCenter.default.removeObserver(o) }
        }
    }
}
