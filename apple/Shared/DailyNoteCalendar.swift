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
    @State private var showMonthPicker = false
    @State private var weekAnchor: Date?
    @AppStorage(DailyNotePreferences.locationKey) private var storedLocation = ""

    private static var calendar: Calendar {
        var calendar = DailyNoteDay.localCalendar
        calendar.locale = .autoupdatingCurrent
        return calendar
    }
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

    private func days(inWeekOf date: Date) -> [Date] {
        let calendar = Self.calendar
        let day = calendar.startOfDay(for: date)
        let leading = calendar.component(.weekday, from: day) - 1
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0 - leading, to: day) }
    }

    private func periodTitle(month: Date, week: [Date]) -> String {
        guard let first = week.first, let last = week.last else {
            return month.formatted(.dateTime.month(.wide).year())
        }
        let style: Date.FormatStyle = .dateTime.month(.abbreviated).day()
        if Self.calendar.isDate(first, equalTo: last, toGranularity: .year) {
            return "\(first.formatted(style)) – \(last.formatted(style.year()))"
        }
        return "\(first.formatted(style.year())) – \(last.formatted(style.year()))"
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
        let week = weekAnchor.map { days(inWeekOf: $0) } ?? []
        let period = weekAnchor == nil ? "Month" : "Week"
        return ScrollView {
            VStack(spacing: 12) {
                HStack {
                    Button { step(-1, from: month) } label: { Label("Previous \(period)", systemImage: "chevron.left").labelStyle(.iconOnly) }
                    Spacer()
                    periodHeader(month: month, week: week)
                    Spacer()
                    Button { step(1, from: month) } label: { Label("Next \(period)", systemImage: "chevron.right").labelStyle(.iconOnly) }
                }
                LazyVGrid(columns: columns, spacing: 4) {
                    ForEach(Array(Self.calendar.veryShortStandaloneWeekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                        Text(symbol).font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    ForEach(week.isEmpty ? days(in: month) : week, id: \.self) { day in
                        dayButton(day, isInPeriod: !week.isEmpty || Self.calendar.isDate(day, equalTo: month, toGranularity: .month),
                                  today: today)
                    }
                }
                if indexError {
                    Text("Could not load daily notes.").foregroundStyle(.secondary)
                }
                HStack {
                    Button("Current \(period)") {
                        let today = DailyNotePreferences.today()
                        if weekAnchor == nil { saveMonth(today) }
                        else { weekAnchor = today }
                    }
                    Button("Today’s Note") {
                        let today = DailyNotePreferences.today()
                        let key = DailyNoteDay.dateKey(today)
                        selectDate(today, key: key)
                    }
                    Button(weekAnchor == nil ? "Show Week" : "Show Month",
                           systemImage: weekAnchor == nil ? "calendar.day.timeline.leading" : "calendar") {
                        weekAnchor = weekAnchor == nil ? today : nil
                    }
                    .labelStyle(.iconOnly)
                    #if os(macOS)
                    .help(weekAnchor == nil ? "Show Week" : "Show Month")
                    #endif
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

    @ViewBuilder private func periodHeader(month: Date, week: [Date]) -> some View {
        let title = Text(periodTitle(month: month, week: week))
            .font(.title2.weight(.semibold))
            .multilineTextAlignment(.center)
        if weekAnchor == nil {
            Button {
                showMonthPicker = true
            } label: {
                title
                    .padding(.horizontal, 6)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint("Choose a month and year")
            .help("Jump to Month and Year")
            .popover(isPresented: $showMonthPicker) {
                CalendarMonthPicker(date: month, calendar: Self.calendar) { saveMonth($0) }
            }
        } else {
            title.accessibilityAddTraits(.isHeader)
        }
    }

    private func dayButton(_ date: Date, isInPeriod: Bool, today anchor: Date) -> some View {
        let key = DailyNoteDay.dateKey(date)
        let selected = app.findTab(tabId)?.state["selected"]?.stringValue?.string == key
        let today = Self.calendar.isDate(date, inSameDayAs: anchor)
        return Button {
            selectDate(date, key: key)
        } label: {
            VStack(spacing: 2) {
                // Today: white number on an accent circle (as in Calendar); other days plain.
                Text(Self.calendar.component(.day, from: date), format: .number)
                    .fontWeight(today || selected ? .semibold : .regular)
                    .foregroundStyle(today ? AnyShapeStyle(.white) : isInPeriod ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                    .frame(width: 30, height: 30)
                    .background(today ? Color.accentColor : Color.clear, in: .circle)
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
        if let weekAnchor {
            self.weekAnchor = Self.calendar.date(byAdding: .day, value: delta * 7, to: weekAnchor) ?? weekAnchor
        } else if let date = Self.calendar.date(byAdding: .month, value: delta, to: month) {
            saveMonth(date)
        }
    }

    private func selectDate(_ date: Date, key: String) {
        if weekAnchor != nil { weekAnchor = date }
        saveMonth(weekAnchor == nil ? date : nil, selected: key)
        app.openDailyNote(key)
    }

    private func saveMonth(_ date: Date?, selected: String? = nil) {
        app.update(tabId, recordHistory: false) { tab in
            if let date { tab.state["month"] = .string(JSString(String(DailyNoteDay.dateKey(date).prefix(7)))) }
            if let selected { tab.state["selected"] = .string(JSString(selected)) }
        }
    }
}

private struct CalendarMonthPicker: View {
    @Environment(\.dismiss) private var dismiss
    @State private var month: Int
    @State private var year: String
    let calendar: Calendar
    let onChoose: (Date) -> Void

    init(date: Date, calendar: Calendar, onChoose: @escaping (Date) -> Void) {
        self.calendar = calendar
        self.onChoose = onChoose
        _month = State(initialValue: calendar.component(.month, from: date))
        _year = State(initialValue: String(calendar.component(.year, from: date)))
    }

    private var destination: Date? {
        guard let year = Int(year.trimmingCharacters(in: .whitespacesAndNewlines)),
              (1...9999).contains(year) else { return nil }
        return calendar.date(from: DateComponents(year: year, month: month, day: 1))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Jump to Month").font(.headline).accessibilityAddTraits(.isHeader)
            Picker("Month", selection: $month) {
                ForEach(Array(calendar.standaloneMonthSymbols.enumerated()), id: \.offset) { offset, name in
                    Text(name).tag(offset + 1)
                }
            }
            .pickerStyle(.menu)
            TextField("Year", text: $year)
                .accessibilityLabel("Year")
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .onSubmit(choose)
            HStack {
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Go", action: choose)
                    .keyboardShortcut(.defaultAction)
                    .disabled(destination == nil)
            }
        }
        .padding(20)
        .frame(idealWidth: 300)
    }

    private func choose() {
        guard let destination else { return }
        onChoose(destination)
        dismiss()
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
