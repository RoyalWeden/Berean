import SwiftUI
import BereanNotes
import BereanReference

/// Tag colours: a literal colour (hex, or a highlight name) wins; otherwise the 12-slot palette
/// (src/lib/tagPalette.ts HUE_STOPS with the light/dark saturation and lightness), else neutral.
enum TagColor {
    static let hueStops: [Double] = [0, 28, 45, 62, 96, 140, 170, 194, 214, 246, 280, 320]

    static func color(_ color: String?, slot: Int?, dark: Bool) -> Color {
        if let c = color?.trimmingCharacters(in: .whitespaces), !c.isEmpty, Int(c) == nil {
            if c.hasPrefix("#"), let rgb = hex(c) { return rgb }
            return Color.highlight(c)
        }
        guard let slot, slot >= 0, slot < hueStops.count else { return .secondary }
        let sat = (dark ? 0.62 : 0.68) + (slot % 2 == 1 ? -0.06 : 0.04)
        let light = (dark ? 0.64 : 0.42) + (slot % 3 == 1 ? 0.05 : slot % 3 == 2 ? -0.04 : 0)
        return hsl(hueStops[slot], sat, light)
    }

    static func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
        let c = (1 - abs(2 * l - 1)) * s, x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1)), m = l - c / 2
        let (r, g, b): (Double, Double, Double) = h < 60 ? (c, x, 0) : h < 120 ? (x, c, 0) : h < 180 ? (0, c, x) : h < 240 ? (0, x, c) : h < 300 ? (x, 0, c) : (c, 0, x)
        return Color(red: r + m, green: g + m, blue: b + m)
    }

    static func hex(_ s: String) -> Color? {
        var t = String(s.dropFirst())
        if t.count == 3 { t = t.map { "\($0)\($0)" }.joined() }
        guard t.count == 6, let v = UInt32(t, radix: 16) else { return nil }
        return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// A small "#name" chip in the tag's colour.
struct TagChip: View {
    @Environment(\.colorScheme) private var scheme
    let name: String
    let color: String?
    let slot: Int?
    var body: some View {
        let c = TagColor.color(color, slot: slot, dark: scheme == .dark)
        Text("#\(name)")
            .font(.caption.weight(.medium))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundStyle(c)
            .background(c.opacity(0.14), in: .capsule)
            .accessibilityLabel("Tag \(name)")
    }
}

/// "Tag John 3:16": choose existing tags (filterable) or create one, then add one member per tag.
struct TagPickerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let ranges: [TagRange]
    let label: String
    var kind = "verses"
    @State private var tags: [VerseTagSummary] = []
    @State private var chosen = Set<String>()
    @State private var query = ""
    @State private var error: String?
    @FocusState private var fieldFocused: Bool

    var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    var shown: [VerseTagSummary] { trimmed.isEmpty ? tags : tags.filter { $0.name.localizedCaseInsensitiveContains(trimmed) } }
    var canCreate: Bool { !trimmed.isEmpty && !tags.contains { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame } }

    var body: some View {
        NavigationStack {
            List {
                TextField("Find or create a tag", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .focused($fieldFocused)
                    .onSubmit { if canCreate { apply(newName: trimmed) } else if let only = shown.first, shown.count == 1 { chosen = [only.id]; apply(newName: nil) } }
                    .accessibilityLabel("Find or create a tag")
                if canCreate {
                    Button { apply(newName: trimmed) } label: { Label("Create “\(trimmed)” and Tag", systemImage: "plus") }
                }
                ForEach(shown) { t in
                    Button { if chosen.contains(t.id) { chosen.remove(t.id) } else { chosen.insert(t.id) } } label: {
                        HStack {
                            TagChip(name: t.name, color: t.color, slot: t.colorSlot)
                            Spacer()
                            Text("\(t.verseCount + t.chapterCount)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                            Image(systemName: chosen.contains(t.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen.contains(t.id) ? Color.accentColor : .secondary)
                        }.contentShape(.rect)
                    }.buttonStyle(.plain)
                }
                if tags.isEmpty && trimmed.isEmpty { Text("No tags yet. Type a name to create one.").foregroundStyle(.secondary) }
            }
            .navigationTitle("Tag \(label)")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add") { apply(newName: nil) }.disabled(chosen.isEmpty) }
            }
            .alert(error ?? "", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") {} }
        }
        .frame(minWidth: 380, minHeight: 420)
        .task { tags = (try? app.verseTags?.list()) ?? []; try? await Task.sleep(for: .milliseconds(150)); fieldFocused = true }
    }

    func apply(newName: String?) {
        do {
            try app.verseTags?.addMembers(tagIds: Array(chosen), newTagNames: newName.map { [$0] } ?? [], ranges: ranges, label: label, kind: kind)
            dismiss()
        } catch { self.error = "The tag could not be added. \(error.localizedDescription)" }
    }
}

/// Wrapping row of tag chips, each with its own context menu.
struct FlowChips<MenuContent: View>: View {
    let tags: [TagLite]
    @ViewBuilder let menu: (TagLite) -> MenuContent
    var body: some View {
        FlowLayout(spacing: 4) {
            ForEach(tags) { t in TagChip(name: t.name, color: t.color, slot: t.colorSlot).contextMenu { menu(t) } }
        }
    }
}

/// Minimal wrapping layout (left-aligned rows).
struct FlowLayout: Layout {
    var spacing: CGFloat = 4
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > maxW { y += rowH + spacing; x = 0; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); w = max(w, x - spacing)
        }
        return CGSize(width: proposal.width ?? w, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX { y += rowH + spacing; x = bounds.minX; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
