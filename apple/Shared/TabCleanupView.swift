import SwiftUI

struct TabCleanupView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var included: Set<String> = []
    @State private var query = ""
    @State private var duplicatesOnly = false
    @State private var keepingRecent = true

    var body: some View {
        let originals = duplicatesOnly ? app.inactiveDuplicateOriginals(keepingRecent: keepingRecent) : [:]
        let recentIDs = app.recentCleanupTabIDs
        let candidates = app.inactiveTabs.filter { !duplicatesOnly || originals[$0.id] != nil }
        let protectedCount = candidates.filter { recentIDs.contains($0.id) }.count
        let tabs = candidates.filter { !keepingRecent || !recentIDs.contains($0.id) }
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
                    Toggle("Keep Recently Used Tabs", isOn: $keepingRecent)
                        .clickableCursor()
                        .onChange(of: keepingRecent) { _, enabled in
                            if duplicatesOnly { included.removeAll() }
                            else if enabled { included.subtract(recentIDs) }
                        }
                    Toggle("Exact Duplicates Only", isOn: $duplicatesOnly).clickableCursor()
                        .onChange(of: duplicatesOnly) {
                            included.removeAll()
                        }
                    Button(terms.isEmpty ? "Select All" : "Select Matches", systemImage: "checkmark.circle") {
                        included.formUnion(matches.map(\.id))
                    }
                    .disabled(matches.allSatisfy { included.contains($0.id) })
                    Button("Clear Selection", systemImage: "xmark.circle") { included.removeAll() }.clickableCursor()
                        .disabled(selected.isEmpty)
                }
                Section {
                    if matches.isEmpty {
                        if keepingRecent && protectedCount > 0 && tabs.isEmpty {
                            Text("Only recently used tabs match this cleanup mode.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text(tabs.isEmpty ? (duplicatesOnly ? "No exact duplicates" : "No inactive tabs") : "No matching tabs")
                                .foregroundStyle(.secondary)
                        }
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
                                        let keepsRecentCopy = keepingRecent && recentIDs.contains(original.id)
                                        let reason = original.isPinned ? "Pinned copy stays open"
                                            : keepsRecentCopy ? "Recently used copy stays open" : "Matching copy stays open"
                                        Label(reason, systemImage: original.isPinned ? "pin" : "square.on.square")
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
                    if keepingRecent && protectedCount > 0 {
                        Text("\(protectedCount) recently used tab\(protectedCount == 1 ? "" : "s") kept open.")
                    }
                    Text("Pinned and active tabs stay open. You can restore archived tabs together.")
                }
            }
            #if os(iOS)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack {
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                    Button("Archive \(selected.count)", systemImage: "archivebox") {
                        app.archiveInactiveTabs(selected.map(\.id), duplicatesOnly: duplicatesOnly, keepingRecent: keepingRecent)
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(selected.isEmpty)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .glassEffectCompat(interactive: true)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            #else
            .navigationTitle("Archive Inactive Tabs")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.clickableCursor() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Archive \(selected.count)") {
                        app.archiveInactiveTabs(selected.map(\.id), duplicatesOnly: duplicatesOnly, keepingRecent: keepingRecent)
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
            #endif
        }
    }
}
