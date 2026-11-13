import SwiftUI
import BereanCore
import BereanNotes

/// Calendar tabs read and write the legacy local-date "month" and "selected" keys.
struct DailyNoteCalendar: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var notes: [String: Int] = [:]
    @State private var indexError = false
    @State private var showLocation = false
    @AppStorage(DailyNotePreferences.locationKey) private var storedLocation = ""

    private static var calendar: Calendar { DailyNoteDay.localCalendar }
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)

    private func month(for today: Date) -> Date {
        if let key = app.findTab(tabId)?.state["month"]?.stringValue?.string,
           key.utf8.count == 7 {
            let parts = key.split(separator: "-", omittingEmptySubsequences: false)
            if parts.count == 2, let year = Int(parts[0]), let month = Int(parts[1]),
               (1...9999).contains(year), (1...12).contains(month),
               let date = Self.calendar.date(from: DateComponents(year: year, month: month, day: 1)) {
                return date
            }
        }
        return Self.calendar.dateInterval(of: .month, for: today)?.start ?? today
    }

    private func days(in month: Date) -> [Date] {
        let calendar = Self.calendar
        let leading = calendar.component(.weekday, from: month) - 1
        let count = calendar.range(of: .day, in: .month, for: month)?.count ?? 0
        let cells = ((leading + count + 6) / 7) * 7
        return (0..<cells).compactMap { calendar.date(byAdding: .day, value: $0 - leading, to: month) }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            calendarContent(today: DailyNoteDay.anchor(context.date, location: DailyNotePreferences.location(storedLocation)))
        }
        .sheet(isPresented: $showLocation) { DailyNoteLocationSettings(storedLocation: $storedLocation) }
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

    private func calendarContent(today: Date) -> some View {
        let month = month(for: today)
        return ScrollView {
            VStack(spacing: 12) {
                HStack {
                    Button { step(-1, from: month) } label: { Label("Previous Month", systemImage: "chevron.left").labelStyle(.iconOnly) }
                    Spacer()
                    Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button { step(1, from: month) } label: { Label("Next Month", systemImage: "chevron.right").labelStyle(.iconOnly) }
                }
                LazyVGrid(columns: columns, spacing: 4) {
                    ForEach(Array(Self.calendar.veryShortStandaloneWeekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                        Text(symbol).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    ForEach(days(in: month), id: \.self) { day in dayButton(day, in: month, today: today) }
                }
                if indexError {
                    Text("Could not load daily notes.").foregroundStyle(.secondary)
                }
                HStack {
                    Button("Current Month") { saveMonth(DailyNotePreferences.today()) }
                    Button("Today’s Note") {
                        let today = DailyNotePreferences.today()
                        let key = DailyNoteDay.dateKey(today)
                        saveMonth(today, selected: key)
                        app.openDailyNote(key)
                    }
                    Button("Sunrise Settings", systemImage: "sunrise") { showLocation = true }
                        .labelStyle(.iconOnly)
                        #if os(macOS)
                        .help("Sunrise Settings")
                        #endif
                }
            }
            .frame(maxWidth: 420)
            .padding()
            .frame(maxWidth: .infinity)
        }
    }

    private func dayButton(_ date: Date, in month: Date, today anchor: Date) -> some View {
        let key = DailyNoteDay.dateKey(date)
        let inMonth = Self.calendar.isDate(date, equalTo: month, toGranularity: .month)
        let selected = app.findTab(tabId)?.state["selected"]?.stringValue?.string == key
        let today = Self.calendar.isDate(date, inSameDayAs: anchor)
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
        .buttonStyle(.interactivePlain)
        .accessibilityLabel(date.formatted(date: .complete, time: .omitted))
        .accessibilityValue([today ? "Today" : nil, notes[key] == nil ? "No note" : "Daily note"].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func step(_ delta: Int, from month: Date) {
        if let date = Self.calendar.date(byAdding: .month, value: delta, to: month) {
            saveMonth(date)
        }
    }

    private func saveMonth(_ date: Date, selected: String? = nil) {
        app.update(tabId, recordHistory: false) { tab in
            tab.state["month"] = .string(JSString(String(DailyNoteDay.dateKey(date).prefix(7))))
            if let selected { tab.state["selected"] = .string(JSString(selected)) }
        }
    }
}

enum DailyNotePreferences {
    static let locationKey = "dailyNoteSunriseCoordinates"

    static func location(_ stored: String) -> DailyNoteDay.Location? {
        let fields = stored.split(separator: ",")
        guard fields.count == 2, let latitude = Double(fields[0]), let longitude = Double(fields[1]) else { return nil }
        return DailyNoteDay.Location(latitude: latitude, longitude: longitude)
    }

    static func today() -> Date {
        let stored = UserDefaults.standard.string(forKey: locationKey) ?? ""
        return DailyNoteDay.anchor(Date(), location: location(stored))
    }
}

private struct DailyNoteLocationSettings: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var storedLocation: String
    @State private var latitude = ""
    @State private var longitude = ""

    private var location: DailyNoteDay.Location? {
        let separator = Locale.current.decimalSeparator ?? "."
        guard let latitude = Double(latitude.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: separator, with: ".")),
              let longitude = Double(longitude.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: separator, with: ".")) else { return nil }
        return DailyNoteDay.Location(latitude: latitude, longitude: longitude)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Daily Note Sunrise").font(.headline)
            Text("Set coordinates to start each daily note at local sunrise.")
                .foregroundStyle(.secondary)
            Group {
                TextField("Latitude (−90 to 90)", text: $latitude)
                TextField("Longitude (−180 to 180)", text: $longitude)
            }
            #if os(iOS)
            .keyboardType(.numbersAndPunctuation)
            #endif
            HStack {
                Button("Use Midnight") { save("") }
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    if let location { save("\(location.latitude),\(location.longitude)") }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(location == nil)
            }
        }
        .padding(20)
        #if os(macOS)
        .frame(width: 390)
        #endif
        .onAppear {
            if let saved = DailyNotePreferences.location(storedLocation) {
                latitude = saved.latitude.formatted(.number.grouping(.never).precision(.fractionLength(0...8)))
                longitude = saved.longitude.formatted(.number.grouping(.never).precision(.fractionLength(0...8)))
            }
        }
    }

    private func save(_ value: String) {
        storedLocation = value
        dismiss()
    }
}
