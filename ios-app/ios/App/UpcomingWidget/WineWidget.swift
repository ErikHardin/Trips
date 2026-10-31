// The Wine widget (medium, iOS 17): today's 🍷 stops one at a time. ‹ › switch
// stops, − / + set each color's bottle count without opening the app, and the
// trip's total runs along the bottom. Tapping the stop's name opens its Wine
// sheet in the app.
//
// An admin turns it on in the app (Settings → Wine widget): the Worker issues a
// key that can only read today's wine stops and set bottle counts, and the app
// keeps it in the keychain group it shares with this extension (WineWidgetKey
// in SceneDelegate.swift). Without a key the widget says how to turn it on.
//
// A tap is saved here first (WineStore.pending) and shown at once, then sent to
// the Worker as an absolute count, so a retried tap can't double up and taps
// made without a signal go through on the next refresh.

import WidgetKit
import SwiftUI
import AppIntents
import Security

private let wineWorker = "https://hardin-trips-ai.erikchardin.workers.dev/wine-widget"

// ── Data ─────────────────────────────────────────────────────────────────────

struct WineStop: Codable, Hashable {
    let dayId: String
    let key: String
    let text: String
    let time: String
    let timeSort: String       // "HH:MM", '' when untimed
    var counts: [String: Int]

    var startMinutes: Int? {
        let parts = timeSort.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : nil
    }
}

struct WineTripRef: Codable, Hashable {
    let id: String
    let name: String
}

struct WinePayload: Codable {
    var trip: WineTripRef?
    var stops: [WineStop]
    var totals: [String: Int]
    var date: String?          // the phone's date it was fetched for
}

private struct WineSetResponse: Decodable {
    let counts: [String: Int]
    let totals: [String: Int]
}

enum WineColor: String, CaseIterable {
    case red, white, rose, sparkling

    var label: String {
        switch self {
        case .red: return "Red"
        case .white: return "White"
        case .rose: return "Rosé"
        case .sparkling: return "Sparkling"
        }
    }

    var dot: Color {
        switch self {
        case .red: return Color(hex: 0xE07F8C)
        case .white: return Color(hex: 0xE3C55A)
        case .rose: return Color(hex: 0xF0A7B3)
        case .sparkling: return Color(hex: 0x86BCDC)
        }
    }
}

private func wineToday(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

// ── The key (written by the app) ─────────────────────────────────────────────

enum WineKey {
    static func read() -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.erikhardin.trips.winewidget",
            kSecAttrAccount as String: "key",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String {
            query[kSecAttrAccessGroup as String] = prefix + "com.erikhardin.trips.shared"
        }
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// ── What the widget remembers between refreshes ──────────────────────────────

enum WineStore {
    private static let defaults = UserDefaults.standard

    static func payload() -> WinePayload? {
        guard let data = defaults.data(forKey: "wine.payload") else { return nil }
        return try? JSONDecoder().decode(WinePayload.self, from: data)
    }

    static func save(_ payload: WinePayload) {
        if let data = try? JSONEncoder().encode(payload) { defaults.set(data, forKey: "wine.payload") }
    }

    // Counts tapped but not yet saved by the Worker: "trip|day|activity|color" → count
    static var pending: [String: Int] {
        get { defaults.dictionary(forKey: "wine.pending") as? [String: Int] ?? [:] }
        set { defaults.set(newValue, forKey: "wine.pending") }
    }

    static func pendingKey(trip: String, day: String, activity: String, color: String) -> String {
        [trip, day, activity, color].joined(separator: "|")
    }

    // The stop picked with ‹ ›, for today only
    static func stopIndex(for date: String) -> Int? {
        guard defaults.string(forKey: "wine.stopIndexDate") == date else { return nil }
        return defaults.object(forKey: "wine.stopIndex") as? Int
    }

    static func setStopIndex(_ index: Int, for date: String) {
        defaults.set(index, forKey: "wine.stopIndex")
        defaults.set(date, forKey: "wine.stopIndexDate")
    }

    // Set by a tap, so the refresh it causes doesn't wait on a full reload
    static var lastTapAt: Date? {
        get { defaults.object(forKey: "wine.lastTapAt") as? Date }
        set { defaults.set(newValue, forKey: "wine.lastTapAt") }
    }

    // The payload with pending taps applied, as the widget should show it
    static func applyPending(_ payload: WinePayload) -> WinePayload {
        guard let tripId = payload.trip?.id else { return payload }
        let pending = self.pending
        if pending.isEmpty { return payload }
        var out = payload
        for i in out.stops.indices {
            let stop = out.stops[i]
            for color in WineColor.allCases {
                let key = pendingKey(trip: tripId, day: stop.dayId, activity: stop.key, color: color.rawValue)
                guard let count = pending[key] else { continue }
                let was = stop.counts[color.rawValue] ?? 0
                out.stops[i].counts[color.rawValue] = count
                out.totals[color.rawValue] = max(0, (out.totals[color.rawValue] ?? 0) + count - was)
            }
        }
        return out
    }
}

// ── The Worker ───────────────────────────────────────────────────────────────

enum WineAPIError: Error { case off, failed }

enum WineAPI {
    private static func post(_ path: String, _ body: [String: Any]) async throws -> Data {
        var request = URLRequest(url: URL(string: wineWorker + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw WineAPIError.off }
        guard status == 200 else { throw WineAPIError.failed }
        return data
    }

    static func fetch(key: String, date: String) async throws -> WinePayload {
        let data = try await post("/data", ["key": key, "date": date])
        var payload = try JSONDecoder().decode(WinePayload.self, from: data)
        payload.date = date
        return payload
    }

    // Sends each pending count; a saved one leaves the queue and updates the cache
    static func flush(key: String) async throws {
        for (pendingKey, count) in WineStore.pending {
            let parts = pendingKey.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 4 else {
                WineStore.pending.removeValue(forKey: pendingKey)
                continue
            }
            let data = try await post("/set", ["key": key, "tripId": parts[0], "dayId": parts[1],
                                               "actKey": parts[2], "color": parts[3], "count": count])
            // A later tap on the same color replaces this one; keep that
            var queue = WineStore.pending
            if queue[pendingKey] == count { queue.removeValue(forKey: pendingKey) }
            WineStore.pending = queue
            if let saved = try? JSONDecoder().decode(WineSetResponse.self, from: data),
               var payload = WineStore.payload(), payload.trip?.id == parts[0] {
                if let i = payload.stops.firstIndex(where: { $0.dayId == parts[1] && $0.key == parts[2] }) {
                    payload.stops[i].counts = saved.counts
                }
                payload.totals = saved.totals
                WineStore.save(payload)
            }
        }
    }
}

// ── Timeline ─────────────────────────────────────────────────────────────────

struct WineEntry: TimelineEntry {
    let date: Date
    let enabled: Bool
    let payload: WinePayload?
    let pickedIndex: Int?      // set with ‹ › today; otherwise the stop now or next

    static let sample = WineEntry(
        date: Date(), enabled: true,
        payload: WinePayload(
            trip: WineTripRef(id: "sample", name: "Sonoma"),
            stops: [
                WineStop(dayId: "d", key: "a", text: "Gundlach Bundschu", time: "11am", timeSort: "11:00",
                         counts: ["red": 2, "rose": 1]),
                WineStop(dayId: "d", key: "b", text: "Kivelstadt Cellars", time: "1:30pm", timeSort: "13:30",
                         counts: ["red": 2, "white": 1]),
                WineStop(dayId: "d", key: "c", text: "Scribe Winery", time: "4pm", timeSort: "16:00", counts: [:]),
            ],
            totals: ["red": 7, "white": 2, "rose": 2, "sparkling": 0]),
        pickedIndex: 1)

    var stops: [WineStop] { payload?.stops ?? [] }

    var index: Int {
        guard !stops.isEmpty else { return 0 }
        if let picked = pickedIndex { return min(max(0, picked), stops.count - 1) }
        // The last stop starting within 15 minutes, else the first
        let now = minutes(of: date)
        var index = 0
        for (i, stop) in stops.enumerated() {
            if let start = stop.startMinutes, start <= now + 15 { index = i }
        }
        return index
    }

    // "Now · 1:30pm" while a stop is under way (until the next starts, at most 3 hours)
    func whenLabel(_ i: Int) -> String {
        let stop = stops[i]
        let time = stop.time.isEmpty ? "Today" : stop.time
        guard let start = stop.startMinutes else { return time }
        let now = minutes(of: date)
        let nextStart = i + 1 < stops.count ? stops[i + 1].startMinutes : nil
        if start <= now && now - start < 180 && (nextStart.map { now < $0 } ?? true) { return "Now · " + time }
        return time
    }

    private func minutes(of date: Date) -> Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
}

enum WineLoader {
    static func load() async -> WineEntry {
        let today = wineToday()
        guard let key = WineKey.read() else {
            return WineEntry(date: Date(), enabled: false, payload: nil, pickedIndex: nil)
        }
        do {
            try? await WineAPI.flush(key: key)
            let cached = WineStore.payload()
            let justTapped = (WineStore.lastTapAt.map { Date().timeIntervalSince($0) < 20 } ?? false)
            let payload: WinePayload
            if justTapped, let cached = cached, cached.date == today {
                payload = cached           // a tap's refresh: the counts the Worker just returned
            } else {
                payload = try await WineAPI.fetch(key: key, date: today)
                WineStore.save(payload)
            }
            return WineEntry(date: Date(), enabled: true, payload: WineStore.applyPending(payload),
                             pickedIndex: WineStore.stopIndex(for: today))
        } catch WineAPIError.off {
            return WineEntry(date: Date(), enabled: false, payload: nil, pickedIndex: nil)
        } catch {
            // No signal: today's last copy, with taps still waiting to go
            let cached = WineStore.payload().flatMap { $0.date == today ? $0 : nil }
            return WineEntry(date: Date(), enabled: true, payload: cached.map(WineStore.applyPending),
                             pickedIndex: WineStore.stopIndex(for: today))
        }
    }
}

struct WineProvider: TimelineProvider {
    func placeholder(in context: Context) -> WineEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (WineEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        Task { completion(await WineLoader.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WineEntry>) -> Void) {
        Task {
            let entry = await WineLoader.load()
            let now = Date()
            // A fresh entry as each stop starts, so "Now" and the stop shown move on
            let starts = entry.stops.compactMap { $0.startMinutes }.compactMap { m -> Date? in
                Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: now)
            }.filter { $0 > now }
            let entries = [entry] + starts.sorted().map {
                WineEntry(date: $0, enabled: entry.enabled, payload: entry.payload, pickedIndex: entry.pickedIndex)
            }
            // Every 30 minutes on a day with stops (and soon after a failure), else hourly
            let minutes = entry.enabled && entry.payload == nil ? 15 : (entry.stops.isEmpty ? 60 : 30)
            let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(86400 + 60)
            let next = min(now.addingTimeInterval(TimeInterval(minutes * 60)), midnight)
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }
}

// ── Taps ─────────────────────────────────────────────────────────────────────

struct WineSetIntent: AppIntent {
    static var title: LocalizedStringResource = "Change a bottle count"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Trip") var tripId: String
    @Parameter(title: "Day") var dayId: String
    @Parameter(title: "Activity") var activity: String
    @Parameter(title: "Color") var color: String
    @Parameter(title: "Change") var change: Int

    init() {}

    init(tripId: String, dayId: String, activity: String, color: String, change: Int) {
        self.tripId = tripId
        self.dayId = dayId
        self.activity = activity
        self.color = color
        self.change = change
    }

    func perform() async throws -> some IntentResult {
        let key = WineStore.pendingKey(trip: tripId, day: dayId, activity: activity, color: color)
        var pending = WineStore.pending
        let saved = WineStore.payload()?.stops.first { $0.dayId == dayId && $0.key == activity }?.counts[color] ?? 0
        let current = pending[key] ?? saved
        let next = max(0, min(99, current + change))
        guard next != current else { return .result() }
        pending[key] = next
        WineStore.pending = pending
        WineStore.lastTapAt = Date()
        // WidgetKit refreshes the widget when this returns; the refresh sends it
        return .result()
    }
}

struct WineStopIntent: AppIntent {
    static var title: LocalizedStringResource = "Show another wine stop"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Stop") var index: Int

    init() {}

    init(index: Int) {
        self.index = index
    }

    func perform() async throws -> some IntentResult {
        WineStore.setStopIndex(max(0, index), for: wineToday())
        WineStore.lastTapAt = Date()
        return .result()
    }
}

// ── Views ────────────────────────────────────────────────────────────────────

private let wineMuted = Color(hex: 0x6F7C73)

// hardintrips://open?… (handleWidgetLink in index.html)
private func wineOpenURL(_ items: [(String, String)]) -> URL? {
    let plain = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    let query = items.map { key, value in
        key + "=" + (value.addingPercentEncoding(withAllowedCharacters: plain) ?? "")
    }.joined(separator: "&")
    return URL(string: "hardintrips://open?" + query)
}

struct WineWidgetView: View {
    let entry: WineEntry

    var body: some View {
        content
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 9)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(Palette.background, for: .widget)
            .widgetURL(entry.payload?.trip.flatMap { wineOpenURL([("trip", $0.id)]) })
    }

    @ViewBuilder private var content: some View {
        if !entry.enabled {
            message(title: "🍷 Wine", text: "Turn it on in the Trips app: Settings → Wine widget.")
        } else if let payload = entry.payload {
            if let trip = payload.trip {
                if entry.stops.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("🍷 " + trip.name)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                        Text("No wine stops today. Give an activity the 🍷 emoji to log bottles here.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Palette.muted)
                        Spacer(minLength: 0)
                        totals(payload)
                    }
                } else {
                    stopView(trip: trip, payload: payload)
                }
            } else {
                message(title: "🍷 Wine", text: "No trip right now.")
            }
        } else {
            message(title: "🍷 Wine", text: "Can’t reach trips. It’ll try again soon.")
        }
    }

    private func message(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Palette.ink)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.muted)
        }
    }

    private func stopView(trip: WineTripRef, payload: WinePayload) -> some View {
        let i = entry.index
        let stop = entry.stops[i]
        let wineSheet = wineOpenURL([("trip", trip.id), ("day", stop.dayId), ("text", stop.text),
                                     ("time", stop.time), ("wine", "1")])
        return VStack(spacing: 6) {
            HStack(spacing: 6) {
                navButton("‹", to: i - 1, enabled: i > 0, label: "Previous stop")
                Group {
                    if let url = wineSheet {
                        Link(destination: url) { stopTitle(stop, i) }
                    } else {
                        stopTitle(stop, i)
                    }
                }
                .frame(maxWidth: .infinity)
                navButton("›", to: i + 1, enabled: i < entry.stops.count - 1, label: "Next stop")
            }
            HStack(spacing: 6) {
                ForEach(WineColor.allCases, id: \.self) { color in
                    colorCard(color, stop: stop, tripId: trip.id)
                }
            }
            .frame(maxHeight: .infinity)
            totals(payload)
        }
    }

    private func stopTitle(_ stop: WineStop, _ i: Int) -> some View {
        VStack(spacing: 1) {
            Text("🍷 " + (entry.whenLabel(i) + " · \(i + 1) of \(entry.stops.count)").uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Palette.terracotta)
                .lineLimit(1)
            Text(stop.text)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    @ViewBuilder private func navButton(_ symbol: String, to index: Int, enabled: Bool, label: String) -> some View {
        let face = Text(symbol)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(enabled ? Palette.ink : wineMuted)
            .frame(width: 26, height: 26)
            .background(Circle().fill(Palette.sand))
        if enabled {
            Button(intent: WineStopIntent(index: index)) { face }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
        } else {
            face.accessibilityHidden(true)
        }
    }

    private func colorCard(_ color: WineColor, stop: WineStop, tripId: String) -> some View {
        let count = stop.counts[color.rawValue] ?? 0
        return VStack(spacing: 0) {
            HStack(spacing: 4) {
                Circle().fill(color.dot).frame(width: 7, height: 7)
                Text(color.label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 2)
            Text("\(count)")
                .font(.system(size: 19, weight: .heavy))
                .foregroundStyle(count > 0 ? Palette.ink : Palette.muted)
            Spacer(minLength: 2)
            HStack(spacing: 4) {
                stepButton("−", color: color, change: -1, stop: stop, tripId: tripId, enabled: count > 0)
                stepButton("+", color: color, change: 1, stop: stop, tripId: tripId, enabled: count < 99)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 5)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 13).fill(Palette.sand))
    }

    private func stepButton(_ symbol: String, color: WineColor, change: Int, stop: WineStop,
                            tripId: String, enabled: Bool) -> some View {
        Button(intent: WineSetIntent(tripId: tripId, dayId: stop.dayId, activity: stop.key,
                                     color: color.rawValue, change: change)) {
            Text(symbol)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(symbol == "+" ? Palette.terracotta : (enabled ? Palette.ink : wineMuted))
                .frame(maxWidth: .infinity)
                .frame(height: 22)
                .background(RoundedRectangle(cornerRadius: 7).fill(Palette.background))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel((change > 0 ? "Add a " : "Remove a ") + color.label + " bottle")
    }

    private func totals(_ payload: WinePayload) -> some View {
        let total = WineColor.allCases.reduce(0) { $0 + (payload.totals[$1.rawValue] ?? 0) }
        return HStack(spacing: 10) {
            (Text("Trip total ") + Text("\(total) bottle\(total == 1 ? "" : "s")").foregroundColor(Palette.ink).bold())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
            ForEach(WineColor.allCases, id: \.self) { color in
                HStack(spacing: 3) {
                    Circle().fill(color.dot).frame(width: 6, height: 6)
                    Text("\(payload.totals[color.rawValue] ?? 0)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                }
            }
        }
    }
}

struct WineWidget: Widget {
    let kind = "WineWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WineProvider()) { entry in
            WineWidgetView(entry: entry)
        }
        .configurationDisplayName("Wine")
        .description("Log bottles at today's 🍷 stops. Admins: turn it on in Trips → Settings → Wine widget.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}
