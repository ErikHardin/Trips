// Hardin Trips — Today home-screen widget.
//
// The current trip day at a glance: the city and weather, then what's still
// ahead today, with the next activity highlighted. Large adds the hotel,
// today's flights, drive times and tomorrow's first plans. Reads the Worker's
// /widget-data (the same feed widget.js uses). Between trips it shows a
// countdown to the next one instead.
//
// Like UpcomingWidget, this is compiled into the build: a change here ships
// with the next TestFlight upload, not with the website.

import WidgetKit
import SwiftUI

private let todayEndpoint = "https://hardin-trips-ai.erikchardin.workers.dev/widget-data"

// An activity stays on the widget this long after it starts
private let activityGrace: TimeInterval = 30 * 60

// ── Data ─────────────────────────────────────────────────────────────────────

struct TodayTrip: Decodable, Hashable {
    let name: String?
    let emoji: String?
    let status: String?
    let daysUntil: Int?
}

// A drive activity's time: from the app's saved drive times, or the push
// cron's live traffic estimate (then also when to leave)
struct DriveInfo: Decodable, Hashable {
    let mins: Int?
    let leaveBy: String?
    let live: Bool?
}

struct TodayActivity: Decodable, Hashable {
    let time: String?
    let timeSort: String?   // "HH:mm", or "" when untimed
    let emoji: String?
    let text: String?
    var drive: DriveInfo? = nil

    // Start time on the given day, or nil when the activity has no time
    func start(on day: Date) -> Date? {
        guard let parts = timeSort?.split(separator: ":"), parts.count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: day)
    }
}

struct DayWeather: Decodable, Hashable {
    let text: String?   // "🌤️ Partly cloudy"
    let hi: Int?
    let lo: Int?

    // "🌤️ 64°/51°": just the icon, which is the first word
    var short: String {
        let icon = (text ?? "").split(separator: " ").first.map(String.init) ?? ""
        guard let hi = hi, let lo = lo else { return icon }
        return icon + " \(hi)°/\(lo)°"
    }
}

// "BA286 · SFO → LHR · 5:10pm" / "Delayed 30 min · Gate A12"
struct TodayFlight: Decodable, Hashable {
    let line: String?
    let detail: String?
    let alert: Bool?
}

// The trip ahead, for the large widget between trips (worker: widgetNextTrip)
struct NextWeatherDay: Decodable, Hashable {
    let label: String?   // "WED 7"
    let icon: String?
    let hi: Int?
    let lo: Int?
}

struct NextFlight: Decodable, Hashable {
    let name: String?     // who's on it, when the trip says
    let num: String?
    let route: String?    // "DEN → PVR"
    let time: String?     // departure, local
    let arrives: String?
    let status: String?   // "On time", "Delayed 25 min", "Canceled", "Scheduled"
    let gate: String?     // "Gate B31 · T2"
    let alert: Bool?
    let ok: Bool?
}

struct NextTripInfo: Decodable, Hashable {
    let datesLabel: String?   // "Wed Oct 7 – Sat Oct 17 · 10 nights"
    let weather: [NextWeatherDay]?
    let forecastFrom: String? // "Oct 14", when the trip is beyond the forecast
    let hotel: String?
    let checkIn: String?
    let flights: [NextFlight]?
}

private struct TodayDay: Decodable {
    let city: String?
    let description: String?
    let activities: [TodayActivity]?
    let weather: DayWeather?
    let hotel: String?
    let flights: [TodayFlight]?

    var label: String? { (description?.isEmpty == false) ? description : city }
}

private struct TodayPayload: Decodable {
    let trip: TodayTrip?
    let today: TodayDay?
    let tomorrow: TodayDay?
    let next: NextTripInfo?
    let error: String?
}

struct TomorrowPreview: Hashable {
    let city: String?
    let activities: [TodayActivity]
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let trip: TodayTrip?
    let city: String?
    let activities: [TodayActivity]?   // nil: no trip day today
    var weather: DayWeather? = nil
    var hotel: String? = nil
    var flights: [TodayFlight] = []
    var tomorrow: TomorrowPreview? = nil
    var next: NextTripInfo? = nil
    let failed: Bool

    // What's still ahead at this entry's time. A timed activity drops off a
    // while after it starts; an untimed one ("Check in") once a timed activity
    // after it in the itinerary has dropped off.
    var remaining: [TodayActivity] {
        let acts = activities ?? []
        let gone: (TodayActivity) -> Bool = { a in
            guard let start = a.start(on: date) else { return false }
            return start.addingTimeInterval(activityGrace) <= date
        }
        return acts.indices.filter { i in
            if acts[i].start(on: date) != nil { return !gone(acts[i]) }
            return !acts[(i + 1)...].contains(where: gone)
        }.map { acts[$0] }
    }

    // The next activity yet to start, for the "in 25 min" highlight
    var nextUp: TodayActivity? {
        remaining.first { ($0.start(on: date) ?? .distantPast) > date }
    }

    func at(_ date: Date) -> TodayEntry {
        TodayEntry(date: date, trip: trip, city: city, activities: activities,
                   weather: weather, hotel: hotel, flights: flights, tomorrow: tomorrow, next: next, failed: failed)
    }

    static let sample = TodayEntry(
        date: Date(),
        trip: TodayTrip(name: "London", emoji: "🇬🇧", status: "active", daysUntil: 0),
        city: "London",
        activities: [
            TodayActivity(time: "", timeSort: "", emoji: "🏨", text: "Check in at The Hoxton"),
            TodayActivity(time: "11am", timeSort: "", emoji: "☕", text: "Brunch at Dishoom King's Cross"),
            TodayActivity(time: "1pm", timeSort: "", emoji: "🏛️", text: "Explore the British Museum"),
            TodayActivity(time: "4pm", timeSort: "", emoji: "🍸", text: "Drinks at the Museum Tavern"),
            TodayActivity(time: "7:30pm", timeSort: "", emoji: "🚗", text: "Dinner in Windsor",
                          drive: DriveInfo(mins: 55, leaveBy: "6:25pm", live: true)),
        ],
        weather: DayWeather(text: "🌤️ Partly cloudy", hi: 64, lo: 51),
        hotel: "The Hoxton, Holborn",
        flights: [],
        tomorrow: TomorrowPreview(city: "Paris", activities: [
            TodayActivity(time: "9am", timeSort: "", emoji: "🚄", text: "Eurostar to Paris"),
            TodayActivity(time: "1pm", timeSort: "", emoji: "🖼️", text: "The Louvre"),
        ]),
        failed: false
    )
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        // The widget gallery preview shouldn't wait on the network
        if context.isPreview { completion(.sample); return }
        fetch(completion: completion)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        fetch { entry in
            let now = Date()
            // An entry now, then one as each activity starts (the highlight moves
            // on) and as each drops off, so the list keeps up through the day
            // without waiting on a refresh
            let starts = (entry.activities ?? []).compactMap { $0.start(on: now) }
            let changes = (starts + starts.map { $0.addingTimeInterval(activityGrace) }).filter { $0 > now }
            let entries = [entry] + Set(changes).sorted().map { entry.at($0) }

            // Refetch every 30 minutes on a trip day (drive times and flights
            // change), hourly otherwise, sooner after a failure, and just after
            // midnight for the new day. iOS treats this as a request, not a promise.
            // (also the day before a trip, when flight status and gates change)
            let soon = (entry.trip?.daysUntil ?? 99) <= 1
            let minutes = entry.failed ? 15 : (entry.activities != nil || soon ? 30 : 60)
            let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(86400 + 60)
            let next = min(now.addingTimeInterval(TimeInterval(minutes * 60)), midnight)
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }

    private func fetch(completion: @escaping (TodayEntry) -> Void) {
        // The phone's date, not the Worker's (UTC is already tomorrow on a US evening)
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        var components = URLComponents(string: todayEndpoint)!
        components.queryItems = [URLQueryItem(name: "date", value: formatter.string(from: Date()))]

        var request = URLRequest(url: components.url!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data,
                  let payload = try? JSONDecoder().decode(TodayPayload.self, from: data),
                  payload.error == nil else {
                completion(TodayEntry(date: Date(), trip: nil, city: nil, activities: nil, failed: true))
                return
            }
            let day = payload.today
            let tomorrow = payload.tomorrow.flatMap { t -> TomorrowPreview? in
                let acts = t.activities ?? []
                return acts.isEmpty ? nil : TomorrowPreview(city: t.label, activities: acts)
            }
            completion(TodayEntry(date: Date(),
                                  trip: payload.trip,
                                  city: day?.label,
                                  activities: day.map { $0.activities ?? [] },
                                  weather: day?.weather,
                                  hotel: day?.hotel,
                                  flights: day?.flights ?? [],
                                  tomorrow: tomorrow,
                                  next: payload.next,
                                  failed: false))
        }.resume()
    }
}

// ── Views ────────────────────────────────────────────────────────────────────

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    var body: some View {
        content
            .padding(.vertical, family == .systemLarge ? 14 : 10)
            .padding(.horizontal, family == .systemLarge ? 16 : 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(Palette.background, for: .widget)
    }

    @ViewBuilder private var content: some View {
        if entry.failed {
            CenterMessage(text: "⚠️  Can't reach trips")
        } else if entry.activities == nil {
            // Not a trip day: count down to the next trip instead
            if let trip = entry.trip {
                if family == .systemLarge, let next = entry.next {
                    NextTripLarge(trip: trip, next: next)
                } else {
                    NextTripMessage(trip: trip)
                }
            } else {
                CenterMessage(text: "✈️  No upcoming trips")
            }
        } else if family == .systemLarge {
            largeDay
        } else {
            compactDay
        }
    }

    // Small and medium: the header, then the next few activities, one line each
    private var compactDay: some View {
        let remaining = entry.remaining
        let small = family == .systemSmall
        let limit = small ? 2 : 4
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                SectionLabel(text: header, extra: max(0, remaining.count - limit))
                if !small, let weather = entry.weather {
                    Spacer(minLength: 4)
                    WeatherText(weather: weather, size: 10)
                }
            }
            if remaining.isEmpty {
                DoneForToday()
            } else {
                ForEach(Array(remaining.prefix(limit)), id: \.self) { a in
                    ActivityRow(activity: a, size: small ? .small : .medium,
                                isNext: !small && a == entry.nextUp, now: entry.date)
                }
            }
        }
    }

    // Large: the trip and weather, "TODAY · city", the hotel and flights, the
    // day's activities with room to wrap and their drive times, and tomorrow
    // when today runs short
    private var largeDay: some View {
        let remaining = entry.remaining
        // Rows that fit under the header block; each flight takes one
        let limit = max(3, 6 - entry.flights.count)
        let shown = Array(remaining.prefix(limit))
        let tomorrowRoom = 5 - shown.count
        return VStack(alignment: .leading, spacing: 6) {
            // The trip on top, with the weather beside it; "TODAY · city" under
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if let trip = entry.trip {
                    Text(String((trip.emoji ?? "✈️").prefix(2)) + "  " + (trip.name ?? "Trip"))
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 4)
                if let weather = entry.weather { WeatherText(weather: weather, size: 12) }
            }
            SectionLabel(text: header, extra: max(0, remaining.count - limit))
            if let hotel = entry.hotel, !hotel.isEmpty {
                Text("🏨  " + hotel)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
            }
            ForEach(entry.flights, id: \.self) { FlightRow(flight: $0) }
            if shown.isEmpty {
                DoneForToday()
            } else {
                ForEach(shown, id: \.self) { a in
                    ActivityRow(activity: a, size: .large, isNext: a == entry.nextUp, now: entry.date)
                }
            }
            // Once today is done, tomorrow is the main event: full rows, wrapped
            if tomorrowRoom >= 2, let tomorrow = entry.tomorrow {
                TomorrowSection(tomorrow: tomorrow, limit: shown.isEmpty ? 6 : min(tomorrowRoom, 4),
                                prominent: shown.isEmpty)
                    .padding(.top, 4)
            }
        }
    }

    // "TODAY · OAXACA"
    private var header: String {
        guard let city = entry.city, !city.isEmpty else { return "TODAY" }
        return "TODAY  ·  " + city.uppercased()
    }
}

private enum RowSize { case small, medium, large }

// Medium/large: "9:00am  🥞 Breakfast at the hotel", with its drive time under
// it on large. Small, where it's narrow, puts the time on its own line above.
// The next activity to start is highlighted with how long until it does.
private struct ActivityRow: View {
    let activity: TodayActivity
    let size: RowSize
    var isNext = false
    var now = Date()

    private var large: Bool { size == .large }

    var body: some View {
        let time = activity.time ?? ""
        let label = HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(String((activity.emoji ?? "📌").prefix(1)))
                .font(.system(size: large ? 14 : 11))
                .fixedSize()
            VStack(alignment: .leading, spacing: 1) {
                Text(activity.text ?? "")
                    .font(.system(size: large ? 14 : 12, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(large ? 2 : 1)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: large)
                if large, let drive = activity.drive, let line = driveLine(drive) {
                    Text(line)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(drive.leaveBy != nil ? Palette.terracotta : Palette.muted)
                        .lineLimit(1)
                }
            }
            if !large, size == .medium, let mins = activity.drive?.mins {
                Spacer(minLength: 2)
                Text("🚗 \(mins)m")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Palette.muted)
                    .fixedSize()
            }
        }
        Group {
            if size == .small {
                VStack(alignment: .leading, spacing: 0) {
                    if !time.isEmpty { timeText(time) }
                    label
                }
                .padding(.vertical, 2)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    VStack(alignment: .leading, spacing: 0) {
                        timeText(time)
                        if isNext, let start = activity.start(on: now) {
                            (Text("in ") + Text(start, style: .relative))
                                .font(.system(size: large ? 10 : 9, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                    }
                    .frame(width: large ? 66 : 56, alignment: .leading)
                    label
                }
            }
        }
        .padding(.vertical, isNext ? 3 : 0)
        .padding(.horizontal, isNext ? 5 : 0)
        .background(RoundedRectangle(cornerRadius: 7).fill(isNext ? Palette.sand : Color.clear))
        .padding(.horizontal, isNext ? -5 : 0)
    }

    // "🚗 55 min · leave by 6:25pm" (live traffic) or "🚗 55 min drive"
    private func driveLine(_ drive: DriveInfo) -> String? {
        guard let mins = drive.mins else { return nil }
        if let leave = drive.leaveBy { return "🚗 \(mins) min · leave by \(leave)" }
        return "🚗 \(mins) min drive"
    }

    private func timeText(_ time: String) -> some View {
        Text(time)
            .font(.system(size: large ? 13 : 10, weight: .bold))
            .foregroundStyle(Palette.terracotta)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }
}

// "🌤️ 64°/51°"
private struct WeatherText: View {
    let weather: DayWeather
    let size: CGFloat

    var body: some View {
        Text(weather.short)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .lineLimit(1)
            .fixedSize()
    }
}

// ✈️ "BA286 · SFO → LHR · 5:10pm" / "Delayed 30 min · Gate A12 · T2"
private struct FlightRow: View {
    let flight: TodayFlight

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("✈️").font(.system(size: 13))
            VStack(alignment: .leading, spacing: 1) {
                Text(flight.line ?? "Flight")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let detail = flight.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(flight.alert == true ? Palette.terracotta : Palette.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.sand))
    }
}

// "TOMORROW · PARIS", then its first few plans: muted and one line each under
// today's, or, once today is done, as full rows that wrap
private struct TomorrowSection: View {
    let tomorrow: TomorrowPreview
    let limit: Int
    var prominent = false

    private var label: String {
        guard let city = tomorrow.city, !city.isEmpty else { return "TOMORROW" }
        return "TOMORROW  ·  " + city.uppercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            SectionLabel(text: label, extra: max(0, tomorrow.activities.count - limit))
            ForEach(Array(tomorrow.activities.prefix(limit)), id: \.self) { a in
                if prominent {
                    ActivityRow(activity: a, size: .large)
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(a.time ?? "")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Palette.muted)
                            .lineLimit(1)
                            .frame(width: 66, alignment: .leading)
                        Text(String((a.emoji ?? "📌").prefix(1)) + " " + (a.text ?? ""))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Palette.muted)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

private struct DoneForToday: View {
    var body: some View {
        Text("That's everything for today")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Palette.muted)
            .padding(.top, 4)
    }
}

// "🇫🇷  France" / "in 13 days"
private struct NextTripMessage: View {
    let trip: TodayTrip

    var body: some View {
        VStack(spacing: 4) {
            Text(String((trip.emoji ?? "✈️").prefix(2)) + "  " + (trip.name ?? "Next trip"))
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Palette.ink)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.8)
            Text(tripCountdown(trip))
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Palette.terracotta)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// "in 13 days" / "Tomorrow" / "Today" / "Under way"
private func tripCountdown(_ trip: TodayTrip) -> String {
    if trip.status == "active" { return "Under way" }
    switch trip.daysUntil ?? 0 {
    case 0: return "Today"
    case 1: return "Tomorrow"
    case let days: return "in \(days) days"
    }
}

private let okGreen = Color(hex: 0x9FD3A8)

// Large, between trips: the trip itself across the top part, then the first
// five days' weather, the first night's hotel, and the outbound flights (two
// fit; any more are counted). Rows the trip has no data for are left out.
private struct NextTripLarge: View {
    let trip: TodayTrip
    let next: NextTripInfo

    private var flights: [NextFlight] { next.flights ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 3) {
                Text(String((trip.emoji ?? "✈️").prefix(4)))
                    .font(.system(size: flights.count > 1 ? 32 : 38))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(trip.name ?? "Next trip")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let label = next.datesLabel, !label.isEmpty {
                    Text(label)
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Text(tripCountdown(trip))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.terracotta)
            }
            .frame(maxWidth: .infinity)
            .frame(height: flights.count > 1 ? 124 : 146)

            VStack(alignment: .leading, spacing: 0) {
                weatherRow
                Spacer(minLength: 6)
                if let hotel = next.hotel, !hotel.isEmpty {
                    HStack(spacing: 8) {
                        Text("🏨").font(.system(size: 14))
                        Text(hotel)
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 4)
                        if let checkIn = next.checkIn {
                            Text(checkIn)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Palette.muted)
                                .lineLimit(1)
                                .fixedSize()
                        }
                    }
                    Spacer(minLength: 6)
                }
                if !flights.isEmpty { flightsBox }
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    // "WED 7 / ☀️ / 88° 76°" × 5, or when the forecast starts
    @ViewBuilder private var weatherRow: some View {
        let days = Array((next.weather ?? []).prefix(5))
        if !days.isEmpty {
            HStack(spacing: 0) {
                ForEach(days, id: \.self) { d in
                    VStack(spacing: 1) {
                        Text(d.label ?? "")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Palette.muted)
                        Text(d.icon ?? "")
                            .font(.system(size: 15))
                        (Text("\(d.hi ?? 0)° ").foregroundColor(Palette.ink)
                            + Text("\(d.lo ?? 0)°").foregroundColor(Palette.muted))
                            .font(.system(size: 11, weight: .bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.sand))
        } else if let from = next.forecastFrom {
            Text("🌤️  Forecast appears 16 days out (\(from))")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 10).fill(Palette.sand))
        }
    }

    private var flightsBox: some View {
        let shown = Array(flights.prefix(2))
        let more = flights.count - shown.count
        return VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(shown.enumerated()), id: \.offset) { index, flight in
                if index > 0 {
                    Rectangle()
                        .fill(Palette.background.opacity(0.6))
                        .frame(height: 1)
                        .padding(.leading, 24)
                }
                FlightLegRow(flight: flight)
            }
            if more > 0 {
                Text("+\(more) more flight\(more == 1 ? "" : "s")")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(Palette.muted)
                    .padding(.leading, 24)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Palette.sand))
    }
}

// ✈️ "Erik · UA1652 · DEN → PVR          9:40am"
//    "On time · Gate B31 · arrives 1:50pm"
private struct FlightLegRow: View {
    let flight: NextFlight

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 7) {
                Text("✈️").font(.system(size: 13))
                Text([flight.name, flight.num, flight.route]
                        .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 4)
                Text(flight.time ?? "")
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .fixedSize()
            }
            details
                .font(.system(size: 10.5, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.leading, 24)
        }
    }

    // Status in green (on time) or terracotta (delayed, canceled), then the rest
    private var details: Text {
        let status = flight.status ?? "Scheduled"
        let color = flight.ok == true ? okGreen : flight.alert == true ? Palette.terracotta : Palette.muted
        var rest: [String] = []
        if let gate = flight.gate, !gate.isEmpty { rest.append(gate) }
        else if status == "Scheduled" { rest.append("gate shown the day before") }
        if let arrives = flight.arrives, !arrives.isEmpty { rest.append("arrives " + arrives) }
        return Text(status).foregroundColor(color)
            + Text(rest.isEmpty ? "" : " · " + rest.joined(separator: " · ")).foregroundColor(Palette.muted)
    }
}

// ── Widget ───────────────────────────────────────────────────────────────────

struct TodayWidget: Widget {
    let kind = "TodayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today's city and what's still ahead on the trip.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
