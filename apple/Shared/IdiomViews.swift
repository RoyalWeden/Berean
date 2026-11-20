import SwiftUI
import BereanNotes

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
