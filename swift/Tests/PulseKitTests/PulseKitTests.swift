import XCTest
@testable import PulseKit

/// A transport that records bodies and fails while `failing` is set.
final class FakeTransport: PulseTransport, @unchecked Sendable {
    var sent: [Data] = []
    var attempts = 0
    var failing = false
    func send(_ body: Data, to url: URL, language: String) async throws {
        attempts += 1
        if failing { throw URLError(.notConnectedToInternet) }
        sent.append(body)
    }
}

final class PulseKitTests: XCTestCase {
    let endpoint = URL(string: "https://canary.example/__pulse/e")!
    var dir: URL!

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("pulsekit-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    func client(_ t: FakeTransport, now: Date = Date(timeIntervalSince1970: 1_800_000_000)) -> PulseClient {
        PulseClient(app: "pulse-kit-canary", endpoint: endpoint, transport: t, storage: dir.appendingPathComponent("queue.json"), now: { now })
    }

    /// The exact body the Swift side sends, equal to the committed cross-language fixture that the
    /// node collector test turns into pulse_events points.
    func testBodyEqualsTheCrossLanguageFixture() async throws {
        let t = FakeTransport()
        let c = client(t)
        await c.track("app_opened", path: "/")
        await c.track("paywall_viewed", path: "/onboarding/paywall", outcome: "shown")
        await c.track("habit_completed", path: "/today", value: 2, duration: 1.5)
        await c.track("signup", path: "/signup", outcome: "apple", campaign: "tt-oct")
        await c.track("session_end")
        await c.flush()
        XCTAssertEqual(t.sent.count, 1)
        // The repo's one fixture (fixtures/ios-batch.json), read beside this source file.
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../fixtures/ios-batch.json").standardized
        let fixture = try String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertEqual(String(decoding: t.sent[0], as: UTF8.self), fixture)
    }

    func testFlushesAtTwentyQueuedEventsNotBefore() async {
        let t = FakeTransport()
        let c = client(t)
        for i in 0..<19 { await c.track("e\(i)") }
        XCTAssertEqual(t.sent.count, 0)
        await c.track("e19")
        await c.waitForIdle()
        XCTAssertEqual(t.sent.count, 1)
        let count = await c.queuedCount()
        XCTAssertEqual(count, 0)
    }

    func testThirtySecondsAfterTheOldestEventTheTimerFlushes() async {
        let t = FakeTransport()
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let c = PulseClient(app: "pulse-kit-canary", endpoint: endpoint, transport: t, storage: dir.appendingPathComponent("q.json"), now: { now })
        await c.track("a")
        now = now.addingTimeInterval(29)
        await c.tick()
        XCTAssertEqual(t.sent.count, 0)
        now = now.addingTimeInterval(2)
        await c.tick()
        XCTAssertEqual(t.sent.count, 1)
    }

    func testBackgroundFlushesImmediately() async {
        let t = FakeTransport()
        let c = client(t)
        await c.track("a")
        await c.didEnterBackground()
        XCTAssertEqual(t.sent.count, 1)
    }

    func testBatchesAreAtMostTwentyFiveEvents() async throws {
        let t = FakeTransport()
        t.failing = true
        let c = client(t)
        for i in 0..<60 { await c.track("e\(i)") }
        t.failing = false
        await c.flush()
        let sizes = try t.sent.map { try (JSONSerialization.jsonObject(with: $0) as! [String: Any])["events"] as! [Any] }.map(\.count)
        XCTAssertEqual(sizes, [25, 25, 10])
    }

    func testTheQueueSurvivesARelaunch() async {
        let t = FakeTransport()
        t.failing = true
        let first = client(t)
        await first.track("before_kill", path: "/x")
        await first.flush()
        let second = client(t)
        let count = await second.queuedCount()
        XCTAssertEqual(count, 1)
        t.failing = false
        await second.flush()
        XCTAssertTrue(String(decoding: t.sent[0], as: UTF8.self).contains("before_kill"))
    }

    func testAFailedSendIsRetriedThenDroppedAfterTwentyFourHours() async {
        let t = FakeTransport()
        t.failing = true
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let c = PulseClient(app: "pulse-kit-canary", endpoint: endpoint, transport: t, storage: dir.appendingPathComponent("r.json"), now: { now })
        await c.track("old")
        await c.flush()
        var count = await c.queuedCount()
        XCTAssertEqual(count, 1, "kept for retry")
        now = now.addingTimeInterval(23 * 3600)
        await c.track("new")
        await c.flush()
        count = await c.queuedCount()
        XCTAssertEqual(count, 2)
        now = now.addingTimeInterval(2 * 3600)
        t.failing = false
        await c.flush()
        XCTAssertEqual(t.sent.count, 1)
        let body = String(decoding: t.sent[0], as: UTF8.self)
        XCTAssertFalse(body.contains("\"old\""), "older than 24 h: dropped")
        XCTAssertTrue(body.contains("\"new\""))
    }

    func testInvalidEventNamesAreDroppedOnDeviceAndNoIdentifierIsSent() async {
        let t = FakeTransport()
        let c = client(t)
        await c.track("Bad Name")
        await c.track("ok")
        await c.flush()
        let body = String(decoding: t.sent[0], as: UTF8.self)
        XCTAssertFalse(body.contains("Bad Name"))
        for word in ["idfv", "idfa", "user", "device", "uuid"] { XCTAssertFalse(body.lowercased().contains(word), word) }
    }

    // v0.1.1 hardening (the review of 2026-10-25). Measured before, release build on a Mac: 5,000
    // events tracked offline took 64.3 s and left all 5,000 queued; one NaN lost its whole batch.

    func testANonFiniteValueDropsThatEventNotItsBatch() async {
        let t = FakeTransport()
        let c = client(t)
        for i in 0..<10 { await c.track("ok_\(i)") }
        await c.track("bad_value", value: .nan)
        await c.track("bad_duration", duration: .infinity)
        await c.flush()
        XCTAssertEqual(t.sent.count, 1)
        let events = (try? JSONSerialization.jsonObject(with: t.sent[0]) as? [String: Any])?["events"] as? [Any]
        XCTAssertEqual(events?.count, 10)
    }

    func testTheQueueIsCappedAtOneThousandDroppingTheOldest() async throws {
        let t = FakeTransport()
        t.failing = true
        let c = client(t)
        for i in 0..<1500 { await c.track("e\(i)") }
        let count = await c.queuedCount()
        XCTAssertEqual(count, PulseClient.maxQueue)
        XCTAssertEqual(PulseClient.maxQueue, 1000)
        t.failing = false
        await c.flush()
        let first = try JSONSerialization.jsonObject(with: t.sent[0]) as! [String: Any]
        XCTAssertEqual(((first["events"] as! [[String: Any]])[0]["event"] as! String), "e500")
    }

    func testTrackDoesNotRewriteTheQueueFileOnEveryEvent() async {
        let t = FakeTransport()
        t.failing = true
        let c = client(t)
        for i in 0..<1000 { await c.track("e\(i)") }
        let writes = await c.persistWrites()
        XCTAssertLessThanOrEqual(writes, 3, "v0.1.0 wrote the whole queue once per event and twice per flush attempt")
    }

    func testUnsentEventsReachTheFileWithinOneTick() async {
        let t = FakeTransport()
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let file = dir.appendingPathComponent("tick.json")
        let c = PulseClient(app: "pulse-kit-canary", endpoint: endpoint, transport: t, storage: file, now: { now })
        await c.track("a")
        now = now.addingTimeInterval(5)
        await c.tick()
        let relaunched = PulseClient(app: "pulse-kit-canary", endpoint: endpoint, transport: t, storage: file, now: { now })
        let count = await relaunched.queuedCount()
        XCTAssertEqual(count, 1)
    }

    func testAfterAFailedSendAutomaticFlushesBackOffAnExplicitFlushStillTries() async {
        let t = FakeTransport()
        t.failing = true
        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let c = PulseClient(app: "pulse-kit-canary", endpoint: endpoint, transport: t, storage: dir.appendingPathComponent("b.json"), now: { now })
        for i in 0..<60 { await c.track("e\(i)") }
        XCTAssertEqual(t.attempts, 1, "one attempt at 20 queued, then backing off, not one per event")
        now = now.addingTimeInterval(29)
        await c.tick()
        XCTAssertEqual(t.attempts, 1)
        now = now.addingTimeInterval(2)
        await c.tick()
        XCTAssertEqual(t.attempts, 2, "retried after 30 s")
        await c.track("e60")
        XCTAssertEqual(t.attempts, 2, "the next wait doubles")
        await c.flush()
        XCTAssertEqual(t.attempts, 3, "an explicit flush (and the background flush) always tries")
    }

    func testConfiguringTwiceWithTheSameAppKeepsOneClient() {
        Pulse.configure(app: "pulse-kit-canary", endpoint: endpoint)
        let first = Pulse.current()
        Pulse.configure(app: "pulse-kit-canary", endpoint: endpoint)
        XCTAssertTrue(first != nil && first === Pulse.current())
        Pulse.configure(app: "other-app", endpoint: endpoint)
        XCTAssertFalse(first === Pulse.current())
    }

    func testTheGeneratedContractMatchesTheKit() {
        XCTAssertEqual(PulseContract.version, 1)
        XCTAssertEqual(PulseContract.collector, "/__pulse/e")
        XCTAssertEqual(PulseContract.maxBatch, 25)
        XCTAssertEqual(PulseContract.eventName, "^[a-z][a-z0-9_.]{0,63}$")
    }
}
