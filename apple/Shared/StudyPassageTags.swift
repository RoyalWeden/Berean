import SwiftUI
import BereanNotes
import BereanReference

/// Personal labels live beside the study notes, outside the Scripture reading run.
/// Tag locations remain translation-agnostic, as in the legacy service.
struct StudyPassageTags: View {
    @Environment(AppModel.self) private var app
    let bookId: String
    let chapter: Int
    let textId: String
    let verse: Int?
    var selectedVerses: Set<Int> = []
    @State private var chapterTags: [TagLite] = []
    @State private var passageTags: [TagLite] = []
    @State private var members: [TagMemberDetail] = []
    @State private var loadedKey: String?
    @State private var tagging = false

    private var selection: Set<Int> { selectedVerses.isEmpty ? Set(verse.map { [$0] } ?? []) : selectedVerses }
    private var loadKey: String { "\(bookId)|\(chapter)|\(selection.sorted())|\(app.tagsRevision)" }
    private var label: String {
        let chapterLabel = Reference.readerChapterLabel(bookId, chapter, textId: textId)
        guard !selection.isEmpty else { return chapterLabel }
        return chapterLabel + ":" + consecutiveVerseRuns(selection).map {
            $0.lowerBound == $0.upperBound ? String($0.lowerBound) : "\($0.lowerBound)–\($0.upperBound)"
        }.joined(separator: ", ")
    }

    var body: some View {
        Group {
            StudyPanelSection("Tags") {
                if loadedKey == loadKey, !passageTags.isEmpty {
                    tagChips(passageTags, chapterOnly: false)
                }
                Button { tagging = true } label: {
                    Label(selection.isEmpty ? "Tag Chapter…" : "Tag Selected Verses…", systemImage: "tag")
                }
                .buttonStyle(.interactivePlain)
            }
            if loadedKey == loadKey, !chapterTags.isEmpty {
                StudyPanelSection("Chapter Tags") { tagChips(chapterTags, chapterOnly: true) }
            }
        }
        .task(id: loadKey) {
            let key = loadKey
            let result = try? app.verseTags?.forChapter(bookId, chapter)
            let relevant = result?.verseTags.filter { selection.isEmpty || selection.contains($0.key) }.values.flatMap { $0 } ?? []
            var seen = Set<String>()
            let tags = relevant.filter { seen.insert($0.id).inserted }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            let chapterLabels = result?.chapterTags ?? []
            let locations = (try? app.verseTags?.members(Array(Set((tags + chapterLabels).map(\.id))))) ?? []
            guard !Task.isCancelled, key == loadKey else { return }
            passageTags = tags
            chapterTags = chapterLabels
            members = locations
            loadedKey = key
        }
        .sheet(isPresented: $tagging) {
            TagPickerView(ranges: [TagRange(bookId: bookId, chapter: Double(chapter),
                                          spans: selection.isEmpty ? nil : consecutiveVerseRuns(selection).map { (Double($0.lowerBound), Double($0.upperBound)) },
                                          whole: selection.isEmpty ? true : nil)],
                          label: label, kind: selection.isEmpty ? "chapter" : "verses")
        }
    }

    private func tagChips(_ tags: [TagLite], chapterOnly: Bool) -> some View {
        FlowLayout {
            ForEach(tags) { tag in
                Button { app.openSearch("#\(tag.name)", reuseTab: true) } label: {
                    TagChip(name: tag.name, color: tag.color, slot: tag.colorSlot)
                        .padding(.vertical, 5)
                        .contentShape(.rect)
                }
                .buttonStyle(.interactivePlain)
                .accessibilityLabel("Search tag \(tag.name)")
                .contextMenu {
                    Button("Search #\(tag.name)", systemImage: "magnifyingglass") {
                        app.openSearch("#\(tag.name)", reuseTab: true)
                    }
                    ForEach(members.filter { member in
                        guard member.tagId == tag.id else { return false }
                        if chapterOnly { return member.wholeChapters.contains { $0.bookId == bookId && $0.chapter == chapter } }
                        return member.verses.contains { $0.bookId == bookId && $0.chapter == chapter && (selection.isEmpty || selection.contains($0.verse)) }
                    }) { member in
                        Button("Remove “\(member.label)” from #\(tag.name)", role: .destructive) {
                            app.attempt("Couldn’t remove the verse from the tag") { try app.verseTags?.removeMember(member.memberId) }
                        }
                    }
                }
            }
        }
    }
}

/// Quiet grouping for the narrow study inspector, without List's dense divider grid.
struct StudyPanelSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 8, content: content)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 10))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
