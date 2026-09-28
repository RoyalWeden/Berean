import Foundation
import UIKit
import Capacitor

/// Accessibility signals for the phone shell (R082 / R102): Dynamic Type category (as a scale the
/// CSS applies to its font sizes), VoiceOver, Reduce Motion, Bold Text, Increase Contrast, Reduce
/// Transparency (the iOS material system falls back to opaque surfaces — SEP24 design system). Emits
/// `change` whenever any of them changes.
@objc(BereanA11yPlugin)
public class BereanA11yPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanA11yPlugin"
    public let jsName = "BereanA11y"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    ]
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let nc = NotificationCenter.default
        for name: Notification.Name in [UIContentSizeCategory.didChangeNotification, UIAccessibility.voiceOverStatusDidChangeNotification,
                                        UIAccessibility.reduceMotionStatusDidChangeNotification, UIAccessibility.boldTextStatusDidChangeNotification,
                                        UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
                                        UIAccessibility.reduceTransparencyStatusDidChangeNotification] {
            observers.append(nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self = self else { return }
                self.notifyListeners("change", data: self.state())
            })
        }
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    /// Dynamic Type category → multiplier for the shell's CSS font sizes (Large = 1.0, the iOS
    /// default; the same steps UIFontMetrics uses for body text, capped so layouts stay usable).
    private func scale(for c: UIContentSizeCategory) -> Double {
        switch c {
        case .extraSmall: return 0.82
        case .small: return 0.88
        case .medium: return 0.94
        case .large: return 1.0
        case .extraLarge: return 1.12
        case .extraExtraLarge: return 1.24
        case .extraExtraExtraLarge: return 1.35
        case .accessibilityMedium: return 1.5
        case .accessibilityLarge: return 1.6
        case .accessibilityExtraLarge, .accessibilityExtraExtraLarge, .accessibilityExtraExtraExtraLarge: return 1.7
        default: return 1.0
        }
    }

    private func state() -> [String: Any] {
        let c = UIApplication.shared.preferredContentSizeCategory
        return [
            "contentSize": c.rawValue,
            "scale": scale(for: c),
            "voiceOver": UIAccessibility.isVoiceOverRunning,
            "reduceMotion": UIAccessibility.isReduceMotionEnabled,
            "boldText": UIAccessibility.isBoldTextEnabled,
            "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled,
            "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
        ]
    }

    @objc func getState(_ call: CAPPluginCall) { call.resolve(state()) }
}
