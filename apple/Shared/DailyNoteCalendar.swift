import SwiftUI
import BereanCore

/// Calendar tabs read and write the legacy local-date "month" and "selected" keys.
struct DailyNoteCalendar: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var notes: [String: Int] = [:]
    @State private var indexError = false

    private static let calendar = Calendar(identifier: .gregorian)
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)

    static func dateKey(_ date: Date) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    private var month: Date {
        if let key = app.findTab(tabId)?.state["month"]?.stringValue?.string,
           key.utf8.count == 7 {
            let parts = key.split(separator: "-", omittingEmptySubsequences: false)
            if parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]),
               (1...9999).contains(year), (1...12).contains(month),
               let date = Self.calendar.date(from: DateComponents(year: year, month: month, day: 1)) {
                return date
            }
        }
        return Self.calendar.dateInterval(of: .month, for: Date())?.start ?? Date()
    }

    private var days: [Date] {
        let calendar = Self.calendar
        let leading = calendar.component(.weekday, from: month) - 1
        let count = calendar.range(of: .day, in: .month, for: month)?.count ?? 0
        let cells = ((leading + count + 6) / 7) * 7
        return (0..<cells).compactMap { calendar.date(byAdding: .day, value: $0 - leading, to: month) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack {
                    Button { step(-1) } label: { Label("Previous Month", systemImage: "chevron.left").labelStyle(.iconOnly) }
                    Spacer()
                    Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button { step(1) } label: { Label("Next Month", systemImage: "chevron.right").labelStyle(.iconOnly) }
                }
                LazyVGrid(columns: columns, spacing: 4) {
                    ForEach(Array(Self.calendar.veryShortStandaloneWeekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                        Text(symbol).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    ForEach(days, id: \.self) { day in dayButton(day) }
                }
                if indexError {
                    Text("Could not load daily notes.").foregroundStyle(.secondary)
                }
                Button("Current Month") { saveMonth(Date()) }
            }
            .frame(maxWidth: 420)
            .padding()
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Calendar")
        .task(id: app.notesRevision) {
            do {
                let dates = try app.notes?.dailyDates() ?? []
                notes = Dictionary(uniqueKeysWithValues: dates.map { ($0.dateKey, $0.length) })
                indexError = app.notes == nil
            } catch {
                notes = [:]
                indexError = true
            }
        }
    }

    private func dayButton(_ date: Date) -> some View {
        let key = Self.dateKey(date)
        let inMonth = Self.calendar.isDate(date, equalTo: month, toGranularity: .month)
        let selected = app.findTab(tabId)?.state["selected"]?.stringValue?.string == key
        let today = Self.calendar.isDateInToday(date)
        return Button {
            saveMonth(date, selected: key)
            app.openDailyNote(key)
        } label: {
            VStack(spacing: 2) {
                Text(Self.calendar.component(.day, from: date), format: .number)
                    .fontWeight(today || selected ? .semibold : .regular)
                    .foregroundStyle(inMonth ? .primary : .secondary)
                Circle()
                    .fill(notes[key] == nil ? Color.clear : Color.accentColor.opacity(notes[key] == 0 ? 0.45 : 1))
                    .frame(width: 5, height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(selected ? Color.accentColor.opacity(0.16) : Color.clear, in: .rect(cornerRadius: 8))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(date.formatted(date: .complete, time: .omitted))
        .accessibilityValue(notes[key] == nil ? "No note" : "Daily note")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func step(_ delta: Int) {
        if let date = Self.calendar.date(byAdding: .month, value: delta, to: month) {
            saveMonth(date)
        }
    }

    private func saveMonth(_ date: Date, selected: String? = nil) {
        app.update(tabId, recordHistory: false) { tab in
            tab.state["month"] = .string(JSString(String(Self.dateKey(date).prefix(7))))
            if let selected { tab.state["selected"] = .string(JSString(selected)) }
        }
    }
}
