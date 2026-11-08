import SwiftUI
import Observation
import BereanBible
import BereanText
import BereanReference

/// Read-only bundled corpora copied into the app by the "Bundle corpora" build phase.
enum Corpora {
    static func path(_ textId: String) -> String? {
        Bundle.main.url(forResource: textId, withExtension: "db", subdirectory: "Corpora")?.path
    }
}

/// First native reader (gate G2): KJVA chapters with KJV italics and red letter, optional Strong's
/// numbers, passage navigation by typed reference, and full-text search. Read-only; no user data.
@MainActor @Observable
final class ReaderModel {
    let bible = BibleService(resolvePath: { Corpora.path($0) })
    var textId = "kjva"
    var books: [BookRow] = []
    var bookId = "GEN"
    var chapter = 1
    var verses: [ChapterVerseRow] = []
    var showStrongs = false
    var searchQuery = ""
    var searchResults: [VerseSearchRow] = []
    var corporaMissing = false

    var book: BookRow? { books.first { $0.id == bookId } }
    var title: String { Reference.bookChapterLabel(bookId, chapter: Double(chapter)) }

    func load() async {
        books = await bible.getBooks(textId)
        corporaMissing = books.isEmpty
        await loadChapter()
    }

    func loadChapter() async { verses = await bible.queryChapter(bookId, chapter, textId: textId) }

    func go(bookId: String, chapter: Int) async {
        self.bookId = bookId
        self.chapter = max(1, min(chapter, books.first { $0.id == bookId }?.chaptersCount ?? chapter))
        await loadChapter()
    }

    func step(_ delta: Int) async {
        guard let i = books.firstIndex(where: { $0.id == bookId }) else { return }
        let next = chapter + delta
        if next >= 1 && next <= books[i].chaptersCount { await go(bookId: bookId, chapter: next) }
        else if delta > 0, i + 1 < books.count { await go(bookId: books[i + 1].id, chapter: 1) }
        else if delta < 0, i > 0 { await go(bookId: books[i - 1].id, chapter: books[i - 1].chaptersCount) }
    }

    /// A typed reference navigates; anything else searches.
    func submit() async {
        let q = searchQuery
        if let ref = Reference.parse(q) {
            searchResults = []
            await go(bookId: ref.bookId, chapter: ref.chapter)
        } else {
            searchResults = await bible.searchText(q, textId: textId)
        }
    }
}

struct VerseText: View {
    let row: ChapterVerseRow
    let showStrongs: Bool

    var body: some View {
        Text(attributed).textSelection(.enabled)
    }

    var attributed: AttributedString {
        var out = AttributedString()
        var number = AttributedString("\(row.verseNum) ")
        number.font = .caption.weight(.semibold)
        number.foregroundColor = .secondary
        out += number
        let serif = Font.system(.body, design: .serif)
        guard let tagged = row.textTagged, !tagged.isEmpty else {
            var plain = AttributedString(row.text); plain.font = serif
            return out + plain
        }
        var first = true
        for t in TaggedText.parse(tagged) where !t.hasNoPlainText {
            if !first { var sp = AttributedString(" "); sp.font = serif; out += sp }
            first = false
            var w = AttributedString(t.word)
            w.font = t.isItalic ? serif.italic() : serif
            if t.isRedLetter { w.foregroundColor = .red }
            out += w
            if showStrongs, let s = t.strongs {
                let ids: [String]
                switch s { case .one(let x): ids = [x]; case .many(let a): ids = a }
                var chip = AttributedString(ids.joined(separator: "·"))
                chip.font = .caption2
                chip.foregroundColor = .secondary
                chip.baselineOffset = 6
                out += chip
            }
        }
        return out
    }
}

struct ReaderView: View {
    @State private var model = ReaderModel()
    @State private var showStatus = false

    var body: some View {
        Group {
            if model.corporaMissing {
                ContentUnavailableView("Texts not bundled", systemImage: "books.vertical",
                                       description: Text("Run npm run setup:worktree so data/*.db exist, then rebuild."))
            } else if !model.searchResults.isEmpty {
                List(model.searchResults, id: \.self) { r in
                    Button {
                        Task { await model.go(bookId: r.bookId, chapter: r.chapter); model.searchResults = [] }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Reference.bookChapterVerseLabel(r.bookId, chapter: r.chapter, verse: r.verseNum)).font(.headline)
                            Text(r.text).font(.body).foregroundStyle(.secondary).lineLimit(3)
                        }
                    }
                    .buttonStyle(.plain)
                }
            } else {
                List(model.verses, id: \.verseNum) { v in
                    VerseText(row: v, showStrongs: model.showStrongs)
                        .lineSpacing(4)
                        .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle(model.searchResults.isEmpty ? model.title : "Search")
        .searchable(text: $model.searchQuery, prompt: "Reference or words")
        .onSubmit(of: .search) { Task { await model.submit() } }
        .toolbar {
            ToolbarItemGroup {
                Button { Task { await model.step(-1) } } label: { Label("Previous Chapter", systemImage: "chevron.left") }
                    .keyboardShortcut("[", modifiers: [.command, .option])
                Button { Task { await model.step(1) } } label: { Label("Next Chapter", systemImage: "chevron.right") }
                    .keyboardShortcut("]", modifiers: [.command, .option])
                Toggle(isOn: $model.showStrongs) { Label("Strong's Numbers", systemImage: "number") }
                Button { showStatus = true } label: { Label("Native Core", systemImage: "info.circle") }
            }
        }
        .sheet(isPresented: $showStatus) {
            NavigationStack {
                CoreStatusView()
                    .toolbar { Button("Done") { showStatus = false } }
            }
            .frame(minWidth: 420, minHeight: 420)
        }
        .task { await model.load() }
    }
}

extension VerseSearchRow: @retroactive Hashable {
    public func hash(into h: inout Hasher) { h.combine(bookId); h.combine(chapter); h.combine(verseNum) }
}

#Preview { NavigationStack { ReaderView() } }
