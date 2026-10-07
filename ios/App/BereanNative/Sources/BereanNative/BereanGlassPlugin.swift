import Foundation
import UIKit
import Capacitor

/// Native Liquid Glass controls for the iPhone shell (docs/liquid-glass.md §iOS).
///
/// Berean's UI lives in one WKWebView, and UIKit glass is a view effect: it cannot wrap a DOM
/// element. So the highest-value FUNCTIONAL controls are drawn natively, ABOVE the web view, where
/// glass genuinely refracts the Scripture / notes scrolling beneath it:
///
///   overlay (touch-passthrough)                        ← only the buttons take touches
///     └ cluster  UIVisualEffectView(UIGlassContainerEffect, spacing)   iOS 26+
///         └ item UIVisualEffectView(UIGlassEffect .regular, interactive) + UIButton (SF Symbol)
///
/// React remains the source of truth for layout and behaviour: it keeps an invisible placeholder
/// button per item, reports each placeholder's rect, and receives `press` / `swipe` events which run
/// the same handlers the web buttons ran. Before iOS 26 the items use the system thin material.
///
/// JS ↔ native: `capabilities`, `setControls` (create/update one cluster), `removeControls`;
/// events `press` { cluster, item } and `swipe` { cluster, direction }.
@objc(BereanGlassPlugin)
public class BereanGlassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanGlassPlugin"
    public let jsName = "BereanGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setControls", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeControls", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "debugState", returnType: CAPPluginReturnPromise),
    ]

    private var overlay: PassthroughView?
    private var clusters: [String: GlassCluster] = [:]

    @objc func capabilities(_ call: CAPPluginCall) {
        var glass = false
        if #available(iOS 26.0, *) { glass = true }
        call.resolve([
            "native": true,
            "liquidGlass": glass,
            "grouping": glass,
            "interactive": glass,
            "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
            "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled,
            "reduceMotion": UIAccessibility.isReduceMotionEnabled,
        ])
    }

    private func host() -> PassthroughView? {
        if let o = overlay, o.superview != nil { return o }
        guard let root = bridge?.viewController?.view else { return nil }
        let o = PassthroughView(frame: root.bounds)
        o.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        o.backgroundColor = .clear
        root.addSubview(o) // above the web view (and the native YouTube player)
        overlay = o
        return o
    }

    @objc func setControls(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("missing id"); return }
        let items = call.getArray("items", JSObject.self) ?? []
        let spacing = CGFloat(call.getDouble("spacing") ?? 12)
        let visible = call.getBool("visible") ?? true
        let collapsed = call.getBool("collapsed") ?? false
        let appearance = call.getString("appearance")
        let accent = Self.color(call.getString("accent"))
        DispatchQueue.main.async {
            guard let overlay = self.host(), let web = self.bridge?.webView else { call.reject("no host view"); return }
            let cluster = self.clusters[id] ?? {
                let c = GlassCluster(id: id, spacing: spacing)
                c.onPress = { [weak self] item in self?.notifyListeners("press", data: ["cluster": id, "item": item]) }
                c.onSwipe = { [weak self] dir in self?.notifyListeners("swipe", data: ["cluster": id, "direction": dir]) }
                overlay.addSubview(c.view)
                self.clusters[id] = c
                return c
            }()
            switch appearance {
            case "dark": cluster.view.overrideUserInterfaceStyle = .dark
            case "light": cluster.view.overrideUserInterfaceStyle = .light
            default: cluster.view.overrideUserInterfaceStyle = .unspecified
            }
            cluster.update(items: items, spacing: spacing, accent: accent, web: web, overlay: overlay)
            cluster.setVisible(visible, collapsed: collapsed)
            call.resolve()
        }
    }

    @objc func removeControls(_ call: CAPPluginCall) {
        let id = call.getString("id")
        DispatchQueue.main.async {
            for (k, c) in self.clusters where id == nil || k == id {
                c.view.removeFromSuperview()
                self.clusters.removeValue(forKey: k)
            }
            call.resolve()
        }
    }

    /// Debug builds only (simulator automation): the clusters' native state, and optionally fire an
    /// item's real touchUpInside action — the same path a finger takes after hit-testing.
    @objc func debugState(_ call: CAPPluginCall) {
        #if DEBUG
        let press = call.getString("press")
        DispatchQueue.main.async {
            var out: [String: Any] = [:]
            for (k, c) in self.clusters {
                out[k] = c.debugInfo()
                if let p = press { c.debugPress(p) }
            }
            call.resolve(["clusters": out])
        }
        #else
        call.resolve([:])
        #endif
    }

    static func color(_ hex: String?) -> UIColor? {
        guard var h = hex, h.hasPrefix("#") else { return nil }
        h.removeFirst()
        guard h.count == 6 || h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
        let a = h.count == 8 ? CGFloat(v & 0xff) / 255 : 1
        let rgb = h.count == 8 ? v >> 8 : v
        return UIColor(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: a)
    }
}

/// Touches fall through to the web view everywhere except on a native control.
final class PassthroughView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let v = super.hitTest(point, with: event)
        return v === self ? nil : v
    }
}

/// A glass container that, like the overlay, only takes touches on its member controls — gaps
/// between them (and hidden members) fall through to the web view.
final class PassthroughEffectView: UIVisualEffectView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let v = super.hitTest(point, with: event)
        return (v === self || v === contentView) ? nil : v
    }
}

/// One group of related controls. On iOS 26+ the container effect makes the members behave as one
/// glass system (they blend when within `spacing` and morph together).
final class GlassCluster {
    let id: String
    let view: UIView              // the container (UIVisualEffectView on 26+)
    private var content: UIView { (view as? UIVisualEffectView)?.contentView ?? view }
    private var items: [String: GlassItem] = [:]
    var onPress: ((String) -> Void)?
    var onSwipe: ((String) -> Void)?
    // Starts NOT visible (alpha 0): the first setVisible(true) fades the cluster in, so a control
    // never pops onto the screen (TEST 2026-10-05, cold-launch glass snap).
    private var visible = false
    private var collapsed = false

    init(id: String, spacing: CGFloat) {
        self.id = id
        if #available(iOS 26.0, *) {
            let effect = UIGlassContainerEffect()
            effect.spacing = spacing
            view = PassthroughEffectView(effect: effect)
        } else {
            view = PassthroughView()
        }
        view.backgroundColor = .clear
        view.alpha = 0
        let pan = UIPanGestureRecognizer(target: self, action: #selector(onPan(_:)))
        pan.cancelsTouchesInView = false
        view.addGestureRecognizer(pan)
    }

    @objc private func onPan(_ g: UIPanGestureRecognizer) {
        guard g.state == .ended else { return }
        let t = g.translation(in: view), v = g.velocity(in: view)
        if abs(t.x) > 60 && abs(t.x) > abs(t.y) * 2 && abs(v.x) > 200 { onSwipe?(t.x < 0 ? "next" : "previous") }
    }

    func update(items specs: [JSObject], spacing: CGFloat, accent: UIColor?, web: UIView, overlay: UIView) {
        if #available(iOS 26.0, *), let fx = view as? UIVisualEffectView, let c = fx.effect as? UIGlassContainerEffect, c.spacing != spacing {
            let e = UIGlassContainerEffect(); e.spacing = spacing; fx.effect = e
        }
        // Frames: the cluster spans the union of its items (page coordinates → overlay).
        var frames: [(JSObject, CGRect)] = []
        for s in specs {
            guard let r = s["rect"] as? JSObject, let x = r["x"] as? Double, let y = r["y"] as? Double,
                  let w = r["width"] as? Double, let h = r["height"] as? Double else { continue }
            frames.append((s, web.convert(CGRect(x: x, y: y, width: w, height: h), to: overlay)))
        }
        // Union of the items that have a real rect — a hidden item reports a zero rect at the origin,
        // which used to stretch the cluster's frame to the screen's top-left corner.
        let union = frames.map(\.1).filter { $0.width > 0 && $0.height > 0 }.reduce(CGRect.null) { $0.union($1) }
        // Room on both sides for a labelled capsule that fits its text a little wider than the web one.
        if !union.isNull { view.transform = .identity; view.frame = union.insetBy(dx: -24, dy: -2) }
        var seen = Set<String>()
        for (s, f) in frames {
            guard let itemId = s["id"] as? String else { continue }
            seen.insert(itemId)
            let item = items[itemId] ?? {
                let it = GlassItem(id: itemId)
                it.onPress = { [weak self] in self?.onPress?(itemId) }
                content.addSubview(it.view)
                items[itemId] = it
                return it
            }()
            item.configure(spec: s, accent: accent)
            var frame = f
            if item.hasTitle {
                // A labelled capsule sizes to its own label (never truncated), centred where the
                // web placeholder is.
                let w = max(f.height, item.fittingWidth(height: f.height))
                frame = CGRect(x: f.midX - w / 2, y: f.minY, width: w, height: f.height)
            }
            item.view.frame = frame.offsetBy(dx: -view.frame.minX, dy: -view.frame.minY)
            item.setHidden((s["hidden"] as? Bool) ?? false)
        }
        for (k, it) in items where !seen.contains(k) { it.view.removeFromSuperview(); items.removeValue(forKey: k) }
        applyCollapse(animated: false)
    }

    func debugInfo() -> [String: Any] {
        var it: [String: Any] = [:]
        for (k, v) in items { it[k] = ["frame": NSCoder.string(for: v.view.frame), "hidden": v.isItemHidden, "title": v.debugTitle] }
        return ["frame": NSCoder.string(for: view.frame), "alpha": view.alpha, "interactive": view.isUserInteractionEnabled, "transformY": view.transform.ty, "items": it]
    }

    func debugPress(_ item: String) { items[item]?.debugPress() }

    func setVisible(_ v: Bool, collapsed c: Bool) {
        let changed = v != visible || c != collapsed
        visible = v; collapsed = c
        if changed { applyCollapse(animated: true) }
    }

    private func applyCollapse(animated: Bool) {
        let reduce = UIAccessibility.isReduceMotionEnabled
        let apply = {
            self.view.alpha = self.visible ? 1 : 0
            // Collapsed (reading, scrolled down): slides below the bottom edge like the web bar did.
            self.view.transform = self.collapsed ? CGAffineTransform(translationX: 0, y: self.view.bounds.height + 40) : .identity
        }
        view.isUserInteractionEnabled = visible && !collapsed
        if animated && !reduce { UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseOut, .beginFromCurrentState], animations: apply) }
        else { apply() }
    }
}

/// One glass control: circle or capsule, an SF Symbol, an optional count badge (the tab-cards
/// control shows the number of open tabs on its front card).
final class GlassItem {
    let id: String
    let view: UIVisualEffectView
    private let button = UIButton(type: .custom)
    private var wasProminent = false
    private let badge = UILabel()
    var onPress: (() -> Void)?
    private var symbol = ""

    init(id: String) {
        self.id = id
        if #available(iOS 26.0, *) {
            let g = UIGlassEffect(style: .regular)
            g.isInteractive = true // primary navigation controls only (never content)
            view = UIVisualEffectView(effect: g)
        } else {
            view = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
        }
        // Liquid Glass is shaped by cornerConfiguration and must NOT be clipped: an interactive
        // glass press grows and lights the material past its resting bounds, and clipping cut
        // that off so the control looked like it lost its glass mid-tap (TEST 2026-10-05). Only
        // the pre-26 blur fallback needs clipping for its rounded corners.
        if #unavailable(iOS 26.0) { view.clipsToBounds = true }
        view.alpha = 0
        view.isUserInteractionEnabled = false
        view.contentView.addSubview(button)
        button.frame = view.contentView.bounds
        button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        button.addTarget(self, action: #selector(tap), for: .touchUpInside)
        badge.font = UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .bold)
        badge.textAlignment = .center
        badge.isUserInteractionEnabled = false
        badge.isAccessibilityElement = false
        view.contentView.addSubview(badge)
    }

    // Starts hidden (alpha 0) so the first setHidden(false) fades the new control in.
    private(set) var isItemHidden = true
    var debugTitle: String { button.configuration?.title ?? "" }

    /// Covered by a web sheet / popover / scrim (or off screen): fade out and stop taking touches,
    /// so the web overlay — and the web placeholder React reveals — read as on top.
    func setHidden(_ hidden: Bool) {
        guard hidden != isItemHidden else { return }
        isItemHidden = hidden
        view.isUserInteractionEnabled = !hidden
        let apply = { self.view.alpha = hidden ? 0 : 1 }
        if UIAccessibility.isReduceMotionEnabled { apply() } else { UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState], animations: apply) }
    }

    var hasTitle: Bool { button.configuration?.attributedTitle != nil }
    func fittingWidth(height: CGFloat) -> CGFloat {
        ceil(button.sizeThatFits(CGSize(width: 600, height: height)).width)
    }

    @objc private func tap() { onPress?() }

    func debugPress() { button.sendActions(for: .touchUpInside) }

    func configure(spec: JSObject, accent: UIColor?) {
        let sym = spec["symbol"] as? String ?? "circle"
        let prominent = spec["prominent"] as? Bool ?? false
        let size = CGFloat(spec["iconSize"] as? Double ?? 20)
        let title = spec["title"] as? String
        if let title, !title.isEmpty {
            // A labelled capsule (the reader's passage title): symbol + semibold title (+ subtitle).
            let fontSize = CGFloat(spec["fontSize"] as? Double ?? 15)
            let padX = CGFloat(spec["paddingX"] as? Double ?? 12)
            var c = UIButton.Configuration.plain()
            c.image = UIImage(systemName: sym, withConfiguration: UIImage.SymbolConfiguration(pointSize: fontSize * 0.85, weight: .semibold))
            c.imagePadding = 7
            c.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: padX, bottom: 0, trailing: padX)
            c.titleLineBreakMode = .byTruncatingTail // one line, always — the web capsule set the width
            var t = AttributedString(title)
            t.font = UIFont.systemFont(ofSize: fontSize, weight: .semibold)
            if let sub = spec["subtitle"] as? String, !sub.isEmpty {
                var st = AttributedString("  " + sub)
                st.font = UIFont.systemFont(ofSize: fontSize * 0.75, weight: .semibold)
                st.foregroundColor = UIColor.secondaryLabel
                t.append(st)
            }
            c.attributedTitle = t
            c.baseForegroundColor = .label
            button.configuration = c
            symbol = ""
        } else if sym != symbol || prominent != wasProminent {
            symbol = sym
            var c = UIButton.Configuration.plain()
            let cfg = UIImage.SymbolConfiguration(pointSize: size, weight: prominent ? .semibold : .medium)
            c.image = UIImage(systemName: sym, withConfiguration: cfg)
            c.contentInsets = .zero
            c.background.backgroundColor = .clear
            button.configuration = c
        }
        wasProminent = prominent
        // The glyph keeps full strength while pressed (TEST 2026-10-06, verified with a real held
        // touch in the simulator): a .system button dims its image on highlight, and together with
        // the interactive glass brightening that read as "the button stops being glass" — a milky
        // disc with a vanished chevron. The press feedback is the GLASS's own interactive response
        // (UIGlassEffect.isInteractive); the button never restyles itself for state.
        button.automaticallyUpdatesConfiguration = false
        button.configuration?.baseForegroundColor = prominent ? (accent ?? view.tintColor) : .label
        button.tintColor = prominent ? (accent ?? view.tintColor) : .label
        button.accessibilityLabel = spec["label"] as? String
        button.accessibilityTraits = .button
        let b = spec["badge"] as? String
        badge.text = b
        badge.isHidden = (b ?? "").isEmpty
        badge.textColor = .label
        if #available(iOS 26.0, *) {
            view.cornerConfiguration = .capsule()
        } else {
            view.layer.cornerRadius = min(view.bounds.width, view.bounds.height) / 2
            view.layer.cornerCurve = .continuous
        }
        DispatchQueue.main.async { [weak self] in self?.layoutBadge() }
    }

    private func layoutBadge() {
        // The count sits on the front card of `square.on.square` (offset down-right of centre).
        let c = CGPoint(x: view.bounds.midX + 2.5, y: view.bounds.midY + 2.5)
        badge.frame = CGRect(x: c.x - 9, y: c.y - 8, width: 18, height: 16)
        if #unavailable(iOS 26.0) { view.layer.cornerRadius = min(view.bounds.width, view.bounds.height) / 2 }
    }
}
