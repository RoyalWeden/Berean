import Foundation

public enum DailyNoteDay {
    public struct Location: Equatable, Sendable {
        public let latitude: Double
        public let longitude: Double

        public init?(latitude: Double, longitude: Double) {
            guard (-90...90).contains(latitude), (-180...180).contains(longitude) else { return nil }
            self.latitude = latitude
            self.longitude = longitude
        }
    }

    public static var localCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .autoupdatingCurrent
        return calendar
    }

    public static func dateKey(_ date: Date, calendar: Calendar = localCalendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public static func anchor(
        _ now: Date, location: Location?, calendar: Calendar = localCalendar
    ) -> Date {
        guard let location, let sunrise = sunrise(on: now, at: location, calendar: calendar), now < sunrise else {
            return now
        }
        return calendar.date(byAdding: .day, value: -1, to: now) ?? now
    }

    public static func sunrise(on date: Date, at location: Location, calendar: Calendar) -> Date? {
        // Use local noon to choose the solar cycle for the civil date even just after midnight.
        guard let noon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date) else { return nil }
        let radians = Double.pi / 180
        let julianUnixEpoch = 2_440_587.5
        let julianJ2000 = 2_451_545.0
        let days = noon.timeIntervalSince1970 / 86_400 + julianUnixEpoch - julianJ2000
        let west = -location.longitude * radians
        let latitude = location.latitude * radians

        // Approximate solar transit with an apparent horizon of -0.833 degrees.
        let cycle = (days - 0.0009 - west / (2 * .pi)).rounded(.toNearestOrAwayFromZero)
        let transit = 0.0009 + west / (2 * .pi) + cycle
        let anomaly = radians * (357.5291 + 0.98560028 * transit)
        let center = radians * (1.9148 * sin(anomaly) + 0.0200 * sin(2 * anomaly) + 0.0003 * sin(3 * anomaly))
        let longitude = anomaly + center + radians * 102.9372 + .pi
        let declination = asin(sin(longitude) * sin(radians * 23.4397))
        let solarNoon = julianJ2000 + transit + 0.0053 * sin(anomaly) - 0.0069 * sin(2 * longitude)
        let cosine = (sin(-0.833 * radians) - sin(latitude) * sin(declination)) / (cos(latitude) * cos(declination))
        guard (-1...1).contains(cosine) else { return nil }
        let julianSunrise = solarNoon - acos(cosine) / (2 * .pi)
        let sunrise = Date(timeIntervalSince1970: (julianSunrise - julianUnixEpoch) * 86_400)
        return calendar.isDate(sunrise, inSameDayAs: date) ? sunrise : nil
    }
}
