import SwiftUI

/// Getting started — the native counterpart of the original first-launch flows (desktop
/// Onboarding.tsx / iPhone OnboardingFlow.tsx): welcome, default text and appearance, with the
/// same `onboardingCompleted` setting. Sync is not offered yet (native sync is not built).
struct OnboardingView: View {
    @Environment(AppModel.self) private var app
    @State private var page = 0
    private let pages = 3

    var body: some View {
        @Bindable var app = app
        VStack(spacing: 0) {
            Group {
                switch page {
                case 0: welcome
                case 1: defaultText
                default: appearance
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                    removal: .move(edge: .leading).combined(with: .opacity)))
            .id(page)
            HStack {
                // Always present (hidden on page 1) so the page dots stay centred.
                Button("Back") { withAnimation(.snappy) { page -= 1 } }
                    .opacity(page > 0 ? 1 : 0).disabled(page == 0)
                Spacer()
                HStack(spacing: 6) {
                    ForEach(0..<pages, id: \.self) { i in
                        Circle().fill(i == page ? Color.accentColor : Color.secondary.opacity(0.3)).frame(width: 7, height: 7)
                    }
                }
                .accessibilityElement().accessibilityLabel("Page \(page + 1) of \(pages)")
                Spacer()
                Button(page == pages - 1 ? "Start Studying" : "Continue") {
                    if page == pages - 1 { app.completeOnboarding() } else { withAnimation(.snappy) { page += 1 } }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
            .padding(20)
        }
        #if os(macOS)
        .frame(width: 520, height: 500)
        #endif
        .interactiveDismissDisabled()
    }

    private func header(_ symbol: String, _ title: String, _ text: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 52)).foregroundStyle(.tint).symbolRenderingMode(.hierarchical)
            Text(title).font(.largeTitle.bold()).multilineTextAlignment(.center)
            Text(text).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 28)
    }

    private var welcome: some View {
        VStack(spacing: 18) {
            header("book.pages", "Welcome to Berean",
                   "Read the KJV with Apocrypha, Brenton’s Septuagint, 1 Enoch, Jubilees and more — all offline — with Strong’s numbers, cross references, notes, highlights and verse tags.")
            #if os(macOS)
            Text("Press ⌘K to open a passage, a Strong’s number or a note. Select verses by their numbers; right-click for more.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 36)
            #else
            Text("Tap verses to select them; press and hold to select words. At the bottom: your tabs, search, and ••• for everything else.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 36)
            #endif
        }
    }

    private var defaultText: some View {
        @Bindable var app = app
        return VStack(spacing: 14) {
            header("text.book.closed", "Default Text", "Which text should new Scripture tabs open in? You can switch per tab any time.")
            VStack(spacing: 0) {
                let choices = availableTexts.filter { $0.section == "Bible" } + availableTexts.filter { $0.section != "Bible" }.prefix(2)
                ForEach(Array(choices.enumerated()), id: \.element.id) { index, text in
                    Button { app.defaultText = text.id } label: {
                        HStack {
                            Text(text.name)
                            Spacer()
                            if app.defaultText == text.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.interactivePlain)
                    .accessibilityAddTraits(app.defaultText == text.id ? .isSelected : [])
                    if index < choices.count - 1 { Divider().padding(.leading, 16) }
                }
            }
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 14))
            .frame(maxWidth: 420)
            .padding(.horizontal, 24)
        }
    }

    private var appearance: some View {
        @Bindable var app = app
        return VStack(spacing: 22) {
            header("circle.lefthalf.filled", "Appearance", "Follow the system, or pick light or dark. Fonts, text size and more live in Settings.")
            Picker("Appearance", selection: $app.theme) {
                Text("System").tag("system")
                Text("Light").tag("light")
                Text("Dark").tag("dark")
            }
            .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 300)
        }
    }
}
