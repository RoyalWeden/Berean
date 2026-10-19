import WidgetKit
import SwiftUI

/// "New Message" — a Home Screen / Lock Screen widget that opens Berean Chat with the composer
/// ready (TEST 2026-10-17: "the user should be able to make a widget for the berean chat so that it
/// can open for them to make a new message very quickly").
///
/// A widget can't host the web app, so it is a static launcher: tapping it opens
/// `<scheme>://chat/new`, which the app's deep-link router turns into a new message
/// (src/lib/deepLinks.ts, src/platform/ios/deepLinks.ts). The scheme comes ONLY from this
/// extension's Info.plist (`BereanURLScheme` = `$(BEREAN_URL_SCHEME)` from the same identity
/// xcconfig as the app), so Berean Dev's widget opens Berean Dev and Berean's opens Berean — no
/// hard-coded identity, no fallback to the other app. No message content is ever stored in the
/// timeline, and it never refreshes (there is nothing to update).
private enum Route {
    private static let scheme: String? = {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "BereanURLScheme") as? String, !s.isEmpty else { return nil }
        return s
    }()
    private static func url(_ path: String) -> URL? { scheme.flatMap { URL(string: "\($0)://\(path)") } }
    static let newMessage = url("chat/new")
    static let messages = url("chat")
    static let today = url("daily")
    /// "Berean" or "Berean Dev" — the identity's display name, like the Home Screen label.
    static let appName = (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Berean"
}

struct NewMessageEntry: TimelineEntry { let date: Date }

struct NewMessageProvider: TimelineProvider {
    func placeholder(in context: Context) -> NewMessageEntry { NewMessageEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (NewMessageEntry) -> Void) { completion(NewMessageEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NewMessageEntry>) -> Void) {
        completion(Timeline(entries: [NewMessageEntry(date: .now)], policy: .never))
    }
}

struct NewMessageView: View {
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "square.and.pencil").font(.system(size: 22, weight: .semibold))
            }
            .accessibilityLabel("New Berean message")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label(Route.appName, systemImage: "bubble.left.and.text.bubble.right").font(.headline)
                Text("New message").font(.caption)
            }
            .accessibilityElement(children: .combine)
        case .accessoryInline:
            Label("New Berean message", systemImage: "square.and.pencil")
        case .systemMedium:
            HStack(spacing: 12) {
                WidgetTile(title: "New Message", symbol: "square.and.pencil", url: Route.newMessage, prominent: true)
                WidgetTile(title: "Messages", symbol: "bubble.left.and.text.bubble.right", url: Route.messages, prominent: false)
            }
        case .systemLarge:
            VStack(alignment: .leading, spacing: 12) {
                Label(Route.appName, systemImage: "bubble.left.and.text.bubble.right.fill")
                    .font(.headline).foregroundStyle(.tint)
                WidgetTile(title: "New Message", symbol: "square.and.pencil", url: Route.newMessage, prominent: true)
                HStack(spacing: 12) {
                    WidgetTile(title: "Messages", symbol: "bubble.left.and.text.bubble.right", url: Route.messages, prominent: false)
                    WidgetTile(title: "Today's Note", symbol: "calendar", url: Route.today, prominent: false)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "bubble.left.and.text.bubble.right.fill")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.tint)
                Spacer(minLength: 0)
                Text(Route.appName).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                HStack(spacing: 6) {
                    Image(systemName: "square.and.pencil")
                    Text("New Message")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(Route.appName), new message")
        }
    }
}

/// One tappable action in the Medium / Large widget (each tile is its own link).
struct WidgetTile: View {
    let title: String
    let symbol: String
    let url: URL?
    let prominent: Bool
    var body: some View {
        let content = VStack(alignment: .leading, spacing: 6) {
            Image(systemName: symbol).font(.system(size: 22, weight: .semibold))
            Spacer(minLength: 0)
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .foregroundStyle(prominent ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        .background(prominent ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.secondary), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        if let url { Link(destination: url) { content } } else { content }
    }
}

struct NewMessageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BereanNewMessage", provider: NewMessageProvider()) { _ in
            NewMessageView()
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(Route.newMessage)
        }
        .configurationDisplayName("New Message")
        .description("Start a Berean Chat message or quick note — or open your messages and today's note.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct BereanWidgets: WidgetBundle {
    var body: some Widget { NewMessageWidget() }
}
