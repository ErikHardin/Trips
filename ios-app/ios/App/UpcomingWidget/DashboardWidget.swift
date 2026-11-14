// Hardin Trips — Dashboard home-screen widget (Large).
//
// Native port of widget-dashboard.js, the combined Scriptable dashboard: the
// trip countdown and bookings still to make (the same /widget-upcoming feed as
// UpcomingWidget.swift), a weather strip for Denver, Cleveland and wherever the
// phone is when that's somewhere else, and the Parcel Pending pickup band.
//
// Taps: anywhere but the parcel band opens the app. The parcel band opens the
// Parcel Pending web app in Safari (SceneDelegate.swift hands
// hardintrips://parcels over), where the barcode is full screen; its ✓ marks
// the newest pending parcel picked up without leaving the home screen.
//
// The "here" row needs the app's location permission, set to "While Using the
// App or Widgets". SceneDelegate asks for it once this widget is on the home
// screen. Without it the strip shows the two standing cities, as it does at home.

import WidgetKit
import SwiftUI
import UIKit
import AppIntents
import CoreLocation
import CoreImage
import CoreImage.CIFilterBuiltins

private let dashTripsEndpoint = "https://hardin-trips-ai.erikchardin.workers.dev/widget-upcoming"
private let parcelDBRoot      = "https://parcelpending-e22a5-default-rtdb.firebaseio.com"

private let dashTripCount  = 4
private let dashBookCount  = 3
private let bookingMonths  = 12

// The two standing weather rows. Coordinates rather than names: these never
// change, so there's nothing to geocode.
private let standingCities = [
    DashPoint(label: "Denver", emoji: "🏠", lat: 39.7392, lon: -104.9903),
    DashPoint(label: "Cleveland", emoji: nil, lat: 41.4993, lon: -81.6944),
]
// A third row for where you are, only when that's this far from both
private let hereMinMiles = 25.0
private let forecastDays = 5
private let forecastDaysTight = 3

// Match the parcel web app: the code plus a trailing newline, which the kiosk
// scanner treats as Enter.
private let appendNewline = true

private let dividerColor = Color(hex: 0x5B6B60)

// ── Data ─────────────────────────────────────────────────────────────────────

struct DashPoint: Codable, Hashable {
    let label: String
    let emoji: String?
    let lat: Double
    let lon: Double
}

struct DashForecastDay: Hashable {
    let dow: String
    let sky: String
    let hi: Int
    let lo: Int
}

struct DashCityWeather: Hashable {
    let point: DashPoint
    var ok = false
    var sky = ""
    var now = 0
    var hi = 0
    var lo = 0
    var sun = ""
    var days: [DashForecastDay] = []

    var label: String {
        let name = point.label.uppercased()
        return point.emoji.map { "\($0) \(name)" } ?? name
    }
}

struct DashParcel: Decodable, Hashable {
    var key = ""
    let code: String?
    let count: Int?
    let done: Bool?
    let addedAt: String?

    private enum CodingKeys: String, CodingKey { case code, count, done, addedAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The web app has stored codes both as strings and as bare numbers
        if let s = try? c.decode(String.self, forKey: .code) { code = s }
        else if let n = try? c.decode(Int.self, forKey: .code) { code = String(n) }
        else { code = nil }
        count   = (try? c.decode(Int.self, forKey: .count)) ?? (try? c.decode(String.self, forKey: .count)).flatMap(Int.init)
        done    = try? c.decode(Bool.self, forKey: .done)
        addedAt = try? c.decode(String.self, forKey: .addedAt)
    }

    init(key: String, code: String, count: Int) {
        self.key = key; self.code = code; self.count = count; done = false; addedAt = nil
    }

    var displayCode: String { code ?? key }
}

private struct DashTripsPayload: Decodable {
    let trips: [UpcomingTrip]?
    let outstanding: [OutstandingBooking]?
    let error: String?
}

struct DashboardEntry: TimelineEntry {
    let date: Date
    let trips: [UpcomingTrip]
    let outstanding: [OutstandingBooking]
    let tripsFailed: Bool
    let weather: [DashCityWeather]
    let parcels: [DashParcel]   // pending, newest first

    static let sample: DashboardEntry = {
        func city(_ p: DashPoint, _ sky: String, _ now: Int, _ hi: Int, _ lo: Int) -> DashCityWeather {
            DashCityWeather(point: p, ok: true, sky: sky, now: now, hi: hi, lo: lo, sun: "↑6:43  ↓4:44",
                         days: [("SUN", "🌫️", 59, 32), ("MON", "☁️", 62, 36), ("TUE", "☁️", 62, 48),
                                ("WED", "⛅", 58, 48), ("THU", "☀️", 55, 44)]
                            .map { DashForecastDay(dow: $0.0, sky: $0.1, hi: $0.2, lo: $0.3) })
        }
        return DashboardEntry(
            date: Date(),
            trips: [
                UpcomingTrip(name: "Hawaii - Big Island", emoji: "🌴🌊🌺", status: "upcoming", daysUntil: 25, dates: "Dec 9 – Dec 13"),
                UpcomingTrip(name: "Southeast Asia", emoji: "🇭🇰🇻🇳🇰🇭🇹🇭", status: "upcoming", daysUntil: 104, dates: "Feb 26 – Mar 12"),
                UpcomingTrip(name: "Argentina", emoji: "🏔️🍷🇦🇷", status: "upcoming", daysUntil: 173, dates: "May 6 – May 11"),
            ],
            outstanding: [
                OutstandingBooking(name: "Houston", dates: "1/8/27-1/10/27", missing: ["flights"]),
                OutstandingBooking(name: "St. Louis", dates: "Feb 5 – Feb 7", missing: ["flights", "hotel", "car"]),
            ],
            tripsFailed: false,
            weather: [city(standingCities[0], "☁️", 40, 53, 34), city(standingCities[1], "☁️", 42, 42, 40)],
            parcels: [DashParcel(key: "sample", code: "79360010", count: 1)]
        )
    }()
}

// The last good copy of each feed, so a refresh with no signal shows slightly
// stale data instead of a blank panel. Lives in the extension's own defaults.
private enum DashCache {
    static let defaults = UserDefaults.standard

    static func get(_ key: String) -> Data? { defaults.data(forKey: "dash." + key) }
    static func set(_ key: String, _ data: Data) { defaults.set(data, forKey: "dash." + key) }
}

private func fetchData(_ url: URL) async -> Data? {
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 15
    guard let result = try? await URLSession.shared.data(for: request),
          (result.1 as? HTTPURLResponse)?.statusCode ?? 200 < 400 else { return nil }
    return result.0
}

enum DashboardLoader {
    static func load() async -> DashboardEntry {
        async let trips = loadTrips()
        async let parcels = loadParcels()
        async let weather = loadWeather(await weatherPoints())
        let (t, p, w) = await (trips, parcels, weather)
        return DashboardEntry(date: Date(), trips: t?.trips ?? [], outstanding: t?.outstanding ?? [],
                              tripsFailed: t == nil, weather: w, parcels: p)
    }

    // The phone's date, so countdowns don't jump a day early on a US evening
    private static func loadTrips() async -> DashTripsPayload? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        var components = URLComponents(string: dashTripsEndpoint)!
        components.queryItems = [URLQueryItem(name: "limit", value: String(dashTripCount)),
                                 URLQueryItem(name: "months", value: String(bookingMonths)),
                                 URLQueryItem(name: "date", value: formatter.string(from: Date()))]
        let decode = { (d: Data) -> DashTripsPayload? in
            guard let p = try? JSONDecoder().decode(DashTripsPayload.self, from: d), p.error == nil else { return nil }
            return p
        }
        if let data = await fetchData(components.url!), let payload = decode(data) {
            DashCache.set("trips", data)
            return payload
        }
        return DashCache.get("trips").flatMap(decode)
    }

    static func loadParcels() async -> [DashParcel] {
        let decode = { (d: Data) -> [DashParcel]? in
            // null when the list is empty
            if String(data: d, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "null" { return [] }
            guard let all = try? JSONDecoder().decode([String: DashParcel?].self, from: d) else { return nil }
            return all.compactMap { key, p -> DashParcel? in
                guard var p = p, p.done != true else { return nil }
                p.key = key
                return p
            }.sorted { ($0.addedAt ?? "") > ($1.addedAt ?? "") }
        }
        if let data = await fetchData(URL(string: parcelDBRoot + "/parcels.json")!), let list = decode(data) {
            DashCache.set("parcels", data)
            return list
        }
        let cached = DashCache.get("parcels").flatMap(decode) ?? []
        return cached.filter { !ParcelPickups.recent.contains($0.key) }
    }

    // ── Weather ──────────────────────────────────────────────────────────────

    // Denver and Cleveland always, plus where the phone is when that's
    // somewhere else. Two rows is the normal state at home.
    private static func weatherPoints() async -> [DashPoint] {
        var points = standingCities
        if let here = await HereLocator.currentPoint(),
           standingCities.allSatisfy({ milesBetween($0, here) > hereMinMiles }) {
            points.append(here)
        }
        return points
    }

    // One request for every row: Open-Meteo takes comma-separated coordinates
    // and answers with an array (an object, for a single point).
    private static func loadWeather(_ points: [DashPoint]) async -> [DashCityWeather] {
        let url = "https://api.open-meteo.com/v1/forecast"
            + "?latitude=" + points.map { String(format: "%.4f", $0.lat) }.joined(separator: ",")
            + "&longitude=" + points.map { String(format: "%.4f", $0.lon) }.joined(separator: ",")
            + "&current=temperature_2m,weather_code"
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset"
            + "&temperature_unit=fahrenheit&timezone=auto&forecast_days=\(forecastDays + 1)"

        let parse = { (d: Data) -> [[String: Any]]? in
            let json = try? JSONSerialization.jsonObject(with: d)
            if let list = json as? [[String: Any]] { return list }
            if let one = json as? [String: Any], one["error"] == nil { return [one] }
            return nil
        }
        var list: [[String: Any]]? = nil
        if let u = URL(string: url), let data = await fetchData(u), let parsed = parse(data) {
            list = parsed
            DashCache.set("weather", data)
            DashCache.defaults.set(url, forKey: "dash.weatherURL")
        } else if DashCache.defaults.string(forKey: "dash.weatherURL") == url {
            // Only for these same places: rows are labelled from `points`
            list = DashCache.get("weather").flatMap(parse)
        }
        return points.enumerated().map { i, p in
            guard let list = list, i < list.count else { return DashCityWeather(point: p) }
            return cityWeather(p, list[i])
        }
    }

    private static func cityWeather(_ p: DashPoint, _ w: [String: Any]) -> DashCityWeather {
        let current = w["current"] as? [String: Any]
        let daily = w["daily"] as? [String: Any]
        let codes = daily?["weather_code"] as? [Any] ?? []
        let highs = daily?["temperature_2m_max"] as? [Any] ?? []
        let lows  = daily?["temperature_2m_min"] as? [Any] ?? []
        let times = daily?["time"] as? [String] ?? []
        func num(_ a: [Any], _ i: Int) -> Double? { i < a.count ? (a[i] as? NSNumber)?.doubleValue : nil }

        guard let code = (current?["weather_code"] as? NSNumber)?.intValue ?? num(codes, 0).map { Int($0) },
              let now = (current?["temperature_2m"] as? NSNumber)?.doubleValue else { return DashCityWeather(point: p) }

        var days: [DashForecastDay] = []
        for i in 1..<max(1, times.count) {
            guard let hi = num(highs, i), let lo = num(lows, i), let c = num(codes, i) else { continue }
            days.append(DashForecastDay(dow: dowLabel(times[i]), sky: wxEmoji(Int(c)),
                                    hi: Int(hi.rounded()), lo: Int(lo.rounded())))
        }
        let rise = clockLabel((daily?["sunrise"] as? [String])?.first)
        let set  = clockLabel((daily?["sunset"] as? [String])?.first)
        return DashCityWeather(point: p, ok: true, sky: wxEmoji(code), now: Int(now.rounded()),
                            hi: Int((num(highs, 0) ?? now).rounded()), lo: Int((num(lows, 0) ?? now).rounded()),
                            sun: rise.isEmpty || set.isEmpty ? "" : "↑\(rise)  ↓\(set)", days: days)
    }

    // The times arrive as the city's local time with no offset ("2026-09-07T06:33"),
    // so they're read as text; a Date would re-read them in the phone's zone.
    private static func clockLabel(_ iso: String?) -> String {
        guard let iso = iso, let t = iso.split(separator: "T").last else { return "" }
        let parts = t.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]) else { return "" }
        return "\(h % 12 == 0 ? 12 : h % 12):\(parts[1])"
    }

    // The API dates each day in the city's own zone; read it in UTC so the label
    // can't slide a day when the phone is somewhere else.
    private static func dowLabel(_ iso: String) -> String {
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.timeZone = TimeZone(identifier: "UTC")
        parse.dateFormat = "yyyy-MM-dd"
        guard let d = parse.date(from: iso) else { return "" }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US_POSIX")
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "EEE"
        return out.string(from: d).uppercased()
    }

    // Icons straight from wxInfo() in index.html, so the widget and the app's
    // day cards never describe the same sky differently.
    private static func wxEmoji(_ code: Int) -> String {
        switch code {
        case 0: return "☀️"
        case ...2: return "⛅"
        case 3: return "☁️"
        case ...49: return "🌫️"
        case ...57: return "🌦️"
        case ...67: return "🌧️"
        case ...77: return "❄️"
        case ...82: return "🌧️"
        case ...86: return "🌨️"
        case ...99: return "⛈️"
        default: return "🌡️"
        }
    }

    private static func milesBetween(_ a: DashPoint, _ b: DashPoint) -> Double {
        let r = { (d: Double) in d * .pi / 180 }
        let dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon)
        let h = pow(sin(dLat / 2), 2) + cos(r(a.lat)) * cos(r(b.lat)) * pow(sin(dLon / 2), 2)
        return 7918 * asin(min(1, sqrt(h)))
    }
}

// Where the phone is, as a weather row. iOS gives a widget a location only when
// the app's permission allows widgets, and a background refresh can hang, so
// this gives up after a few seconds and falls back to the last fix of the day —
// which keeps the row steady while travelling instead of flickering in and out.
@MainActor
final class HereLocator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    private static let cacheKey = "dash.here"

    static func currentPoint() async -> DashPoint? {
        let locator = HereLocator()
        if let loc = await locator.locate() {
            var label = "Here"
            if let place = try? await CLGeocoder().reverseGeocodeLocation(loc).first {
                label = place.locality ?? place.subAdministrativeArea ?? place.administrativeArea ?? label
            }
            let point = DashPoint(label: label, emoji: "📍", lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            if let data = try? JSONEncoder().encode(point) {
                DashCache.defaults.set(data, forKey: cacheKey)
                DashCache.defaults.set(Date(), forKey: cacheKey + ".at")
            }
            return point
        }
        guard let at = DashCache.defaults.object(forKey: cacheKey + ".at") as? Date,
              Date().timeIntervalSince(at) < 12 * 3600,
              let data = DashCache.defaults.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(DashPoint.self, from: data)
    }

    private func locate() async -> CLLocation? {
        guard manager.isAuthorizedForWidgetUpdates else { return nil }
        manager.delegate = self
        // Weather is a city-scale question; the coarse fix is faster and spares the GPS
        manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        return await withCheckedContinuation { c in
            continuation = c
            manager.requestLocation()
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                self?.finish(nil)
            }
        }
    }

    private func finish(_ loc: CLLocation?) {
        continuation?.resume(returning: loc)
        continuation = nil
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let loc = locations.last
        Task { @MainActor in self.finish(loc) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }
}

struct DashboardProvider: TimelineProvider {
    func placeholder(in context: Context) -> DashboardEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (DashboardEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        Task { completion(await DashboardLoader.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DashboardEntry>) -> Void) {
        Task {
            let entry = await DashboardLoader.load()
            // A request, not a promise: iOS budgets refreshes. Sooner after a failure.
            let minutes = entry.tripsFailed ? 15 : 30
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(TimeInterval(minutes * 60)))))
        }
    }
}

// ── Taps ─────────────────────────────────────────────────────────────────────

// Parcels marked picked up from the widget in the last day. A fresh read of
// Firebase already knows, but a refresh with no signal falls back to the cached
// copy from before the tap, and the parcel shouldn't reappear from there.
enum ParcelPickups {
    private static let key = "dash.pickups"

    static var recent: Set<String> {
        let all = DashCache.defaults.dictionary(forKey: key) as? [String: Date] ?? [:]
        return Set(all.filter { Date().timeIntervalSince($0.value) < 24 * 3600 }.keys)
    }

    static func add(_ parcelKey: String) {
        var all = DashCache.defaults.dictionary(forKey: key) as? [String: Date] ?? [:]
        all = all.filter { Date().timeIntervalSince($0.value) < 24 * 3600 }
        all[parcelKey] = Date()
        DashCache.defaults.set(all, forKey: key)
    }
}

struct ParcelPickedUpIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark a parcel picked up"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Parcel") var parcelKey: String

    init() {}

    init(parcelKey: String) {
        self.parcelKey = parcelKey
    }

    func perform() async throws -> some IntentResult {
        let plain = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        guard let encoded = parcelKey.addingPercentEncoding(withAllowedCharacters: plain),
              let url = URL(string: parcelDBRoot + "/parcels/" + encoded + ".json") else { return .result() }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["done": true, "doneAt": iso.string(from: Date())])
        request.timeoutInterval = 15
        let (_, response) = try await URLSession.shared.data(for: request)
        // Only hide it once Firebase took it, so a failed tap leaves the button there to retry
        if (response as? HTTPURLResponse)?.statusCode ?? 500 < 400 { ParcelPickups.add(parcelKey) }
        return .result()
    }
}

// ── Views ────────────────────────────────────────────────────────────────────

private let appURL = URL(string: "hardintrips://open")
private let parcelsURL = URL(string: "hardintrips://parcels")

struct DashboardWidgetView: View {
    let entry: DashboardEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topColumns
            DashDivider()
            WeatherSection(weather: entry.weather)
            DashDivider()
            ParcelBand(parcels: entry.parcels)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(Palette.background, for: .widget)
        .widgetURL(appURL)
    }

    // The bookings column is the taller one once it's full; a fourth trip only
    // fits beside a shorter one
    private var tripLimit: Int { entry.outstanding.count >= dashBookCount ? 3 : dashTripCount }

    @ViewBuilder private var topColumns: some View {
        if entry.tripsFailed {
            Text("⚠️  Can't reach trips")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.ink)
        } else if entry.trips.isEmpty && entry.outstanding.isEmpty {
            Text("✈️  No upcoming trips")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.ink)
        } else {
            HStack(alignment: .top, spacing: 12) {
                if !entry.trips.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: "TRIP COUNTDOWN", extra: 0)
                        ForEach(Array(entry.trips.prefix(tripLimit)), id: \.self) { DashTripRow(trip: $0) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !entry.outstanding.isEmpty {
                    let shown = Array(entry.outstanding.prefix(dashBookCount))
                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: "TO BOOK", extra: entry.outstanding.count - shown.count)
                        ForEach(shown, id: \.self) { BookingRow(booking: $0) }
                    }
                    .frame(width: 120, alignment: .leading)
                }
            }
        }
    }
}

// A hairline between sections, with the slack split evenly around each one
private struct DashDivider: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 4)
            Rectangle().fill(dividerColor).frame(height: 1)
            Spacer(minLength: 4)
        }
    }
}

// "🌴🌊🌺  Hawaii - Big Island    25d"
// "        Dec 9 – Dec 13"
private struct DashTripRow: View {
    let trip: UpcomingTrip

    var body: some View {
        HStack(spacing: 5) {
            // A fixed box so a four-flag cluster can't push the name into an
            // ellipsis; inside it the emoji scale down instead
            Text(trip.emoji ?? "✈️")
                .font(.system(size: 11))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: 50, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                Text(trip.name ?? "Trip")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let dates = trip.dates, !dates.isEmpty {
                    Text(dates)
                        .font(.system(size: 9))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            Spacer(minLength: 4)
            Text(countdown)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Palette.terracotta)
                .lineLimit(1)
                .fixedSize()
        }
    }

    private var countdown: String {
        if trip.status == "active" { return "Now" }
        let days = trip.daysUntil ?? 0
        return days == 0 ? "Today" : "\(days)d"
    }
}

// One full-width row per city. Three cities can't hold five days at a readable
// size, so the away layout drops to a tighter row and three days.
private struct WeatherSection: View {
    let weather: [DashCityWeather]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: "WEATHER NOW", extra: 0)
            ForEach(weather, id: \.self) { wx in
                if weather.count > 2 { CityLine(wx: wx) } else { CityRow(wx: wx) }
            }
        }
    }
}

// Days that didn't arrive keep their columns with a dash, so the rows stay the
// same height and a gap reads as "that bit didn't load".
private func forecastSlots(_ wx: DashCityWeather, _ count: Int) -> [DashForecastDay?] {
    var days: [DashForecastDay?] = Array(wx.days.prefix(count))
    while days.count < count { days.append(nil) }
    return days
}

// "🏠 DENVER  ↑6:43 ↓4:44     SUN  MON  TUE  WED  THU"
// "☁️ 40°  53°/34°            🌫️   ☁️   ☁️   ☁️   ☁️"
// "                           59/32 …"
private struct CityRow: View {
    let wx: DashCityWeather

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(wx.label)
                        .font(.system(size: 10, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if !wx.sun.isEmpty {
                        Spacer(minLength: 2)
                        Text(wx.sun)
                            .font(.system(size: 8))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                .foregroundStyle(Palette.muted)
                HStack(spacing: 5) {
                    Text(wx.ok ? wx.sky : "—").font(.system(size: 18))
                    if wx.ok {
                        Text("\(wx.now)°")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Text("\(wx.hi)°/\(wx.lo)°")
                            .font(.system(size: 10))
                            .foregroundStyle(Palette.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
            }
            .frame(width: 122, alignment: .leading)
            Spacer(minLength: 4)
            HStack(spacing: 4) {
                ForEach(Array(forecastSlots(wx, forecastDays).enumerated()), id: \.offset) { _, d in
                    VStack(spacing: 2) {
                        Text(d?.dow ?? " ")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(Palette.muted)
                        Text(d?.sky ?? "—").font(.system(size: 13))
                        Text(d.map { "\($0.hi)/\($0.lo)" } ?? " ")
                            .font(.system(size: 9))
                            .foregroundStyle(Palette.ink)
                            .minimumScaleFactor(0.7)
                    }
                    .lineLimit(1)
                    .frame(width: 29)
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Palette.sand))
    }
}

// The away row: today on one line, then three two-line chips
private struct CityLine: View {
    let wx: DashCityWeather

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(wx.label)
                    .font(.system(size: 9, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if !wx.sun.isEmpty {
                    Text(wx.sun)
                        .font(.system(size: 8))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .foregroundStyle(Palette.muted)
            .frame(width: 78, alignment: .leading)
            Spacer(minLength: 4)
            Text(wx.ok ? wx.sky : "—").font(.system(size: 15))
            if wx.ok {
                Text("\(wx.now)°")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .padding(.leading, 4)
                Text("\(wx.hi)/\(wx.lo)")
                    .font(.system(size: 9))
                    .foregroundStyle(Palette.muted)
                    .padding(.leading, 5)
            }
            Spacer(minLength: 4)
            HStack(spacing: 6) {
                ForEach(Array(forecastSlots(wx, forecastDaysTight).enumerated()), id: \.offset) { _, d in
                    VStack(spacing: 0) {
                        Text(d?.dow ?? " ")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(Palette.muted)
                        HStack(spacing: 3) {
                            Text(d?.sky ?? "—").font(.system(size: 10))
                            Text(d.map { "\($0.hi)/\($0.lo)" } ?? " ")
                                .font(.system(size: 9))
                                .foregroundStyle(Palette.ink)
                                .minimumScaleFactor(0.7)
                        }
                    }
                    .lineLimit(1)
                    .frame(width: 44)
                }
            }
        }
        .lineLimit(1)
        .padding(.vertical, 7)
        .padding(.horizontal, 10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.sand))
    }
}

// "📦  1 package waiting      [||| |||]  ✓"
//      #79360010
private struct ParcelBand: View {
    let parcels: [DashParcel]

    var body: some View {
        // The button sits beside the link rather than inside it, so a tap on ✓
        // can't also open Safari
        HStack(spacing: 8) {
            Link(destination: parcelsURL!) {
                HStack(spacing: 8) {
                    Text("📦").font(.system(size: 14))
                    if let first = parcels.first {
                        waiting(first)
                    } else {
                        Text("All picked up 🎉")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Palette.muted)
                        Spacer(minLength: 0)
                    }
                }
            }
            if let first = parcels.first {
                // Marks the newest one picked up; the rest stay for the web app
                Button(intent: ParcelPickedUpIntent(parcelKey: first.key)) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Palette.background)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(Palette.terracotta))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.sand))
    }

    @ViewBuilder private func waiting(_ first: DashParcel) -> some View {
        let total = parcels.reduce(0) { $0 + max(1, $1.count ?? 1) }
        VStack(alignment: .leading, spacing: 1) {
            Text("\(total) package\(total == 1 ? "" : "s") waiting")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Palette.terracotta)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text("#\(first.displayCode)" + (parcels.count > 1 ? "  ·  +\(parcels.count - 1) more" : ""))
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        Spacer(minLength: 4)
        if let image = barcodeImage(first.displayCode + (appendNewline ? "\n" : "")) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .frame(width: 120, height: 32)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 3))
        }
    }
}

// CODE128 by Core Image, with a white quiet zone either side for the scanner
private func barcodeImage(_ text: String) -> UIImage? {
    let filter = CIFilter.code128BarcodeGenerator()
    filter.message = Data(text.utf8)
    filter.quietSpace = 8
    filter.barcodeHeight = 32
    guard let output = filter.outputImage,
          let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
    return UIImage(cgImage: cg)
}

// ── Widget ───────────────────────────────────────────────────────────────────

struct DashboardWidget: Widget {
    let kind = "DashboardWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DashboardProvider()) { entry in
            DashboardWidgetView(entry: entry)
        }
        .configurationDisplayName("Dashboard")
        .description("Trip countdowns, bookings to make, weather in Denver and Cleveland (and where you are), and parcels to pick up.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
