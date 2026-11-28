import SwiftUI
import BereanNotes
import BereanReference

/// The idiom fields of an idiom note (original IdiomHeader): term, meaning, aliases and automatic
/// variants. Every change saves through NotesService and refreshes the reader's idiom matcher.
struct IdiomHeader: View {
    @Environment(AppModel.self) private var app
    let note: Note
    @State private var term = ""
    @State private var meaning = ""
    @State private var aliases: [String] = []
    @State private var auto = false
    @State private var newAlias = ""
    @State private var loadedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Idiom", systemImage: "character.book.closed").font(.caption.weight(.semibold)).foregroundStyle(.purple)
            LabeledContent("Term") {
                TextField("Term…", text: $term).textFieldStyle(.roundedBorder)
                    .onSubmit { save() }
            }
            LabeledContent("Meaning") {
                TextField("What it means…", text: $meaning, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
                    .onSubmit { save() }
            }
            LabeledContent("Also matches") {
                VStack(alignment: .leading, spacing: 6) {
                    if !aliases.isEmpty {
                        IdiomAliasChips(items: aliases) { alias in aliases.removeAll { $0 == alias }; save() }
                    }
                    TextField("Add another form…", text: $newAlias).textFieldStyle(.roundedBorder)
                        .onSubmit {
                            let a = newAlias.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !a.isEmpty, !aliases.contains(a) { aliases.append(a); save() }
                            newAlias = ""
                        }
                }
            }
            Toggle("Also match plurals and possessives (horn’s, horns)", isOn: $auto)
                .onChange(of: auto) { save() }
        }
        .padding(12)
        .background(Color.purple.opacity(0.06), in: .rect(cornerRadius: 12))
        .onAppear(perform: load)
        .onChange(of: note.id) { load() }
        .onDisappear { save() }
    }

    private func load() {
        guard loadedId != note.id else { return }
        loadedId = note.id
        term = note.idiomTerm ?? note.title
        meaning = note.idiomMeaning ?? ""
        aliases = note.idiomAliases ?? []
        auto = note.idiomAutoVariants
    }

    private func save() {
        let t = term.trimmingCharacters(in: .whitespacesAndNewlines)
        let meaning = meaning.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let notes = app.notes else { return }
        let changed = t.lowercased() != (note.idiomTerm ?? "") || meaning != (note.idiomMeaning ?? "")
            || aliases != (note.idiomAliases ?? []) || auto != note.idiomAutoVariants
        guard changed else { return }
        try? notes.update(note.id, .init(title: t, idiomTerm: t.lowercased(), idiomMeaning: meaning, idiomAliases: aliases, idiomAutoVariants: auto))
        app.notesRevision += 1
    }
}

/// Removable chips that wrap.
struct IdiomAliasChips: View {
    let items: [String]
    let onRemove: (String) -> Void
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { chips }
            VStack(alignment: .leading, spacing: 6) { chips }
        }
    }
    @ViewBuilder private var chips: some View {
        ForEach(items, id: \.self) { item in
            HStack(spacing: 4) {
                Text(item)
                Button("Remove \(item)", systemImage: "xmark.circle.fill") { onRemove(item) }
                    .labelStyle(.iconOnly).buttonStyle(.interactivePlain).foregroundStyle(.secondary)
            }
            .font(.callout).padding(.horizontal, 8).padding(.vertical, 3)
            .background(.quaternary, in: .capsule)
        }
    }
}

/// "New Idiom" sheet (original idiom modal): term + meaning.
struct NewIdiomSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var term: String
    @State var meaning: String
    var body: some View {
        NavigationStack {
            Form {
                TextField("Term", text: $term)
                TextField("Meaning", text: $meaning, axis: .vertical).lineLimit(2...5)
            }
            .formStyle(.grouped)
            .navigationTitle("New Idiom")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { app.createIdiom(term: term, meaning: meaning); dismiss() }
                        .disabled(term.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        #if os(macOS)
        .frame(width: 420, height: 260)
        #endif
    }
}

/// Idioms reference book (original idiomsExport.ts, "grouped" organization): every idiom note,
/// alphabetical under letter headings — title-cased term in red, aliases, meaning, explanation,
/// related idioms (linked when in the book) and Scripture references — printed / saved as PDF.
enum IdiomReferenceBook {
    static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    static func slug(_ term: String) -> String {
        "idiom-" + term.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    static func html(_ notes: [Note], hermas: HermasText) -> String {
        struct Entry { var term: String; var meaning: String; var aliases: [String]; var explanation: String; var compare: [String]; var verses: [String] }
        let entries: [Entry] = notes.filter { $0.type == "idiom" }.compactMap { n in
            let term = (n.idiomTerm ?? n.title).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !term.isEmpty else { return nil }
            let d = n.idiomData
            let explanation = d?["explanation"]?.stringValue?.string ?? ""
            let compare = d?["compare"]?.arrayValue?.compactMap { $0.stringValue?.string } ?? []
            let examples = d?["examples"]?.arrayValue?.compactMap { $0.stringValue?.string } ?? []
            var verses = d?["verses"]?.arrayValue?.compactMap { $0.stringValue?.string } ?? []
            let refText = (examples + [explanation, n.content]).joined(separator: "\n")
            for ref in NoteVerseRefs.linkSpans(content: refText, hermas: hermas) where !verses.contains(ref.reference) { verses.append(ref.reference) }
            let body = explanation.isEmpty ? MarkdownLiveSpans.plainText(n.content).trimmingCharacters(in: .whitespacesAndNewlines) : explanation
            return Entry(term: term, meaning: n.idiomMeaning ?? "", aliases: n.idiomAliases ?? [], explanation: body, compare: compare, verses: verses)
        }.sorted { $0.term.localizedCaseInsensitiveCompare($1.term) == .orderedAscending }
        let anchors = Dictionary(entries.flatMap { e in ([e.term] + e.aliases).map { ($0.lowercased(), slug(e.term)) } }, uniquingKeysWith: { a, _ in a })
        var out = """
        <html><head><meta charset="utf-8"><style>
        body { font-family: Georgia, serif; font-size: 13px; color: #222; }
        h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #888; margin-bottom: 18px; }
        h2 { font-size: 15px; color: #c0392b; border-bottom: 1px solid #e3e3e3; margin: 18px 0 8px; }
        .e { margin: 0 0 14px; } .t { font-size: 15px; font-weight: bold; color: #c0392b; }
        .a { color: #888; font-size: 11.5px; } .m { font-style: italic; font-size: 14px; margin: 2px 0; }
        .l { color: #888; font-size: 11.5px; }
        </style></head><body><h1>Idioms</h1><div class="sub">\(entries.count) entr\(entries.count == 1 ? "y" : "ies")</div>
        """
        var letter = ""
        for e in entries {
            let first = e.term.first(where: \.isLetter).map { String($0).uppercased() } ?? "#"
            if first != letter { letter = first; out += "<h2>\(esc(letter))</h2>" }
            out += "<div class=\"e\"><a name=\"\(slug(e.term))\"></a><div class=\"t\">\(esc(e.term.capitalized))</div>"
            if !e.aliases.isEmpty { out += "<div class=\"a\">Also: \(e.aliases.map(esc).joined(separator: ", "))</div>" }
            if !e.meaning.isEmpty { out += "<div class=\"m\">\(esc(e.meaning))</div>" }
            if !e.explanation.isEmpty { out += "<div>\(esc(e.explanation).replacingOccurrences(of: "\n", with: "<br>"))</div>" }
            if !e.compare.isEmpty {
                let refs = e.compare.map { c in anchors[c.lowercased()].map { "<a href=\"#\($0)\">\(esc(c))</a>" } ?? esc(c) }
                out += "<div class=\"l\">Compare to: \(refs.joined(separator: ", "))</div>"
            }
            if !e.verses.isEmpty { out += "<div class=\"l\">References: \(e.verses.map(esc).joined(separator: "; "))</div>" }
            out += "</div>"
        }
        return out + "</body></html>"
    }
}
