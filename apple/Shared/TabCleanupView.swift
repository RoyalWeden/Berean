import SwiftUI

struct TabCleanupView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var included: Set<String> = []
    @State private var query = ""
    @State private var duplicatesOnly = false

    var body: some View {
        let originals = duplicatesOnly ? app.inactiveDuplicateOriginals : [:]
        let tabs = app.inactiveTabs.filter { !duplicatesOnly || originals[$0.id] != nil }
        let selected = tabs.filter { included.contains($0.id) }
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        let matches = tabs.filter { tab in
            return terms.allSatisfy { tab.navigationSearchText.localizedStandardContains(String($0)) }
        }
        NavigationStack {
            List {
                Section {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Filter inactive tabs", text: $query)
                            .textFieldStyle(.plain)
                    }
                    Toggle("Exact Duplicates Only", isOn: $duplicatesOnly)
                        .onChange(of: duplicatesOnly) {
                            included.removeAll()
                        }
                    Button(terms.isEmpty ? "Select All" : "Select Matches", systemImage: "checkmark.circle") {
                        included.formUnion(matches.map(\.id))
                    }
                    .disabled(matches.allSatisfy { included.contains($0.id) })
                    Button("Clear Selection", systemImage: "xmark.circle") { included.removeAll() }
                        .disabled(selected.isEmpty)
                }
                Section {
                    if matches.isEmpty {
                        Text(tabs.isEmpty ? (duplicatesOnly ? "No exact duplicates" : "No inactive tabs") : "No matching tabs")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(matches) { tab in
                        Toggle(isOn: Binding(
                            get: { included.contains(tab.id) },
                            set: { include in
                                if include { included.insert(tab.id) } else { included.remove(tab.id) }
                            }
                        )) {
                            Label {
                                VStack(alignment: .leading) {
                                    Text(tab.navigationLabel)
                                    Text(tab.navigationDetail).font(.caption).foregroundStyle(.secondary)
                                    if let original = originals[tab.id] {
                                        Label(original.isPinned ? "Pinned copy stays open" : "Matching copy stays open",
                                              systemImage: original.isPinned ? "pin" : "square.on.square")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: tab.symbol).foregroundStyle(tab.tint)
                            }
                        }
                    }
                } header: {
                    Text("Choose tabs to archive · \(selected.count) selected")
                } footer: {
                    Text("Pinned and selected tabs stay open. You can restore these tabs together from Archived Tabs.")
                }
            }
            #if os(iOS)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack {
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button("Archive \(selected.count)", systemImage: "archivebox") {
                        app.archiveInactiveTabs(selected.map(\.id), duplicatesOnly: duplicatesOnly)
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(selected.isEmpty)
                }
                .padding()
                .background(.regularMaterial)
            }
            #else
            .navigationTitle("Archive Inactive Tabs")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Archive \(selected.count)") {
                        app.archiveInactiveTabs(selected.map(\.id), duplicatesOnly: duplicatesOnly)
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
            #endif
        }
    }
}
