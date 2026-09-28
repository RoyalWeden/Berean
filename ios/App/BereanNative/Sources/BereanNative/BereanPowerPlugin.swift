import Foundation
import Capacitor

/// Power / thermal awareness (R103), the phone's counterpart of electron/powerAwareness.ts:
/// `getResourceMode` is "throttled" while Low Power Mode is on or the thermal state is
/// serious/critical, "normal" otherwise; `change` events fire on either signal. The renderer's
/// polling loops (YouTube tab) already back off on "throttled".
@objc(BereanPowerPlugin)
public class BereanPowerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanPowerPlugin"
    public let jsName = "BereanPower"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getResourceMode", returnType: CAPPluginReturnPromise),
    ]
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in self?.emit() })
        observers.append(nc.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.emit() })
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    private func mode() -> String {
        let info = ProcessInfo.processInfo
        let hot = info.thermalState == .serious || info.thermalState == .critical
        return (info.isLowPowerModeEnabled || hot) ? "throttled" : "normal"
    }
    private func emit() { notifyListeners("change", data: ["mode": mode()]) }

    @objc func getResourceMode(_ call: CAPPluginCall) {
        let info = ProcessInfo.processInfo
        call.resolve(["mode": mode(), "lowPowerMode": info.isLowPowerModeEnabled, "thermalState": info.thermalState.rawValue])
    }
}
