import SwiftUI
import BereanBible
import BereanReference

/// Book and chapter picker (the existing app's passage menu): books of the current text grouped by
/// section on the left, the chapter grid on the right. Choosing a chapter navigates the tab.
struct PassagePicker: View {
    @Environment(AppModel.self) private var app
    let textId: String
    let currentBook: String
    let currentChapter: Int
    let onPick: (String, Int) -> Void
    @State private var books: [BookRow] = []
    @State private var book: String?
    @State private var filter = ""

    var sections: [(String, [BookRow])] {
        let shown = filter.isEmpty ? books : books.filter { $0.name.localizedCaseInsensitiveContains(filter) || $0.shortName.localizedCaseInsensitiveContains(filter) }
        var out: [(String, [BookRow])] = []
        for b in shown {
            let title = Self.sectionTitle(b.testament)
            if out.last?.0 == title { out[out.count - 1].1.append(b) } else { out.append((title, [b])) }
        }
        return out
    }

    static func sectionTitle(_ t: String) -> String {
        switch t.uppercased() { case "OT": "Old Testament"; case "NT": "New Testament"; case "": "Books"; default: t.capitalized }
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                TextField("Filter books", text: $filter).textFieldStyle(.roundedBorder).padding(8)
                ScrollViewReader { proxy in
                    List(selection: $book) {
                        ForEach(sections, id: \.0) { s in
                            Section(s.0) { ForEach(s.1, id: \.id) { Text($0.name).tag($0.id).id($0.id) } }
                        }
                    }
                    .listStyle(.sidebar)
                    .onChange(of: books.count) { DispatchQueue.main.async { proxy.scrollTo(currentBook, anchor: .center) } }
                }
            }
            .frame(width: 210)
            Divider()
            ScrollView {
                if let b = books.first(where: { $0.id == book }) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(b.name).font(.headline)
                        LazyVGrid(columns: Array(repeating: GridItem(.fixed(38), spacing: 6), count: 6), spacing: 6) {
                            ForEach(1...max(1, b.chaptersCount), id: \.self) { c in
                                let current = b.id == currentBook && c == currentChapter
                                Button { onPick(b.id, c) } label: {
                                    Text(Reference.displayChapterString(b.id, c)).monospacedDigit().frame(width: 38, height: 28)
                                        .background(current ? Color.accentColor : Color.secondary.opacity(0.12), in: .rect(cornerRadius: 6))
                                        .foregroundStyle(current ? .white : .primary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(b.name) chapter \(c)")
                            }
                        }
                    }.padding(12)
                }
            }
            .frame(width: 290)
        }
        .frame(height: 360)
        .task(id: textId) { books = await app.books(for: textId); if book == nil { book = currentBook } }
    }
}

extension Reference {
    /// The chapter number as shown to readers (custom-numbered books such as Recognitions 3 differ from storage).
    static func displayChapterString(_ bookId: String, _ stored: Int) -> String {
        JSNumberString(displayChapter(bookId, Double(stored)))
    }
    private static func JSNumberString(_ d: Double) -> String { d == d.rounded() ? String(Int(d)) : String(d) }
}
