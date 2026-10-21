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
        let collapseToTop = call.getString("collapseEdge") == "top"
        var collapseRect: CGRect?
        if let r = call.getObject("collapseRect"), let x = r["x"] as? Double, let y = r["y"] as? Double,
           let w = r["width"] as? Double, let h = r["height"] as? Double, w > 0, h > 0 {
            collapseRect = CGRect(x: x, y: y, width: w, height: h)
        }
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
            cluster.collapseToTop = collapseToTop
            cluster.collapseTarget = collapseRect.map { web.convert($0, to: overlay) }
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
    /// Collapsed clusters slide off the bottom edge (the bottom bar) or the top (the reader's title,
    /// which rides with the page header as it slides away).
    var collapseToTop = false
    /// Collapse by MORPHING into this rect (overlay coordinates) instead of sliding off an edge:
    /// the reader's passage capsule shrinks and rises into the compact pill at the Dynamic Island /
    /// notch while it fades, and the web pill grows out of the capsule's shape along the same path
    /// with the same curve — one shape turning into the other.
    var collapseTarget: CGRect?
    private var collapseAnimator: UIViewPropertyAnimator?
    /// The cluster's untransformed origin in the overlay (item frames are relative to it).
    private var restingOrigin: CGPoint = .zero

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
        // Laid out through bounds + center, which (unlike `frame`) stay valid under a transform: an
        // update arriving while the cluster slides in / out no longer resets the transform to
        // identity mid-animation (a visible snap of the whole cluster).
        if !union.isNull {
            let box = union.insetBy(dx: -24, dy: -2)
            view.bounds = CGRect(origin: .zero, size: box.size)
            view.center = CGPoint(x: box.midX, y: box.midY)
            restingOrigin = box.origin
        }
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
            item.view.frame = frame.offsetBy(dx: -restingOrigin.x, dy: -restingOrigin.y)
            item.view.layoutIfNeeded() // the label lays out in its new width this pass
            item.setHidden((s["hidden"] as? Bool) ?? false)
        }
        for (k, it) in items where !seen.contains(k) { it.view.removeFromSuperview(); items.removeValue(forKey: k) }
        // Re-assert the resting / collapsed state — unless a collapse animation is running, which
        // owns the transform until it finishes.
        if collapseAnimator?.isRunning != true { applyCollapse(animated: false) }
    }

    func debugInfo() -> [String: Any] {
        var it: [String: Any] = [:]
        for (k, v) in items { it[k] = ["frame": NSCoder.string(for: v.view.frame), "hidden": v.isItemHidden, "title": v.debugTitle, "label": v.debugLabel] }
        return ["frame": NSCoder.string(for: view.frame), "alpha": view.alpha, "interactive": view.isUserInteractionEnabled, "transformY": view.transform.ty, "items": it]
    }

    func debugPress(_ item: String) { items[item]?.debugPress() }

    func setVisible(_ v: Bool, collapsed c: Bool) {
        let changed = v != visible || c != collapsed
        visible = v; collapsed = c
        if changed { applyCollapse(animated: true) }
    }

    /// The transform that lays the cluster's (first) control exactly over `target`.
    private func morphTransform(into target: CGRect) -> CGAffineTransform {
        let item = items.values.map(\.view.frame).first ?? CGRect(origin: .zero, size: view.bounds.size)
        guard item.width > 0, item.height > 0 else { return .identity }
        let sx = target.width / item.width, sy = target.height / item.height
        // Where the control's centre is with no transform, relative to the cluster's centre (the
        // transform's anchor), and where it has to end up.
        let rel = CGPoint(x: item.midX - view.bounds.midX, y: item.midY - view.bounds.midY)
        let tx = target.midX - view.center.x - sx * rel.x, ty = target.midY - view.center.y - sy * rel.y
        return CGAffineTransform(translationX: tx, y: ty).scaledBy(x: sx, y: sy)
    }

    private func applyCollapse(animated: Bool) {
        let reduce = UIAccessibility.isReduceMotionEnabled
        let morph = collapseToTop ? collapseTarget : nil
        let apply = {
            // Morphing: the capsule fades as it turns into the pill. Sliding: stays opaque.
            self.view.alpha = self.visible && !(self.collapsed && morph != nil) ? 1 : 0
            // Collapsed (reading, scrolled down): morphs into the compact pill (the reader's title) or
            // slides off its edge with the web chrome (below the bottom edge for the bottom bar).
            let offTop = -(self.restingOrigin.y + self.view.bounds.height + 40)
            if !self.collapsed { self.view.transform = .identity }
            else if let t = morph, !reduce { self.view.transform = self.morphTransform(into: t) }
            else if morph != nil { self.view.transform = .identity } // reduced motion: a cross-fade in place
            else { self.view.transform = CGAffineTransform(translationX: 0, y: self.collapseToTop ? offTop : self.view.bounds.height + 40) }
        }
        view.isUserInteractionEnabled = visible && !collapsed
        if animated && (!reduce || morph != nil) {
            // The web chrome's own curve and duration (mobile.css --m-chrome-dur / --m-chrome-ease:
            // 0.34s cubic-bezier(0.32, 0.72, 0, 1)), so the native controls and the web header / bar
            // / pill move as one. A reversal mid-way (scroll down, then straight back up) continues
            // from where the cluster IS: stopping the running animator leaves the view where it is.
            // Reduced motion: the morph becomes a short cross-fade in place; a slide is instant (as the
            // web bar's is).
            collapseAnimator?.stopAnimation(true)
            let anim = reduce
                ? UIViewPropertyAnimator(duration: 0.12, curve: .linear, animations: apply)
                : UIViewPropertyAnimator(duration: 0.34, controlPoint1: CGPoint(x: 0.32, y: 0.72), controlPoint2: CGPoint(x: 0, y: 1), animations: apply)
            collapseAnimator = anim
            anim.startAnimation()
        } else { collapseAnimator?.stopAnimation(true); collapseAnimator = nil; apply() }
    }
}

/// One glass control: circle or capsule, an SF Symbol, an optional count badge (the tab-cards
/// control shows the number of open tabs on its front card).
final class GlassItem {
    let id: String
    let view: UIVisualEffectView
    private var button = UIButton(type: .custom)
    private var wasProminent = false
    /// The title the current button was built with (labelled capsules only).
    private var builtTitle: String?
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
    var debugLabel: [String: Any] {
        guard let l = button.titleLabel else { return ["none": true] }
        return ["text": l.text ?? "", "frame": NSCoder.string(for: l.frame), "alpha": l.alpha, "hidden": l.isHidden, "button": NSCoder.string(for: button.frame), "superview": l.superview != nil]
    }

    /// Covered by a web sheet / popover / scrim (or off screen): fade out and stop taking touches,
    /// so the web overlay — and the web placeholder React reveals — read as on top.
    func setHidden(_ hidden: Bool) {
        guard hidden != isItemHidden else { return }
        isItemHidden = hidden
        view.isUserInteractionEnabled = !hidden
        let apply = { self.view.alpha = hidden ? 0 : 1 }
        // Hiding is instant: the item is hidden because a web sheet / popover / scrim is now ABOVE
        // it, and fading out would draw it over that overlay for a couple of frames (G-07).
        // Re-appearing fades in, so a control never pops onto the screen.
        if hidden || UIAccessibility.isReduceMotionEnabled {
            view.layer.removeAllAnimations()
            apply()
        } else {
            UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState], animations: apply)
        }
    }

    var hasTitle: Bool { button.configuration?.attributedTitle != nil }
    /// The labelled capsule's natural width, measured from its own parts (TEST 2026-10-17 "that label
    /// of the book and chapter goes away"): `sizeThatFits` on an existing button returned the size of
    /// its PREVIOUS configuration after the title changed (Find on Page jumping Genesis 2 → 8 gave a
    /// 55 pt capsule), so the new title truncated to nothing and only the book glyph showed.
    func fittingWidth(height: CGFloat) -> CGFloat {
        guard let c = button.configuration, let t = c.attributedTitle else {
            return ceil(button.sizeThatFits(CGSize(width: 600, height: height)).width)
        }
        let text = NSAttributedString(t).boundingRect(with: CGSize(width: 2000, height: height), options: [.usesLineFragmentOrigin], context: nil).width
        let image = c.image?.size.width ?? 0
        let gap = c.image != nil ? c.imagePadding : 0
        let parts = text + image + gap + c.contentInsets.leading + c.contentInsets.trailing
        // UIButton adds a little internal spacing of its own; with the configuration applied
        // (configure → updateConfiguration) sizeThatFits is current, so take the larger + a hair.
        button.updateConfiguration()
        let fitted = button.sizeThatFits(CGSize(width: 600, height: height)).width
        return ceil(max(parts, fitted) + 6)
    }

    @objc private func tap() { onPress?() }

    private func replaceButton() {
        let fresh = UIButton(type: .custom)
        fresh.frame = view.contentView.bounds
        fresh.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        fresh.addTarget(self, action: #selector(tap), for: .touchUpInside)
        view.contentView.insertSubview(fresh, belowSubview: badge)
        button.removeFromSuperview()
        button = fresh
        symbol = ""
        wasProminent = false
    }

    func debugPress() { button.sendActions(for: .touchUpInside) }

    func configure(spec: JSObject, accent: UIColor?) {
        let sym = spec["symbol"] as? String ?? "circle"
        let prominent = spec["prominent"] as? Bool ?? false
        let size = CGFloat(spec["iconSize"] as? Double ?? 20)
        let title = spec["title"] as? String
        if let title, !title.isEmpty {
            // A NEW title gets a fresh button (TEST 2026-10-17 "that label of the book and chapter
            // goes away"): re-configuring an existing UIButton with a different attributed title
            // kept the label laid out for the old content — after Find on Page jumped Genesis 2 → 8
            // only the book glyph was drawn. A first configuration always lays out correctly, so a
            // title change (a chapter change: rare) rebuilds the button the same way.
            let fullTitle = title + ((spec["subtitle"] as? String) ?? "")
            if let built = builtTitle, built != fullTitle { replaceButton() }
            builtTitle = fullTitle
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
        // Apply the configuration NOW (automaticallyUpdatesConfiguration is off): a changed title
        // was otherwise laid out with the previous content size — a zero-width label, so only the
        // book glyph showed (TEST 2026-10-17). Measuring with sizeThatFits used to force this as a
        // side effect; fittingWidth no longer relies on it.
        button.updateConfiguration()
        button.setNeedsLayout()
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
