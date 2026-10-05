// Hardin Trips — Upcoming & To Book home-screen widget.
//
// Native port of widget-upcoming.js (the Scriptable widget): the next few trips
// with a day countdown, plus travel-tracker trips that still need flights,
// hotel or car booked. Same Worker endpoint, same palette, same layout, so the
// two can sit side by side and agree.
//
// Unlike the rest of the app, this is compiled into the build: a change here
// ships with the next TestFlight upload, not with the website.

import WidgetKit
import SwiftUI

private let upcomingURL = URL(string: "https://hardin-trips-ai.erikchardin.workers.dev/widget-upcoming?limit=4&months=12")!

// ── Data ─────────────────────────────────────────────────────────────────────

struct UpcomingTrip: Decodable, Hashable {
    let name: String?
    let emoji: String?
    let status: String?
    let daysUntil: Int?
}

struct OutstandingBooking: Decodable, Hashable {
    let name: String?
    let dates: String?
    let missing: [String]?
}

private struct UpcomingPayload: Decodable {
    let trips: [UpcomingTrip]?
    let outstanding: [OutstandingBooking]?
    let error: String?
}

struct UpcomingEntry: TimelineEntry {
    let date: Date
    let trips: [UpcomingTrip]
    let outstanding: [OutstandingBooking]
    let failed: Bool

    static let sample = UpcomingEntry(
        date: Date(),
        trips: [
            UpcomingTrip(name: "Puerto Vallarta", emoji: "🏖️🌴", status: "upcoming", daysUntil: 4),
            UpcomingTrip(name: "Sonoma", emoji: "🍷🧀", status: "upcoming", daysUntil: 26),
            UpcomingTrip(name: "Amsterdam + Madrid", emoji: "🇳🇱🇪🇸", status: "upcoming", daysUntil: 33),
        ],
        outstanding: [
            OutstandingBooking(name: "NYE trip", dates: "12/31-1/3", missing: ["flights", "hotel"]),
            OutstandingBooking(name: "Southeast Asia", dates: "2/24-3/11", missing: ["flights"]),
        ],
        failed: false
    )
}

struct UpcomingProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpcomingEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (UpcomingEntry) -> Void) {
        // The widget gallery preview shouldn't wait on the network
        if context.isPreview { completion(.sample); return }
        fetch(completion: completion)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingEntry>) -> Void) {
        fetch { entry in
            // iOS treats this as a request, not a promise: refreshes are budgeted.
            // Retry sooner after a failure so a dropped connection doesn't stick.
            let minutes = entry.failed ? 15 : 60
            let next = Date().addingTimeInterval(TimeInterval(minutes * 60))
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetch(completion: @escaping (UpcomingEntry) -> Void) {
        var request = URLRequest(url: upcomingURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, _, _ in
            // A Worker/Firebase error returns JSON too — don't mistake it for an
            // empty calendar
            guard let data = data,
                  let payload = try? JSONDecoder().decode(UpcomingPayload.self, from: data),
                  payload.error == nil else {
                completion(UpcomingEntry(date: Date(), trips: [], outstanding: [], failed: true))
                return
            }
            completion(UpcomingEntry(date: Date(),
                                     trips: payload.trips ?? [],
                                     outstanding: payload.outstanding ?? [],
                                     failed: false))
        }.resume()
    }
}

// ── Palette ──────────────────────────────────────────────────────────────────
// The deep-sage palette from widget-upcoming.js; see the contrast notes there.
// Shared with TodayWidget.swift, so the two widgets match.

enum Palette {
    static let background = Color(hex: 0x333D37)
    static let terracotta = Color(hex: 0xEB9163)
    static let ink        = Color(hex: 0xEAF0EC)
    static let muted      = Color(hex: 0xB0BCB3)
    static let sand       = Color(hex: 0x414D45)
}

extension Color {
    init(hex: UInt32) {
        self.init(red:   Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue:  Double(hex & 0xFF) / 255)
    }
}

private let bookingIcons = ["flights": "✈️", "hotel": "🏨", "car": "🚗"]

// ── Views ────────────────────────────────────────────────────────────────────

struct UpcomingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: UpcomingEntry

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
        } else if entry.trips.isEmpty && entry.outstanding.isEmpty {
            CenterMessage(text: "✈️  No upcoming trips")
        } else if family == .systemSmall {
            // Single column: one section above the other, and only what fits
            VStack(alignment: .leading, spacing: 4) {
                TripsSection(trips: Array(entry.trips.prefix(3)))
                BookingsSection(bookings: Array(entry.outstanding.prefix(2)),
                                extra: entry.outstanding.count - 2)
            }
        } else {
            // Medium is twice as wide, so the sections sit side by side
            HStack(alignment: .top, spacing: 10) {
                TripsSection(trips: Array(entry.trips.prefix(4)))
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !entry.outstanding.isEmpty {
                    BookingsSection(bookings: Array(entry.outstanding.prefix(3)),
                                    extra: entry.outstanding.count - 3)
                        .frame(width: 115, alignment: .leading)
                }
            }
        }
    }
}

struct SectionLabel: View {
    let text: String
    let extra: Int

    var body: some View {
        Text(extra > 0 ? "\(text)  ·  +\(extra)" : text)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(Palette.muted)
            .padding(.bottom, 1)
    }
}

private struct TripsSection: View {
    let trips: [UpcomingTrip]

    var body: some View {
        if !trips.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                SectionLabel(text: "TRIP COUNTDOWN", extra: 0)
                ForEach(trips, id: \.self) { TripRow(trip: $0) }
            }
        }
    }
}

private struct BookingsSection: View {
    let bookings: [OutstandingBooking]
    let extra: Int

    var body: some View {
        if !bookings.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                SectionLabel(text: "TO BOOK", extra: extra)
                ForEach(bookings, id: \.self) { BookingRow(booking: $0) }
            }
        }
    }
}

// "🇫🇷 France            13d"
private struct TripRow: View {
    let trip: UpcomingTrip

    var body: some View {
        HStack(spacing: 4) {
            // The field often holds several emoji ("🇩🇰🛳️🇬🇧"); two is what fits
            // without squashing the name
            Text(String((trip.emoji ?? "✈️").prefix(2)))
                .font(.system(size: 11))
                .lineLimit(1)
                .fixedSize()
            Text(trip.name ?? "Trip")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 4)
            Text(countdownLabel(trip))
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Palette.terracotta)
                .lineLimit(1)
                .fixedSize()
        }
    }

    // "Now" while a trip is under way, otherwise days until departure
    private func countdownLabel(_ trip: UpcomingTrip) -> String {
        if trip.status == "active" { return "Now" }
        let days = trip.daysUntil ?? 0
        return days == 0 ? "Today" : "\(days)d"
    }
}

// "Aspen        ✈️🏨"
// "Jan 5-8"
private struct BookingRow: View {
    let booking: OutstandingBooking

    var body: some View {
        HStack(spacing: 4) {
            VStack(alignment: .leading, spacing: 0) {
                Text(booking.name ?? "Trip")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let dates = booking.dates, !dates.isEmpty {
                    Text(dates)
                        .font(.system(size: 9))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            Spacer(minLength: 2)
            Text((booking.missing ?? []).map { bookingIcons[$0] ?? "•" }.joined())
                .font(.system(size: 10))
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 6).fill(Palette.sand))
    }
}

struct CenterMessage: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Palette.ink)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ── Widget ───────────────────────────────────────────────────────────────────

struct UpcomingWidget: Widget {
    let kind = "UpcomingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpcomingProvider()) { entry in
            UpcomingWidgetView(entry: entry)
        }
        .configurationDisplayName("Upcoming Trips")
        .description("Trip countdowns and the bookings still to make.")
        .supportedFamilies([.systemSmall, .systemMedium])
        // The layout sets its own padding, matching the Scriptable widget
        .contentMarginsDisabled()
    }
}
