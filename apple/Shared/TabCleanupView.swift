import SwiftUI

struct TabCleanupView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var excluded: Set<String> = []

    var body: some View {
        let tabs = app.inactiveTabs
        let selected = tabs.filter { !excluded.contains($0.id) }
        NavigationStack {
            List {
                Section {
                    ForEach(tabs) { tab in
                        Toggle(isOn: Binding(
                            get: { !excluded.contains(tab.id) },
                            set: { include in
                                if include { excluded.remove(tab.id) } else { excluded.insert(tab.id) }
                            }
                        )) {
                            Label(tab.title.isEmpty ? "Untitled" : tab.title, systemImage: tab.symbol)
                        }
                    }
                } header: {
                    Text("Choose tabs to archive")
                } footer: {
                    Text("Pinned and selected tabs stay open. You can restore these tabs together from Archived Tabs.")
                }
            }
            .navigationTitle("Archive Inactive Tabs")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Archive \(selected.count)") {
                        app.archiveInactiveTabs(selected.map(\.id))
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
        }
    }
}
