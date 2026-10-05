// Hardin Trips — Today home-screen widget.
//
// The current trip day at a glance: the city, then what's still ahead today.
// Reads the Worker's /widget-data (the same feed widget.js uses). Between
// trips it shows a countdown to the next one instead.
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

struct TodayActivity: Decodable, Hashable {
    let time: String?
    let timeSort: String?   // "HH:mm", or "" when untimed
    let emoji: String?
    let text: String?

    // Start time on the given day, or nil when the activity has no time
    func start(on day: Date) -> Date? {
        guard let parts = timeSort?.split(separator: ":"), parts.count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: day)
    }
}

private struct TodayDay: Decodable {
    let city: String?
    let description: String?
    let activities: [TodayActivity]?
}

private struct TodayPayload: Decodable {
    let trip: TodayTrip?
    let today: TodayDay?
    let error: String?
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let trip: TodayTrip?
    let city: String?
    let activities: [TodayActivity]?   // nil: no trip day today
    let failed: Bool

    // What's still ahead at this entry's time: untimed ones always count
    var remaining: [TodayActivity] {
        (activities ?? []).filter { a in
            guard let start = a.start(on: date) else { return true }
            return start.addingTimeInterval(activityGrace) > date
        }
    }

    func at(_ date: Date) -> TodayEntry {
        TodayEntry(date: date, trip: trip, city: city, activities: activities, failed: failed)
    }

    static let sample = TodayEntry(
        date: Date(),
        trip: TodayTrip(name: "Puerto Vallarta", emoji: "🏖️🌴", status: "active", daysUntil: 0),
        city: "Puerto Vallarta",
        activities: [
            TodayActivity(time: "9:00 AM", timeSort: "", emoji: "🥞", text: "Breakfast at the hotel"),
            TodayActivity(time: "11:30 AM", timeSort: "", emoji: "🚤", text: "Boat to Yelapa"),
            TodayActivity(time: "4:00 PM", timeSort: "", emoji: "🏖️", text: "Beach time"),
            TodayActivity(time: "1:00 PM", timeSort: "", emoji: "🐟", text: "Lunch on the beach"),
            TodayActivity(time: "4:00 PM", timeSort: "", emoji: "💆", text: "Spa"),
            TodayActivity(time: "7:30 PM", timeSort: "", emoji: "🌮", text: "Dinner at Pia Pia"),
            TodayActivity(time: "9:30 PM", timeSort: "", emoji: "🍹", text: "Drinks on the Malecón"),
        ],
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
            // One entry now, and one as each activity drops off, so the list
            // keeps up through the day without waiting on a refresh
            let dropOffs = (entry.activities ?? [])
                .compactMap { $0.start(on: now)?.addingTimeInterval(activityGrace) }
                .filter { $0 > now }
            let entries = [entry] + Set(dropOffs).sorted().map { entry.at($0) }

            // Refetch hourly (sooner after a failure), and just after midnight
            // for the new day. iOS treats this as a request, not a promise.
            let minutes = entry.failed ? 15 : 60
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
            completion(TodayEntry(date: Date(),
                                  trip: payload.trip,
                                  city: day.flatMap { ($0.description?.isEmpty == false) ? $0.description : $0.city },
                                  activities: day.map { $0.activities ?? [] },
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
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(Palette.background, for: .widget)
    }

    @ViewBuilder private var content: some View {
        if entry.failed {
            CenterMessage(text: "⚠️  Can't reach trips")
        } else if entry.activities == nil {
            // Not a trip day: count down to the next trip instead
            if let trip = entry.trip {
                NextTripMessage(trip: trip)
            } else {
                CenterMessage(text: "✈️  No upcoming trips")
            }
        } else {
            let remaining = entry.remaining
            let large = family == .systemLarge
            let limit = family == .systemSmall ? 2 : large ? 9 : 4
            VStack(alignment: .leading, spacing: large ? 7 : 3) {
                SectionLabel(text: header, extra: max(0, remaining.count - limit))
                // Large has room for the trip itself above the day's plan
                if large, let trip = entry.trip {
                    Text(String((trip.emoji ?? "✈️").prefix(2)) + "  " + (trip.name ?? "Trip"))
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.bottom, 2)
                }
                if remaining.isEmpty {
                    Text("That's everything for today")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .padding(.top, 4)
                } else {
                    ForEach(Array(remaining.prefix(limit)), id: \.self) {
                        ActivityRow(activity: $0, stacked: family == .systemSmall, large: large)
                    }
                }
            }
        }
    }

    // "TODAY · OAXACA"
    private var header: String {
        guard let city = entry.city, !city.isEmpty else { return "TODAY" }
        return "TODAY  ·  " + city.uppercased()
    }
}

// Medium/large: "9:00 AM  🥞 Breakfast at the hotel" (large in bigger type)
// Small, where it's narrow, puts the time on its own line above.
private struct ActivityRow: View {
    let activity: TodayActivity
    let stacked: Bool
    var large = false

    var body: some View {
        let time = activity.time ?? ""
        let label = HStack(spacing: 4) {
            Text(String((activity.emoji ?? "📌").prefix(1)))
                .font(.system(size: large ? 14 : 11))
                .fixedSize()
            Text(activity.text ?? "")
                .font(.system(size: large ? 15 : 12, weight: .bold))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        if stacked {
            VStack(alignment: .leading, spacing: 0) {
                if !time.isEmpty { timeText(time) }
                label
            }
            .padding(.vertical, 2)
        } else {
            HStack(spacing: 6) {
                timeText(time).frame(width: large ? 70 : 58, alignment: .leading)
                label
            }
        }
    }

    private func timeText(_ time: String) -> some View {
        Text(time)
            .font(.system(size: large ? 13 : 10, weight: .bold))
            .foregroundStyle(Palette.terracotta)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
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
            Text(countdown)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Palette.terracotta)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var countdown: String {
        if trip.status == "active" { return "Under way" }
        switch trip.daysUntil ?? 0 {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case let days: return "in \(days) days"
        }
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
