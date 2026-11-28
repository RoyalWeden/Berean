import SwiftUI
import AppKit
import BereanNotes

/// File → Import from e-Sword… (Mac only, as the original): choose the e-Sword folder, pick which
/// files to read, review new / updated / already-imported notes, import the selected ones.
struct ESwordImportView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var folder: URL?
    @State private var available: ESwordImport.Sources = []
    @State private var sources: ESwordImport.Sources = .all
    @State private var candidates: [ESwordImport.Candidate] = []
    @State private var selected: Set<String> = []
    @State private var phase = "choose"   // choose · review · done
    @State private var message = ""

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case "review": review
                case "done": done
                default: choose
                }
            }
            .navigationTitle("Import from e-Sword")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(phase == "done" ? "Close" : "Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if phase == "choose" {
                        Button("Read Notes") { readNotes() }.disabled(folder == nil || sources.intersection(available).isEmpty)
                    } else if phase == "review" {
                        Button("Import \(selected.count)") { importSelected() }.disabled(selected.isEmpty)
                    }
                }
            }
        }
        .frame(width: 620, height: 560)
    }

    private var choose: some View {
        Form {
            Section {
                LabeledContent("Folder") {
                    HStack {
                        Text(folder?.path ?? "Not chosen").foregroundStyle(folder == nil ? .secondary : .primary).lineLimit(1).truncationMode(.middle)
                        Button("Choose…") { chooseFolder() }
                    }
                }
            } footer: {
                Text("Choose your e-Sword folder (it contains study.notx, topic.topx or journal.jnlx). Files are only read, never changed.")
            }
            if folder != nil {
                Section("Read") {
                    toggle("Study notes (study.notx)", .study)
                    toggle("Topic notes (topic.topx)", .topics)
                    toggle("Journal (journal.jnlx)", .journal)
                }
            }
            if !message.isEmpty { Text(message).foregroundStyle(.secondary) }
        }
        .formStyle(.grouped)
    }

    private func toggle(_ title: String, _ source: ESwordImport.Sources) -> some View {
        Toggle(title, isOn: Binding(get: { sources.contains(source) && available.contains(source) },
                                    set: { if $0 { sources.insert(source) } else { sources.remove(source) } }))
            .disabled(!available.contains(source))
    }

    private var review: some View {
        let groups: [(String, ESwordImport.Status)] = [("New", .new), ("Changed since last import", .updated), ("Already imported", .duplicate)]
        return VStack(spacing: 0) {
            Text(message).font(.callout).foregroundStyle(.secondary).padding(10)
            List {
                ForEach(groups, id: \.1) { title, status in
                    let items = candidates.filter { $0.status == status }
                    if !items.isEmpty {
                        Section {
                            ForEach(items) { c in
                                Toggle(isOn: Binding(get: { selected.contains(c.id) },
                                                     set: { if $0 { selected.insert(c.id) } else { selected.remove(c.id) } })) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) {
                                            Image(systemName: c.kind == .verse ? "book" : c.kind == .daily ? "calendar" : "note.text").foregroundStyle(.secondary)
                                            Text(c.title).fontWeight(.medium)
                                        }
                                        Text(c.body).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }
                                .disabled(status == .duplicate)
                            }
                        } header: {
                            HStack {
                                Text("\(title) (\(items.count))")
                                Spacer()
                                if status != .duplicate {
                                    Button("Select All") { selected.formUnion(items.map(\.id)) }.buttonStyle(.link)
                                    Button("None") { selected.subtract(items.map(\.id)) }.buttonStyle(.link)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var done: some View {
        ContentUnavailableView {
            Label("Import Complete", systemImage: "checkmark.circle")
        } description: { Text(message) } actions: {
            Button("Show Imported Notes") { app.openNotesSearch("#esword"); dismiss() }.buttonStyle(.borderedProminent)
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.title = "Choose your e-Sword folder"
        panel.prompt = "Choose"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = ESwordImport.detectFolder() ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        let finish: (NSApplication.ModalResponse) -> Void = { r in
            guard r == .OK, let url = panel.url else { return }
            folder = url
            _ = url.startAccessingSecurityScopedResource()
            available = ESwordImport.availableSources(in: url)
            message = available.isEmpty ? "No e-Sword note files were found in that folder." : ""
        }
        if let window = NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
    }

    private func readNotes() {
        guard let folder, let db = app.database?.connection else { return }
        do {
            let read = try ESwordImport.read(folder: folder, sources: sources.intersection(available))
            candidates = try ESwordImport.classify(read, db: db)
            selected = Set(candidates.filter { $0.status != .duplicate }.map(\.id))
            let n = candidates.filter { $0.status == .new }.count, u = candidates.filter { $0.status == .updated }.count
            let d = candidates.count - n - u
            message = candidates.isEmpty ? "No notes found in the selected files." : "\(n) new · \(u) changed · \(d) already imported"
            phase = candidates.isEmpty ? "choose" : "review"
        } catch {
            message = "Couldn’t read the e-Sword files: \(error.localizedDescription)"
        }
    }

    private func importSelected() {
        guard let notes = app.notes, let db = app.database?.connection else { return }
        let chosen = candidates.filter { selected.contains($0.id) }
        do {
            let result = try ESwordImport.save(chosen, notes: notes, db: db)
            var parts: [String] = []
            if result.imported > 0 { parts.append("\(result.imported) imported") }
            if result.updated > 0 { parts.append("\(result.updated) updated") }
            message = parts.isEmpty ? "Nothing to import." : parts.joined(separator: ", ")
            phase = "done"
        } catch {
            message = "Import stopped: \(error.localizedDescription)"
        }
        folder?.stopAccessingSecurityScopedResource()
    }
}
