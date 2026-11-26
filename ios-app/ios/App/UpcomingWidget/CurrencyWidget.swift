// The Currency widget (large, iOS 17): a USD converter that works without
// opening the app. Eight currency buttons across the top, each with a place
// under its code: every currency the next few trips use first (outlined, with
// a plane, under the trip city that spends it), then the common ones; the
// amount typed on the keypad, converted below it; Swap flips between
// USD → currency and currency → USD.
//
// Reads /widget-currency: USD rates (ExchangeRate-API, else the ECB through
// Frankfurter) and, per upcoming shared trip, the currencies it uses. The
// payload is kept on the phone, so a tap re-draws from it at once and the
// widget still converts with no signal; it's refetched at most every 30
// minutes. If the Worker can't be reached the rates come straight from
// ExchangeRate-API, without trip suggestions.
//
// The selection, direction and typed amount live in UserDefaults; the keypad,
// buttons and Swap are App Intents that change them (CurrencyStore).

import WidgetKit
import SwiftUI
import AppIntents

private let currencyEndpoint = "https://hardin-trips-ai.erikchardin.workers.dev/widget-currency"
private let currencyFallback = "https://open.er-api.com/v6/latest/USD"

// The common currencies, after any the trips suggest, with where they're spent
private let commonCurrencies = ["EUR", "GBP", "CAD", "HKD", "MXN", "JPY", "CHF", "AUD"]
private let commonPlaces: [String: String] = [
    "EUR": "Eurozone", "GBP": "UK", "CAD": "Canada", "HKD": "Hong Kong",
    "MXN": "Mexico", "JPY": "Japan", "CHF": "Switzerland", "AUD": "Australia",
]
// Two rows of four: there's no room for a third
private let chipCount = 8

// ── Data ─────────────────────────────────────────────────────────────────────

struct CurrencyTrip: Codable, Hashable {
    let id: String
    let name: String
    var emoji: String? = nil
    var daysUntil: Int? = nil
    let currencies: [String]
    var places: [String: String]? = nil   // currency → the trip city that spends it
}

struct CurrencyPayload: Codable {
    var updated: Double? = nil       // when the rates were published, unix seconds
    var source: String? = nil
    var rates: [String: Double]      // units of each currency per 1 USD
    var trips: [CurrencyTrip]? = nil
    var error: String? = nil
}

private struct OpenRatesPayload: Decodable {
    let result: String?
    let rates: [String: Double]?
    let time_last_update_unix: Double?
}

// ── What the widget remembers ────────────────────────────────────────────────

enum CurrencyStore {
    private static let defaults = UserDefaults.standard

    static func payload() -> CurrencyPayload? {
        guard let data = defaults.data(forKey: "currency.payload") else { return nil }
        return try? JSONDecoder().decode(CurrencyPayload.self, from: data)
    }

    static func save(_ payload: CurrencyPayload) {
        if let data = try? JSONEncoder().encode(payload) {
            defaults.set(data, forKey: "currency.payload")
            defaults.set(Date(), forKey: "currency.fetchedAt")
        }
    }

    static var fetchedAt: Date? { defaults.object(forKey: "currency.fetchedAt") as? Date }

    // nil until a button is tapped: then the first trip's currency, else EUR
    static var code: String? {
        get { defaults.string(forKey: "currency.code") }
        set { defaults.set(newValue, forKey: "currency.code") }
    }

    // false: USD → currency; true: currency → USD
    static var toUSD: Bool {
        get { defaults.bool(forKey: "currency.toUSD") }
        set { defaults.set(newValue, forKey: "currency.toUSD") }
    }

    // What's been typed, as typed ("125", "12.5", "0.")
    static var input: String {
        get { defaults.string(forKey: "currency.input") ?? "" }
        set { defaults.set(newValue, forKey: "currency.input") }
    }

    // One keypad key: a digit, "." , "del" or "clear". Up to 7 digits before
    // the point and 2 after.
    static func press(_ key: String) {
        var s = input
        switch key {
        case "del":
            if !s.isEmpty { s.removeLast() }
        case "clear":
            s = ""
        case ".":
            if !s.contains(".") { s = (s.isEmpty ? "0" : s) + "." }
        default:
            guard key.count == 1, key.first?.isNumber == true else { return }
            let parts = s.split(separator: ".", omittingEmptySubsequences: false)
            if parts.count == 2 {
                if parts[1].count < 2 { s += key }
            } else if s == "0" {
                s = key
            } else if s.count < 7 {
                s += key
            }
        }
        input = s
    }
}

// ── Timeline ─────────────────────────────────────────────────────────────────

struct CurrencyEntry: TimelineEntry {
    let date: Date
    let payload: CurrencyPayload?
    let storedCode: String?
    let toUSD: Bool
    let input: String

    static let sample = CurrencyEntry(
        date: Date(),
        payload: CurrencyPayload(
            updated: Date().addingTimeInterval(-7200).timeIntervalSince1970,
            source: "ExchangeRate-API",
            rates: ["USD": 1, "EUR": 0.92, "GBP": 0.79, "CAD": 1.39, "HKD": 7.78, "MXN": 18.3,
                    "JPY": 152, "CHF": 0.88, "AUD": 1.52, "THB": 34.5],
            trips: [CurrencyTrip(id: "a", name: "Amsterdam + Madrid", daysUntil: 33, currencies: ["EUR"],
                                 places: ["EUR": "Amsterdam"]),
                    CurrencyTrip(id: "b", name: "Southeast Asia", daysUntil: 90, currencies: ["THB"],
                                 places: ["THB": "Bangkok"])]
        ),
        storedCode: "EUR",
        toUSD: false,
        input: "125"
    )

    private var rates: [String: Double] { payload?.rates ?? [:] }

    // Every trip currency first (soonest trip first), then the common ones
    // in whatever buttons are left, eight in all, each with a rate. The
    // selected one always shows.
    var chips: [String] {
        var out: [String] = []
        for trip in payload?.trips ?? [] {
            for c in trip.currencies where rates[c] != nil && !out.contains(c) && out.count < chipCount {
                out.append(c)
            }
        }
        for c in commonCurrencies where rates[c] != nil && !out.contains(c) && out.count < chipCount {
            out.append(c)
        }
        if !out.contains(code), rates[code] != nil {
            if out.count >= chipCount { out.removeLast() }
            out.append(code)
        }
        return out
    }

    var tripCodes: Set<String> {
        Set((payload?.trips ?? []).flatMap { $0.currencies })
    }

    var code: String {
        if let c = storedCode, rates[c] != nil { return c }
        if let c = payload?.trips?.first?.currencies.first(where: { rates[$0] != nil }) { return c }
        return "EUR"
    }

    var rate: Double? { rates[code] }

    // The first trip that uses the selected currency
    var trip: CurrencyTrip? { payload?.trips?.first { $0.currencies.contains(code) } }

    // The small line under a button's code: the city on the first trip that
    // spends it, else where it's spent
    func place(_ code: String) -> String? {
        if let trip = payload?.trips?.first(where: { $0.currencies.contains(code) }),
           let city = trip.places?[code] {
            return city
        }
        return commonPlaces[code]
    }
}

struct CurrencyProvider: TimelineProvider {
    func placeholder(in context: Context) -> CurrencyEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (CurrencyEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        load { completion(entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CurrencyEntry>) -> Void) {
        load {
            let current = entry()
            let minutes = current.payload == nil ? 15 : 60
            completion(Timeline(entries: [current], policy: .after(Date().addingTimeInterval(TimeInterval(minutes * 60)))))
        }
    }

    private func entry() -> CurrencyEntry {
        CurrencyEntry(date: Date(), payload: CurrencyStore.payload(), storedCode: CurrencyStore.code,
                      toUSD: CurrencyStore.toUSD, input: CurrencyStore.input)
    }

    // A tap reloads the timeline: answer from the saved payload while it's
    // under 30 minutes old so the keypad keeps up
    private func load(_ done: @escaping () -> Void) {
        if CurrencyStore.payload() != nil, let at = CurrencyStore.fetchedAt, Date().timeIntervalSince(at) < 30 * 60 {
            done()
            return
        }
        fetchWorker { payload in
            if let payload = payload {
                CurrencyStore.save(payload)
                done()
                return
            }
            fetchFallback { payload in
                if let payload = payload {
                    // Keep the last trip suggestions when only the rates came through
                    var merged = payload
                    merged.trips = CurrencyStore.payload()?.trips
                    CurrencyStore.save(merged)
                }
                done()
            }
        }
    }

    private func fetchWorker(_ completion: @escaping (CurrencyPayload?) -> Void) {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        var components = URLComponents(string: currencyEndpoint)!
        components.queryItems = [URLQueryItem(name: "date", value: formatter.string(from: Date()))]
        var request = URLRequest(url: components.url!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data,
                  let payload = try? JSONDecoder().decode(CurrencyPayload.self, from: data),
                  payload.error == nil, !payload.rates.isEmpty else {
                completion(nil)
                return
            }
            completion(payload)
        }.resume()
    }

    private func fetchFallback(_ completion: @escaping (CurrencyPayload?) -> Void) {
        var request = URLRequest(url: URL(string: currencyFallback)!)
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data,
                  let r = try? JSONDecoder().decode(OpenRatesPayload.self, from: data),
                  r.result == "success", let rates = r.rates, !rates.isEmpty else {
                completion(nil)
                return
            }
            completion(CurrencyPayload(updated: r.time_last_update_unix, source: "ExchangeRate-API", rates: rates))
        }.resume()
    }
}

// ── Taps ─────────────────────────────────────────────────────────────────────

struct CurrencyPickIntent: AppIntent {
    static var title: LocalizedStringResource = "Pick a currency"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Currency") var code: String

    init() {}

    init(code: String) {
        self.code = code
    }

    func perform() async throws -> some IntentResult {
        CurrencyStore.code = code
        return .result()
    }
}

struct CurrencyKeyIntent: AppIntent {
    static var title: LocalizedStringResource = "Type on the currency keypad"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Key") var key: String

    init() {}

    init(key: String) {
        self.key = key
    }

    func perform() async throws -> some IntentResult {
        CurrencyStore.press(key)
        return .result()
    }
}

struct CurrencySwapIntent: AppIntent {
    static var title: LocalizedStringResource = "Swap the conversion direction"
    static var isDiscoverable: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
        CurrencyStore.toUSD.toggle()
        return .result()
    }
}

// ── Formatting ───────────────────────────────────────────────────────────────

private let currencySymbols: [String: String] = [
    "USD": "$", "EUR": "€", "GBP": "£", "CAD": "CA$", "HKD": "HK$", "MXN": "MX$", "JPY": "¥",
    "AUD": "A$", "NZD": "NZ$", "SGD": "S$", "THB": "฿", "KRW": "₩", "INR": "₹", "VND": "₫",
    "PHP": "₱", "TRY": "₺", "ILS": "₪", "BRL": "R$", "CNY": "CN¥", "TWD": "NT$",
]

// Currencies with no minor unit in everyday use
private let wholeCurrencies: Set<String> = [
    "JPY", "KRW", "VND", "IDR", "CLP", "ISK", "PYG", "UGX", "RWF", "KHR", "LAK", "MMK", "HUF", "COP",
]

private func symbol(_ code: String) -> String { currencySymbols[code] ?? code + " " }

private func grouped(_ value: Double, decimals: Int) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "en_US")
    f.numberStyle = .decimal
    f.minimumFractionDigits = decimals
    f.maximumFractionDigits = decimals
    return f.string(from: NSNumber(value: value)) ?? String(value)
}

private func money(_ code: String, _ value: Double) -> String {
    symbol(code) + grouped(value, decimals: wholeCurrencies.contains(code) ? 0 : 2)
}

// What was typed, with thousands separators and the point as typed
private func typed(_ code: String, _ input: String) -> String {
    if input.isEmpty { return symbol(code) + "1" }
    let parts = input.split(separator: ".", omittingEmptySubsequences: false)
    let whole = grouped(Double(parts[0]) ?? 0, decimals: 0)
    return symbol(code) + whole + (parts.count == 2 ? "." + parts[1] : "")
}

private func currencyName(_ code: String) -> String {
    Locale(identifier: "en_US").localizedString(forCurrencyCode: code) ?? code
}

private func ago(_ unix: Double?, now: Date) -> String {
    guard let unix = unix else { return "" }
    let minutes = max(0, Int(now.timeIntervalSince1970 - unix) / 60)
    if minutes < 60 { return "\(max(1, minutes))m ago" }
    if minutes < 48 * 60 { return "\(minutes / 60)h ago" }
    return "\(minutes / 1440)d ago"
}

// ── Views ────────────────────────────────────────────────────────────────────

private let keyFill = Palette.sand
private let actionFill = Color(hex: 0x2A322D)
private let currencyDim = Color(hex: 0x8E9B92)

struct CurrencyWidgetView: View {
    let entry: CurrencyEntry

    var body: some View {
        content
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(Palette.background, for: .widget)
    }

    @ViewBuilder private var content: some View {
        if let rate = entry.rate {
            VStack(spacing: 7) {
                chips
                display(rate: rate)
                keypad
                footer(rate: rate)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Currency")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Palette.ink)
                Text("Can’t load exchange rates yet. It’ll try again soon.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private var chips: some View {
        let codes = entry.chips
        let rows = [Array(codes.prefix(4)), Array(codes.dropFirst(4).prefix(4))].filter { !$0.isEmpty }
        let trips = entry.tripCodes
        return VStack(spacing: 5) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 5) {
                    ForEach(row, id: \.self) { code in
                        chip(code, selected: code == entry.code, trip: trips.contains(code))
                    }
                    // Keep a short last row's buttons the same width
                    ForEach(0..<(4 - row.count), id: \.self) { _ in
                        Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                    }
                }
            }
        }
    }

    private func chip(_ code: String, selected: Bool, trip: Bool) -> some View {
        let place = entry.place(code)
        return Button(intent: CurrencyPickIntent(code: code)) {
            VStack(spacing: 3) {
                HStack(spacing: 3) {
                    if trip {
                        Image(systemName: "airplane")
                            .font(.system(size: 8, weight: .bold))
                    }
                    Text(code)
                        .font(.system(size: 12, weight: .heavy))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .foregroundStyle(selected ? Palette.background : (trip ? Palette.terracotta : Palette.ink))
                if let place = place {
                    Text(place)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(selected ? Palette.background : Palette.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .padding(.horizontal, 3)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 9).fill(selected ? Palette.terracotta : keyFill))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .strokeBorder(Palette.terracotta, lineWidth: trip && !selected ? 1.5 : 0)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(currencyName(code) + (place.map { ", " + $0 } ?? "") + (trip ? ", on an upcoming trip" : ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func display(rate: Double) -> some View {
        let code = entry.code
        let from = entry.toUSD ? code : "USD"
        let to = entry.toUSD ? "USD" : code
        let amount = entry.input.isEmpty ? 1 : (Double(entry.input) ?? 0)
        let result = entry.toUSD ? amount / rate : amount * rate
        var caption = from + " → " + to + " · "
        if let trip = entry.trip {
            let days = trip.daysUntil ?? 0
            if let city = trip.places?[code] { caption += city + " · " }
            caption += trip.name + (days > 0 ? " · in \(days) day\(days == 1 ? "" : "s")" : " · now")
        } else {
            caption += currencyName(code)
        }
        return VStack(alignment: .leading, spacing: 1) {
            Text(caption.uppercased())
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
            Text(typed(from, entry.input))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(entry.input.isEmpty ? currencyDim : Palette.muted)
                .lineLimit(1)
                .padding(.top, 2)
            Text(money(to, result))
                .font(.system(size: 28, weight: .heavy))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 14).fill(keyFill))
    }

    // 7 8 9 ⌫ / 4 5 6 C / 1 2 3 Swap / 0 0 . Swap
    private var keypad: some View {
        GeometryReader { geo in
            let gap: CGFloat = 5
            let w = (geo.size.width - gap * 3) / 4
            let h = (geo.size.height - gap * 3) / 4
            VStack(spacing: gap) {
                HStack(spacing: gap) {
                    digit("7", w, h); digit("8", w, h); digit("9", w, h)
                    action(key: "del", w, h, label: "Delete last digit") {
                        Image(systemName: "delete.left").font(.system(size: 17, weight: .semibold))
                    }
                }
                HStack(spacing: gap) {
                    digit("4", w, h); digit("5", w, h); digit("6", w, h)
                    action(key: "clear", w, h, label: "Clear") {
                        Text("C").font(.system(size: 15, weight: .bold))
                    }
                }
                HStack(alignment: .top, spacing: gap) {
                    VStack(spacing: gap) {
                        HStack(spacing: gap) {
                            digit("1", w, h); digit("2", w, h); digit("3", w, h)
                        }
                        HStack(spacing: gap) {
                            digit("0", w * 2 + gap, h)
                            digit(".", w, h, label: "Decimal point")
                        }
                    }
                    swapKey(w, h * 2 + gap)
                }
            }
        }
    }

    private func digit(_ key: String, _ w: CGFloat, _ h: CGFloat, label: String? = nil) -> some View {
        Button(intent: CurrencyKeyIntent(key: key)) {
            Text(key)
                .font(.system(size: key == "." ? 20 : 18, weight: key == "." ? .bold : .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: w, height: h)
                .background(RoundedRectangle(cornerRadius: 10).fill(keyFill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label ?? key)
    }

    private func action<Face: View>(key: String, _ w: CGFloat, _ h: CGFloat, label: String,
                                    @ViewBuilder face: () -> Face) -> some View {
        Button(intent: CurrencyKeyIntent(key: key)) {
            face()
                .foregroundStyle(Palette.ink)
                .frame(width: w, height: h)
                .background(RoundedRectangle(cornerRadius: 10).fill(actionFill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func swapKey(_ w: CGFloat, _ h: CGFloat) -> some View {
        let code = entry.code
        return Button(intent: CurrencySwapIntent()) {
            VStack(spacing: 4) {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.system(size: 17, weight: .bold))
                Text("SWAP")
                    .font(.system(size: 11, weight: .heavy))
            }
            .foregroundStyle(Palette.background)
            .frame(width: w, height: h)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.terracotta))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(entry.toUSD ? "Convert USD to \(code)" : "Convert \(code) to USD")
    }

    private func footer(rate: Double) -> some View {
        let shown = rate < 10 ? String(format: "%.4f", rate) : String(format: "%.2f", rate)
        let when = ago(entry.payload?.updated, now: entry.date)
        let source = entry.payload?.source ?? ""
        return HStack(spacing: 8) {
            Text("1 USD = \(shown) \(entry.code)")
            Spacer(minLength: 0)
            Text([source, when].filter { !$0.isEmpty }.joined(separator: " · "))
                .lineLimit(1)
        }
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(Palette.muted)
        .lineLimit(1)
    }
}

struct CurrencyWidget: Widget {
    let kind = "CurrencyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CurrencyProvider()) { entry in
            CurrencyWidgetView(entry: entry)
        }
        .configurationDisplayName("Currency")
        .description("Convert to and from USD, with the currencies of your upcoming trips first.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}
