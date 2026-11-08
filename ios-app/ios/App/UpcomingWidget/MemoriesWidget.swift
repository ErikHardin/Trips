// Hardin Trips — Memories home-screen widget (large).
//
// A trip day from this time last year: where it was, a collage of up to six
// photos from that day's memories, and a line someone wrote about it. Reads
// the Worker's /widget-memories, which picks a day within about two weeks of
// today's date a year ago (else 2, 3… years ago, else any past day with
// photos) and changes the pick once a day. Tapping opens that trip day.
//
// Photos are downloaded here and shrunk before they're shown: a widget has
// very little memory, and full-size phone photos would be too big.
//
// Like the other widgets, this is compiled into the build: a change here
// ships with the next TestFlight upload, not with the website.

import WidgetKit
import SwiftUI
import ImageIO
import UIKit

private let memoriesEndpoint = "https://hardin-trips-ai.erikchardin.workers.dev/widget-memories"

// ── Data ─────────────────────────────────────────────────────────────────────

private struct MemoriesPayload: Decodable {
    struct Trip: Decodable {
        let id: String
        let name: String?
        let emoji: String?
    }
    struct Day: Decodable {
        let id: String
        let city: String?
        let dayNumber: Int?
        let dateLabel: String?
    }
    let header: String?
    let trip: Trip?
    let day: Day?
    let photos: [String]?
    let quote: String?
    let error: String?
}

struct MemoriesEntry: TimelineEntry {
    let date: Date
    var header: String = ""
    var title: String = ""       // "🇵🇹 Lisbon · Day 3"
    var subtitle: String = ""    // "Sat, Nov 8, 2025"
    var quote: String? = nil
    var images: [UIImage] = []
    var tripId: String? = nil
    var dayId: String? = nil
    var failed = false
    var empty = false

    // The trip at that day, as the other widgets open it
    var link: URL? {
        guard let tripId = tripId else { return nil }
        let plain = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        var items = [("trip", tripId)]
        if let dayId = dayId { items.append(("day", dayId)) }
        let query = items.map { key, value in
            key + "=" + (value.addingPercentEncoding(withAllowedCharacters: plain) ?? "")
        }.joined(separator: "&")
        return URL(string: "hardintrips://open?" + query)
    }

    // The widget gallery's preview: the layout with blank tiles
    static let sample = MemoriesEntry(date: Date(), header: "This time last year",
                                      title: "🇵🇹 Lisbon · Day 3", subtitle: "Sat, Nov 8, 2025",
                                      quote: "Best custard tarts of the trip.")
}

// ── Timeline ─────────────────────────────────────────────────────────────────

struct MemoriesProvider: TimelineProvider {
    func placeholder(in context: Context) -> MemoriesEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (MemoriesEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        fetch(completion: completion)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MemoriesEntry>) -> Void) {
        fetch { entry in
            // The Worker picks a new day each date, so refresh just after
            // midnight; sooner after a failure. iOS treats this as a request.
            let now = Date()
            let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(86400 + 5 * 60)
            let next = entry.failed ? now.addingTimeInterval(30 * 60) : midnight
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetch(completion: @escaping (MemoriesEntry) -> Void) {
        // The phone's date, not the Worker's (UTC is already tomorrow on a US evening)
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        var components = URLComponents(string: memoriesEndpoint)!
        components.queryItems = [URLQueryItem(name: "date", value: formatter.string(from: Date()))]

        var request = URLRequest(url: components.url!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data,
                  let payload = try? JSONDecoder().decode(MemoriesPayload.self, from: data),
                  payload.error == nil else {
                completion(MemoriesEntry(date: Date(), failed: true))
                return
            }
            guard let trip = payload.trip, let day = payload.day,
                  let urls = payload.photos, !urls.isEmpty else {
                completion(MemoriesEntry(date: Date(), empty: true))
                return
            }

            let place = [day.city, trip.name].compactMap { $0 }.first { !$0.isEmpty } ?? ""
            let title = [[trip.emoji ?? "", place].filter { !$0.isEmpty }.joined(separator: " "),
                         day.dayNumber.map { "Day \($0)" } ?? ""]
                .filter { !$0.isEmpty }.joined(separator: " · ")

            loadImages(Array(urls.prefix(6))) { images in
                completion(MemoriesEntry(date: Date(),
                                         header: payload.header ?? "From your trips",
                                         title: title,
                                         subtitle: day.dateLabel ?? "",
                                         quote: payload.quote,
                                         images: images,
                                         tripId: trip.id,
                                         dayId: day.id,
                                         empty: images.isEmpty))
            }
        }.resume()
    }

    // All the photos at once, each shrunk as it arrives; the big first tile
    // gets more pixels than the small ones. A photo that fails is left out.
    private func loadImages(_ urls: [String], completion: @escaping ([UIImage]) -> Void) {
        var images = [UIImage?](repeating: nil, count: urls.count)
        let lock = NSLock()
        let group = DispatchGroup()
        for (i, string) in urls.enumerated() {
            guard let url = URL(string: string) else { continue }
            group.enter()
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            URLSession.shared.dataTask(with: request) { data, _, _ in
                defer { group.leave() }
                guard let data = data, let image = downsample(data, maxPixels: i == 0 ? 800 : 420) else { return }
                lock.lock()
                images[i] = image
                lock.unlock()
            }.resume()
        }
        group.notify(queue: .global()) { completion(images.compactMap { $0 }) }
    }
}

// A photo no bigger than maxPixels on its long side, decoded straight to that
// size (never the full photo in memory), turned the right way up
private func downsample(_ data: Data, maxPixels: Int) -> UIImage? {
    let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
    let options = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ] as [CFString: Any] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
    return UIImage(cgImage: image)
}

// ── Views ────────────────────────────────────────────────────────────────────

struct MemoriesWidgetView: View {
    let entry: MemoriesEntry

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(Palette.background, for: .widget)
            .widgetURL(entry.link)
    }

    @ViewBuilder private var content: some View {
        if entry.failed {
            CenterMessage(text: "⚠️  Can't reach trips")
        } else if entry.empty {
            CenterMessage(text: "📷  No trip photos from\nthis time last year yet")
                .padding(.horizontal, 20)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.header.uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Palette.terracotta)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(entry.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text(entry.subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(Palette.muted)
                            .lineLimit(1)
                            .layoutPriority(-1)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 8)

                MemoryCollage(images: entry.images)
                    .padding(.horizontal, 4)
                    .padding(.bottom, entry.quote == nil ? 4 : 0)

                if let quote = entry.quote {
                    Text("“" + quote + "”")
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                }
            }
        }
    }
}

// The photos as one collage: a big first photo with two beside it, and the
// rest in a row underneath (fewer photos, simpler layouts)
//   ┌──────────┬────┐
//   │          │ 2  │
//   │    1     ├────┤
//   │          │ 3  │
//   ├────┬─────┼────┤
//   │ 4  │  5  │ 6  │
//   └────┴─────┴────┘
private struct MemoryCollage: View {
    let images: [UIImage]
    private let gap: CGFloat = 3

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let n = images.count
            if n == 0 {
                // The gallery preview: blank tiles in the same shape
                RoundedRectangle(cornerRadius: 5).fill(Palette.sand)
            } else if n == 1 {
                tile(0, w, h)
            } else if n == 2 {
                HStack(spacing: gap) {
                    tile(0, (w - gap) / 2, h)
                    tile(1, (w - gap) / 2, h)
                }
            } else {
                let hasRow = n >= 4
                let rowH = hasRow ? (h - gap) * 0.3 : 0
                let topH = hasRow ? h - gap - rowH : h
                let bigW = (w - gap) * 2 / 3
                let sideW = w - gap - bigW
                VStack(spacing: gap) {
                    HStack(spacing: gap) {
                        tile(0, bigW, topH)
                        VStack(spacing: gap) {
                            tile(1, sideW, (topH - gap) / 2)
                            tile(2, sideW, (topH - gap) / 2)
                        }
                    }
                    if hasRow {
                        let rest = Array(3..<n)
                        let cellW = (w - gap * CGFloat(rest.count - 1)) / CGFloat(rest.count)
                        HStack(spacing: gap) {
                            ForEach(rest, id: \.self) { i in tile(i, cellW, rowH) }
                        }
                    }
                }
            }
        }
    }

    private func tile(_ i: Int, _ width: CGFloat, _ height: CGFloat) -> some View {
        Image(uiImage: images[i])
            .resizable()
            .scaledToFill()
            .frame(width: width, height: height)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

// ── Widget ───────────────────────────────────────────────────────────────────

struct MemoriesWidget: Widget {
    let kind = "MemoriesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MemoriesProvider()) { entry in
            MemoriesWidgetView(entry: entry)
        }
        .configurationDisplayName("Memories")
        .description("Photos from a trip this time last year.")
        .supportedFamilies([.systemLarge])
        // The photos run close to the edges; the layout sets its own padding
        .contentMarginsDisabled()
    }
}
