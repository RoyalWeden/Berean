import SwiftUI
import BereanCore
import BereanSync
import BereanReference

/// Milestone-1 placeholder shared by both apps: proves the app links BereanKit and that the
/// ported sync primitives run on-device. Replaced by the real shell in the vertical slices (M5).
struct CoreStatusView: View {
    private let sample: JSObject = JSObject([
        ("ref", .string("Gen 1:1")),
        ("text", .string("בְּרֵאשִׁית בָּרָא אֱלֹהִים")),
        ("color", .string("blue")),
    ])
    @State private var lastTick = HLC.zero
    @State private var query = "Isaiah 63:17-64:3"

    var body: some View {
        Form {
            Section("Native core") {
                LabeledContent("Record hash", value: SyncHash.recordHash(sample))
                LabeledContent("First order key", value: (try? OrderKey.between(nil, nil)) ?? "—")
                LabeledContent("Clock", value: lastTick)
                Button("Tick clock") {
                    var clock = try? HybridLogicalClock(deviceId: "native", last: lastTick == HLC.zero ? nil : lastTick) {
                        Int64(Date().timeIntervalSince1970 * 1000)
                    }
                    if let t = clock?.tick() { lastTick = t }
                }
            }
            Section("Reference") {
                TextField("Reference", text: $query, prompt: Text("Gen 1:1, Ps 23, Rec. Clem. IV 35"))
                    .autocorrectionDisabled()
                if let ref = Reference.parse(query) {
                    LabeledContent("Book", value: Reference.bookName(ref.bookId))
                    LabeledContent("Label", value: Reference.bookChapterVerseLabel(ref.bookId, chapter: ref.chapter, verse: ref.verse))
                    LabeledContent("Canonical", value: Reference.createCanonical(ref.bookId, chapter: ref.chapter, verse: ref.verse))
                } else {
                    Text("Not a reference").foregroundStyle(.secondary)
                }
            }
            Section {
                Text("Development build — no iCloud, no production data.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Berean")
    }
}

#Preview { NavigationStack { CoreStatusView() } }
