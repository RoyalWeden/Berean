import Foundation
import Testing
import BereanNotes

struct DailyNoteDayTests {
    @Test func sunriseOnDaylightSavingTransitionAndMonthBoundary() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let sanFrancisco = try #require(DailyNoteDay.Location(latitude: 37.7749, longitude: -122.4194))
        let formatter = ISO8601DateFormatter()

        // March 8 switches to PDT. Compare the native approximation with SunCalc 2.0.1.
        let marchMorning = try #require(formatter.date(from: "2026-03-08T14:00:00Z"))
        let sunrise = try #require(DailyNoteDay.sunrise(on: marchMorning, at: sanFrancisco, calendar: calendar))
        let approximateSunrise = try #require(formatter.date(from: "2026-03-08T14:30:53Z"))
        #expect(abs(sunrise.timeIntervalSince(approximateSunrise)) < 2 * 60)
        #expect(DailyNoteDay.dateKey(DailyNoteDay.anchor(sunrise.addingTimeInterval(-1), location: sanFrancisco, calendar: calendar), calendar: calendar) == "2026-03-07")
        #expect(DailyNoteDay.dateKey(DailyNoteDay.anchor(sunrise, location: sanFrancisco, calendar: calendar), calendar: calendar) == "2026-03-08")

        let mayFirst = try #require(formatter.date(from: "2026-05-01T07:15:00Z"))
        #expect(DailyNoteDay.dateKey(DailyNoteDay.anchor(mayFirst, location: sanFrancisco, calendar: calendar), calendar: calendar) == "2026-04-30")
    }

    @Test func missingLocationAndPolarDayUseMidnight() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "Europe/Oslo"))
        let date = try #require(ISO8601DateFormatter().date(from: "2026-06-21T00:15:00Z"))
        let tromso = try #require(DailyNoteDay.Location(latitude: 69.65, longitude: 18.96))
        #expect(DailyNoteDay.sunrise(on: date, at: tromso, calendar: calendar) == nil)
        #expect(DailyNoteDay.anchor(date, location: tromso, calendar: calendar) == date)
        #expect(DailyNoteDay.anchor(date, location: nil, calendar: calendar) == date)
        #expect(DailyNoteDay.Location(latitude: 91, longitude: 0) == nil)
        #expect(DailyNoteDay.Location(latitude: 0, longitude: .nan) == nil)
    }
}
