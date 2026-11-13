import SwiftUI
import BereanNotes

/// Tags (the existing Tags tab, as a native manager): every verse tag with its colour and how much it covers;
/// open a tag's verses, recolour, rename, merge into another tag, delete (refused while notes still mention "#tag").
struct TagManagerView: View {
    @Environment(AppModel.self) private var app
    @State private var tags: [VerseTagSummary] = []
    @State private var filter = ""
    @State private var renaming: VerseTagSummary?
    @State private var name = ""
    @State private var deleting: VerseTagSummary?
    @State private var blocked: (VerseTagSummary, Int)?
    @State private var newTag = false

    var shown: [VerseTagSummary] { filter.isEmpty ? tags : tags.filter { $0.name.localizedCaseInsensitiveContains(filter) } }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Filter tags", text: $filter).textFieldStyle(.plain)
            }
            .padding(.horizontal, 10).padding(.vertical, 7).background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 9))
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            List {
                if tags.isEmpty {
                    ContentUnavailableView("No tags yet", systemImage: "tag", description: Text("Tag a verse from its verse menu (Tag Verse…), or create a tag here."))
                }
                ForEach(shown) { t in
                    Button { app.openSearch("#\(t.name)") } label: {
                        HStack {
                            TagChip(name: t.name, color: t.color, slot: t.colorSlot)
                            Spacer()
                            Text(summary(t)).font(.caption).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }.contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .contextMenu { menu(t) }
                    #if os(iOS)
                    .swipeActions { Button("Delete", role: .destructive) { attemptDelete(t) } }
                    #endif
                }
            }
        }
        .navigationTitle("Tags")
        .toolbar { ToolbarItem { Button { name = ""; newTag = true } label: { Label("New Tag", systemImage: "plus") }.help("New tag") } }
        .task(id: app.tagsRevision) { tags = (try? app.verseTags?.list()) ?? [] }
        .alert("New Tag", isPresented: $newTag) {
            TextField("Name", text: $name)
            Button("Create") { _ = try? app.verseTags?.create(name) }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename Tag", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let t = renaming, !name.trimmingCharacters(in: .whitespaces).isEmpty { _ = try? app.verseTags?.rename(t.id, to: name) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("Delete #\(deleting?.name ?? "")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete Tag", role: .destructive) { if let t = deleting { attemptDelete(t, confirmed: true) }; deleting = nil }
        } message: { Text("The tag is removed from every verse it marks.") }
        .confirmationDialog("#\(blocked?.0.name ?? "") is used in \(blocked?.1 ?? 0) note(s)", isPresented: Binding(get: { blocked != nil }, set: { if !$0 { blocked = nil } }), titleVisibility: .visible) {
            Button("Delete Anyway", role: .destructive) { if let b = blocked { _ = try? app.verseTags?.delete(b.0.id, force: true) }; blocked = nil }
        } message: { Text("Notes keep their “#\(blocked?.0.name ?? "")” text; it just won't link to a tag.") }
    }

    func summary(_ t: VerseTagSummary) -> String {
        var parts: [String] = []
        if t.verseCount > 0 { parts.append("\(t.verseCount) verse\(t.verseCount == 1 ? "" : "s")") }
        if t.chapterCount > 0 { parts.append("\(t.chapterCount) chapter\(t.chapterCount == 1 ? "" : "s")") }
        return parts.isEmpty ? "Unused" : parts.joined(separator: " · ")
    }

    @ViewBuilder func menu(_ t: VerseTagSummary) -> some View {
        Button("Show Verses") { app.openSearch("#\(t.name)") }
        Button("Rename…") { name = t.name; renaming = t }
        Menu("Colour") {
            ForEach(0..<VerseTagsService.slotCount, id: \.self) { slot in
                Button { _ = try? app.verseTags?.setColorSlot(t.id, Double(slot)) } label: {
                    Label("Colour \(slot + 1)", systemImage: t.colorSlot == slot && t.color == nil ? "checkmark.circle.fill" : "circle.fill")
                }
            }
        }
        Menu("Merge Into") {
            ForEach(tags.filter { $0.id != t.id }) { o in Button("#\(o.name)") { _ = try? app.verseTags?.merge(t.id, into: o.id) } }
        }
        Divider()
        Button("Delete…", role: .destructive) { deleting = t }
    }

    func attemptDelete(_ t: VerseTagSummary, confirmed: Bool = false) {
        guard confirmed else { deleting = t; return }
        if case .blocked(let n, _)? = try? app.verseTags?.delete(t.id) { blocked = (t, n) }
    }
}
