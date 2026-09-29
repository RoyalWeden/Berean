import Foundation
import Capacitor
import CoreLocation

/// Foreground-only location for the daily-note sunrise boundary (src/platform/ios/location.ts).
///
/// Berean needs one approximate fix now and then, while the app is open, to work out local
/// sunrise; it never tracks location and never runs location in the background. So this plugin
/// can only ask for "When In Use" (`requestWhenInUseAuthorization`) and read a single fix
/// (`requestLocation`). It replaces @capacitor/geolocation on iOS, whose bundled library also
/// links `requestAlwaysAuthorization` — enough for App Store Connect to demand an "Always"
/// purpose string (ITMS-90683) for a permission Berean never asks for.
@objc(BereanLocationPlugin)
public class BereanLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BereanLocationPlugin"
    public let jsName = "BereanLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise),
    ]

    private var manager: CLLocationManager?
    private var permissionCalls: [CAPPluginCall] = []
    private var positionCalls: [CAPPluginCall] = []
    private var timeoutWork: DispatchWorkItem?

    private func locationManager() -> CLLocationManager {
        if let m = manager { return m }
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyKilometer // sunrise needs the town, not the street
        manager = m
        return m
    }

    private func state(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedWhenInUse, .authorizedAlways: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "denied"
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["location": self.state(self.locationManager().authorizationStatus)])
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.locationManager()
            guard m.authorizationStatus == .notDetermined else {
                call.resolve(["location": self.state(m.authorizationStatus)])
                return
            }
            self.permissionCalls.append(call)
            m.requestWhenInUseAuthorization()
        }
    }

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        let maximumAge = call.getDouble("maximumAge") ?? 0 // ms
        let timeout = call.getDouble("timeout") ?? 10_000 // ms
        DispatchQueue.main.async { [self] in
            let m = self.locationManager()
            let status = m.authorizationStatus
            guard status == .authorizedWhenInUse || status == .authorizedAlways else {
                call.reject("Location permission not granted")
                return
            }
            if let last = m.location, -last.timestamp.timeIntervalSinceNow * 1000 <= maximumAge {
                call.resolve(self.payload(last))
                return
            }
            self.positionCalls.append(call)
            if self.positionCalls.count == 1 {
                m.requestLocation()
                let work = DispatchWorkItem { [weak self] in self?.finishPosition(error: "Location request timed out") }
                self.timeoutWork = work
                DispatchQueue.main.asyncAfter(deadline: .now() + timeout / 1000, execute: work)
            }
        }
    }

    private func payload(_ loc: CLLocation) -> [String: Any] {
        return [
            "timestamp": loc.timestamp.timeIntervalSince1970 * 1000,
            "coords": [
                "latitude": loc.coordinate.latitude,
                "longitude": loc.coordinate.longitude,
                "accuracy": loc.horizontalAccuracy,
            ],
        ]
    }

    private func finishPosition(location: CLLocation? = nil, error: String? = nil) {
        timeoutWork?.cancel()
        timeoutWork = nil
        let calls = positionCalls
        positionCalls.removeAll()
        for call in calls {
            if let loc = location { call.resolve(payload(loc)) } else { call.reject(error ?? "Location unavailable") }
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .notDetermined { return }
        let calls = permissionCalls
        permissionCalls.removeAll()
        for call in calls { call.resolve(["location": state(status)]) }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        finishPosition(location: locations.last)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finishPosition(error: error.localizedDescription)
    }
}
