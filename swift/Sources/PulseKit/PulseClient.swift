import Foundation

/// Sends one encoded batch. The default is `URLSessionTransport`; tests inject a fake.
public protocol PulseTransport: Sendable {
    func send(_ body: Data, to url: URL, language: String) async throws
}

/// POST with a 10 s timeout; any non-2xx answer is a failure (the batch is retried later).
public struct URLSessionTransport: PulseTransport {
    let session: URLSession
    let key: String?

    public init(session: URLSession = .shared, key: String? = nil) {
        self.session = session
        self.key = key
    }

    public func send(_ body: Data, to url: URL, language: String) async throws {
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(language, forHTTPHeaderField: "accept-language")
        if let key { request.setValue(key, forHTTPHeaderField: "x-pulse-key") }
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}

struct QueuedEvent: Codable, Sendable {
    var event: String
    var path: String?
    var outcome: String?
    var ct: String?
    var value: Double
    var duration: Double?
    var at: Date
}

/// The wire shape of the contract: no timestamp, no identifier, nothing about the device.
private struct WireEvent: Encodable {
    var event: String
    var path: String?
    var outcome: String?
    var ct: String?
    var value: Double
    var duration: Double?
}

private struct WireBatch: Encodable {
    var app: String
    var events: [WireEvent]
    var source: String
}

/// The event queue: persisted to a file, flushed at 20 events, 30 s after the oldest one and when
/// the app leaves the foreground; a failed batch is retried on the next flush and an event older
/// than 24 h is dropped. Batches hold at most `PulseContract.maxBatch` events.
public actor PulseClient {
    public static let flushCount = 20
    public static let flushAfter: TimeInterval = 30
    public static let maxAge: TimeInterval = 24 * 3600

    let app: String
    let endpoint: URL
    let transport: PulseTransport
    let storage: URL?
    let now: @Sendable () -> Date
    let language: String
    private var queue: [QueuedEvent]
    private var flushing = false
    private let nameRegex = try! Regex(PulseContract.eventName)

    public init(
        app: String,
        endpoint: URL,
        transport: PulseTransport = URLSessionTransport(),
        storage: URL? = PulseClient.defaultStorage(),
        now: @escaping @Sendable () -> Date = { Date() },
        language: String = Locale.preferredLanguages.first ?? "-"
    ) {
        self.app = app
        self.endpoint = endpoint
        self.transport = transport
        self.storage = storage
        self.now = now
        self.language = language
        if let storage, let data = try? Data(contentsOf: storage),
           let saved = try? JSONDecoder().decode([QueuedEvent].self, from: data) {
            queue = saved
        } else {
            queue = []
        }
    }

    /// Application Support/PulseKit/queue.json.
    public static func defaultStorage() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        return base.appendingPathComponent("PulseKit", isDirectory: true).appendingPathComponent("queue.json")
    }

    public func track(_ event: String, path: String? = nil, outcome: String? = nil, campaign: String? = nil, value: Double = 1, duration: Double? = nil) async {
        guard (try? nameRegex.wholeMatch(in: event)) != nil else { return }
        queue.append(QueuedEvent(event: event, path: path, outcome: outcome, ct: campaign, value: value, duration: duration, at: now()))
        persist()
        if queue.count >= Self.flushCount { await flush() }
    }

    /// The timer's job: flush once the oldest queued event is 30 s old.
    public func tick() async {
        guard let oldest = queue.first?.at, now().timeIntervalSince(oldest) >= Self.flushAfter else { return }
        await flush()
    }

    public func didEnterBackground() async { await flush() }

    public func queuedCount() -> Int { queue.count }

    /// Returns once no flush is in flight.
    public func waitForIdle() async {
        while flushing { await Task.yield() }
    }

    public func flush() async {
        if flushing { return }
        flushing = true
        defer { flushing = false }
        let cutoff = now().addingTimeInterval(-Self.maxAge)
        queue.removeAll { $0.at < cutoff }
        persist()
        while !queue.isEmpty {
            let batch = Array(queue.prefix(PulseContract.maxBatch))
            guard let body = try? Self.encode(app: app, batch) else { queue.removeFirst(batch.count); continue }
            do {
                try await transport.send(body, to: endpoint, language: language)
                queue.removeFirst(batch.count)
                persist()
            } catch {
                persist()
                return
            }
        }
    }

    static func encode(app: String, _ batch: [QueuedEvent]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let events = batch.map { WireEvent(event: $0.event, path: $0.path, outcome: $0.outcome, ct: $0.ct, value: $0.value, duration: $0.duration) }
        return try encoder.encode(WireBatch(app: app, events: events, source: "ios"))
    }

    private func persist() {
        guard let storage else { return }
        do {
            try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(queue).write(to: storage, options: .atomic)
        } catch {
            // Analytics never breaks the app: a write failure keeps the queue in memory only.
        }
    }
}
