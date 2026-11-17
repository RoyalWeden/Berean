import SwiftUI
import BereanWorkspace

struct TabCleanupView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var included: Set<String> = []
    @State private var reviewingSelection = false
    @State private var query = ""
    @State private var duplicatesOnly = false
    @State private var keepingRecent = true
    @State private var tabType: TabType?
    @State private var archivedGroupID: String?
    @State private var nothingArchived = false
    @State private var moveMessage: String?

    var body: some View {
        let originals = duplicatesOnly ? app.inactiveDuplicateOriginals(keepingRecent: keepingRecent) : [:]
        let recentIDs = app.recentCleanupTabIDs
        let candidates = app.inactiveTabs.filter { !duplicatesOnly || originals[$0.id] != nil }
        let protectedCount = candidates.filter { recentIDs.contains($0.id) }.count
        let tabs = candidates.filter { !keepingRecent || !recentIDs.contains($0.id) }
        let selected = tabs.filter { included.contains($0.id) }
        let kinds = TabType.allCases.filter { kind in tabs.contains { $0.tabType == kind } || tabType == kind }
        let receipt = app.archivedGroups.first { $0.id == archivedGroupID }
        let destinations = app.tabMoveDestinations
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        let matches = tabs.filter { tab in
            (tabType == nil || tab.tabType == tabType)
                && terms.allSatisfy { tab.navigationSearchText.localizedStandardContains(String($0)) }
        }
        let displayedTabs = reviewingSelection ? selected : matches
        let visibleIDs = Set(displayedTabs.map(\.id))
        let hiddenSelection = selected.filter { !visibleIDs.contains($0.id) }
        NavigationStack {
            List {
                if let moveMessage { Text(moveMessage).foregroundStyle(.secondary) }
                if let receipt {
                    Section {
                        Label("Archived \(receipt.tabs.count) tab\(receipt.tabs.count == 1 ? "" : "s")", systemImage: "archivebox")
                        let canRestoreToSource = app.canRestoreArchiveToSource(receipt.id)
                        if !canRestoreToSource {
                            Text("Original workspace unavailable. You can restore these tabs here.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Button(canRestoreToSource ? "Undo Archive" : "Restore Here", systemImage: "arrow.uturn.backward") {
                            app.restoreArchived(receipt.id, toSource: canRestoreToSource)
                            if !app.archivedGroups.contains(where: { $0.id == receipt.id }) { archivedGroupID = nil }
                        }
                        .disabled(receipt.tabs.isEmpty)
                        .buttonStyle(.borderless)
                        .clickableCursor()
                    }
                }
                if nothingArchived {
                    Text("No selected tabs are still eligible to archive.").foregroundStyle(.secondary)
                }
                Section {
                    if !reviewingSelection {
                        HStack {
                            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                            TextField("Filter inactive tabs", text: $query)
                                .textFieldStyle(.plain)
                        }
                        if !kinds.isEmpty {
                            Picker("Tab Type", selection: $tabType) {
                                Text("All Types").tag(nil as TabType?)
                                ForEach(kinds, id: \.self) { kind in
                                    let count = tabs.count { $0.tabType == kind }
                                    Text("\(kind == .bible ? "Scripture" : kind.rawValue.capitalized) (\(count))")
                                        .tag(Optional(kind))
                                }
                            }
                            .pickerStyle(.menu)
                            .clickableCursor()
                        }
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
                    if !reviewingSelection {
                        Button(terms.isEmpty && tabType == nil ? "Select All" : "Select Matches", systemImage: "checkmark.circle") {
                            included.formUnion(matches.map(\.id))
                        }
                        .buttonStyle(.borderless)
                        .clickableCursor()
                        .disabled(matches.allSatisfy { included.contains($0.id) })
                    }
                    if reviewingSelection || !selected.isEmpty {
                        Button {
                            reviewingSelection.toggle()
                        } label: {
                            Label(reviewingSelection ? "Back to Matches" : "Review Selection",
                                  systemImage: reviewingSelection ? "line.3.horizontal.decrease" : "checklist")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                    }
                    Button("Clear Selection", systemImage: "xmark.circle") { included.removeAll() }
                        .buttonStyle(.borderless)
                        .clickableCursor()
                        .disabled(selected.isEmpty)
                    if !hiddenSelection.isEmpty {
                        Button("Deselect Hidden Tabs", systemImage: "eye.slash") {
                            included.subtract(hiddenSelection.map(\.id))
                        }
                        .buttonStyle(.borderless)
                        .clickableCursor()
                    }
                    if !destinations.isEmpty {
                        Menu("Move Selection to Workspace", systemImage: "square.stack") {
                            ForEach(destinations) { workspace in
                                Button(workspace.moveMenuLabel) {
                                    move(selected.map(\.id), to: workspace)
                                }
                            }
                        }
                        .disabled(selected.isEmpty)
                        .clickableCursor()
                    }
                }
                Section {
                    if displayedTabs.isEmpty {
                        if reviewingSelection {
                            Text("No tabs selected").foregroundStyle(.secondary)
                        } else if keepingRecent && protectedCount > 0 && tabs.isEmpty {
                            Text("Only recently used tabs match this cleanup mode.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text(tabs.isEmpty ? (duplicatesOnly ? "No exact duplicates" : "No inactive tabs") : "No matching tabs")
                                .foregroundStyle(.secondary)
                        }
                    }
                    ForEach(displayedTabs) { tab in
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
                        .clickableCursor()
                        .contextMenu {
                            if let original = originals[tab.id] {
                                Button("Show Tab Kept Open", systemImage: "square.on.square") {
                                    guard app.findTab(original.id) != nil else { return }
                                    app.select(original.id, in: original.spaceId)
                                    dismiss()
                                }
                            }
                        }
                    }
                } header: {
                    if reviewingSelection {
                        Text("Reviewing \(selected.count) selected")
                    } else if hiddenSelection.isEmpty {
                        Text("\(selected.count) selected")
                    } else {
                        Text("\(selected.count) selected · \(hiddenSelection.count) hidden by filters")
                    }
                } footer: {
                    if keepingRecent && protectedCount > 0 {
                        Text("\(protectedCount) recently used tab\(protectedCount == 1 ? "" : "s") kept open.")
                    }
                    if duplicatesOnly {
                        Text("Exact duplicates share the same tab settings and saved browsing position.")
                    }
                    Text("Pinned and active tabs stay open. You can restore archived tabs together.")
                }
            }
            .navigationTitle(reviewingSelection ? "Review Selection" : "Archive Inactive Tabs")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack {
                    Button(receipt == nil && moveMessage == nil ? "Cancel" : "Done") { dismiss() }
                        .buttonStyle(.bordered)
                    Button("Archive \(selected.count)", systemImage: "archivebox") {
                        archive(selected.map(\.id))
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(receipt == nil && moveMessage == nil ? "Cancel" : "Done") { dismiss() }.clickableCursor()
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Archive \(selected.count)") {
                        archive(selected.map(\.id))
                    }
                    .disabled(selected.isEmpty)
                }
            }
            #endif
        }
    }

    private func archive(_ ids: [String]) {
        let group = app.archiveInactiveTabs(ids, duplicatesOnly: duplicatesOnly, keepingRecent: keepingRecent)
        if let group { archivedGroupID = group.id }
        nothingArchived = group == nil
        included.removeAll()
        reviewingSelection = false
    }

    private func move(_ ids: [String], to workspace: WorkspaceItem) {
        let count = app.moveInactiveTabs(ids, to: workspace, duplicatesOnly: duplicatesOnly, keepingRecent: keepingRecent)
        moveMessage = count == 0 ? "No selected tabs were moved."
            : "Moved \(count) tab\(count == 1 ? "" : "s") to \(workspace.displayName)."
        included.removeAll()
        reviewingSelection = false
    }
}
