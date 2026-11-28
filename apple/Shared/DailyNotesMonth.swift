import SwiftUI
import BereanNotes

/// Date discovery inside the Daily Notes folder. Opening a day uses the same
/// existing-note identity/reuse path as the standalone calendar.
struct DailyNotesMonth: View {
    let noteDates: Set<String>
    let chooseDate: (Date) -> Void
    let openDay: (Date) -> Void
    @State private var displayed = DailyNotePreferences.today()

    private var calendar: Calendar {
        var calendar = DailyNoteDay.localCalendar
        calendar.locale = .autoupdatingCurrent
        calendar.firstWeekday = Calendar.autoupdatingCurrent.firstWeekday
        return calendar
    }

    var body: some View {
        let month = calendar.dateInterval(of: .month, for: displayed)?.start ?? displayed
        let leading = (calendar.component(.weekday, from: month) - calendar.firstWeekday + 7) % 7
        let count = calendar.range(of: .day, in: .month, for: month)?.count ?? 0
        let weekdays = calendar.veryShortStandaloneWeekdaySymbols
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button { step(-1) } label: { Label("Previous Month", systemImage: "chevron.left") }
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
                Button { chooseDate(displayed) } label: {
                    Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
                Button { step(1) } label: { Label("Next Month", systemImage: "chevron.right") }
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
            }
            .buttonStyle(.interactivePlain)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 2) {
                ForEach(0..<7, id: \.self) { index in
                    Text(weekdays[(index + calendar.firstWeekday - 1) % 7])
                        .font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                }
                ForEach(0..<(leading + count), id: \.self) { index in
                    if index < leading {
                        Color.clear.frame(height: 44).accessibilityHidden(true)
                    } else if let day = calendar.date(byAdding: .day, value: index - leading, to: month) {
                        dayButton(day)
                    }
                }
            }
            HStack {
                Label("Days with notes", systemImage: "circle.fill")
                    .font(.caption).foregroundStyle(.secondary)
                    .labelStyle(DailyNoteDotLabelStyle())
                Spacer()
                Button("Today") { withAnimation(.snappy) { displayed = DailyNotePreferences.today() } }
                    .buttonStyle(.interactivePlain).frame(minHeight: 36)
            }
        }
        .frame(maxWidth: 420)
        .padding(.bottom, 12)
    }

    private func step(_ amount: Int) {
        guard let start = calendar.dateInterval(of: .month, for: displayed)?.start,
              let next = calendar.date(byAdding: .month, value: amount, to: start) else { return }
        withAnimation(.snappy) { displayed = next }
    }

    private func dayButton(_ day: Date) -> some View {
        let hasNote = noteDates.contains(DailyNoteDay.dateKey(day))
        let today = calendar.isDate(day, inSameDayAs: DailyNotePreferences.today())
        return Button { openDay(day) } label: {
            VStack(spacing: 3) {
                Text(String(calendar.component(.day, from: day)))
                    .font(.body.weight(today ? .semibold : .regular))
                    .foregroundStyle(today ? Color.accentColor : Color.primary)
                Circle().fill(Color.accentColor).frame(width: 4, height: 4).opacity(hasNote ? 1 : 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(today ? Color.accentColor.opacity(0.09) : Color.clear, in: .rect(cornerRadius: 10))
            .contentShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))
        .accessibilityHint(hasNote ? "Open existing daily note" : "Create daily note")
    }
}

private struct DailyNoteDotLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon.font(.system(size: 4)).foregroundStyle(Color.accentColor)
            configuration.title
        }
    }
}
