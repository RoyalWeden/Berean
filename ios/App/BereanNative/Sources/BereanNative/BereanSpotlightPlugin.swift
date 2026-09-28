import Foundation
import CoreSpotlight
import UniformTypeIdentifiers
import Capacitor

/// Core Spotlight indexing (docs/mobile Phase 18, R093): notes (and later verse tags) become
/// searchable from the iOS home screen. Each item's unique identifier is a Berean deep link
/// (`berean://note/<id>`), so a Spotlight tap is routed exactly like any other deep link:
/// AppDelegate hands the continuation activity to `handleContinuation`, which emits `open`.
@objc(BereanSpotlightPlugin)
public class BereanSpotlightPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanSpotlightPlugin"
    public let jsName = "BereanSpotlight"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "index", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
    ]
    static let domain = "app.berean.notes"
    static weak var current: BereanSpotlightPlugin?
    private static var pending: [String] = []

    public override func load() { BereanSpotlightPlugin.current = self; flushPending() }

    /// Called from AppDelegate for `CSSearchableItemActionType` activities.
    public static func handleContinuation(_ activity: NSUserActivity) -> Bool {
        guard activity.activityType == CSSearchableItemActionType,
              let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return false }
        if let plugin = current { plugin.notifyListeners("open", data: ["url": id]) } else { pending.append(id) }
        return true
    }
    private func flushPending() {
        for id in BereanSpotlightPlugin.pending { notifyListeners("open", data: ["url": id]) }
        BereanSpotlightPlugin.pending.removeAll()
    }

    @objc func isAvailable(_ call: CAPPluginCall) { call.resolve(["available": CSSearchableIndex.isIndexingAvailable()]) }

    @objc func index(_ call: CAPPluginCall) {
        guard let items = call.getArray("items") as? [[String: Any]] else { call.reject("missing items"); return }
        let searchable: [CSSearchableItem] = items.compactMap { it in
            guard let url = it["url"] as? String, let title = it["title"] as? String else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = title
            attrs.contentDescription = it["text"] as? String
            attrs.keywords = (it["keywords"] as? [String]) ?? []
            if let ms = it["updatedAt"] as? Double { attrs.contentModificationDate = Date(timeIntervalSince1970: ms / 1000) }
            let item = CSSearchableItem(uniqueIdentifier: url, domainIdentifier: BereanSpotlightPlugin.domain, attributeSet: attrs)
            item.expirationDate = .distantFuture
            return item
        }
        CSSearchableIndex.default().indexSearchableItems(searchable) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["indexed": searchable.count]) }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let urls = call.getArray("urls") as? [String] else { call.reject("missing urls"); return }
        CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: urls) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [BereanSpotlightPlugin.domain]) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
}
