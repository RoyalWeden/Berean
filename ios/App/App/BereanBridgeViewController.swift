import UIKit
import Capacitor
import BereanNative

/// The app's Capacitor bridge controller, instantiated by SceneDelegate.swift (Capacitor 8 creates
/// the root view controller in code; the storyboard class is not what runs). Registers Berean's
/// local plugins from the BereanNative Swift package — the documented way to register plugins that
/// are not npm packages (`capacitorDidLoad`).
class BereanBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // The window behind the web view before its first paint: the system background (light /
        // dark) instead of black, so the native glass controls never sample a black backdrop and
        // visibly re-tint as Scripture appears (TEST 2026-10-05, cold-launch glass snap).
        view.backgroundColor = .systemBackground
        webView?.isOpaque = false
        webView?.backgroundColor = .systemBackground
        webView?.scrollView.backgroundColor = .systemBackground
        bridge?.registerPluginInstance(BereanSQLitePlugin())
        bridge?.registerPluginInstance(BereanCloudPlugin())
        bridge?.registerPluginInstance(BereanAudioPlugin())
        bridge?.registerPluginInstance(BereanSpeechPlugin())
        bridge?.registerPluginInstance(BereanWebViewPlugin())
        bridge?.registerPluginInstance(BereanDownloadsPlugin())
        bridge?.registerPluginInstance(BereanPrintPlugin())
        bridge?.registerPluginInstance(BereanSpotlightPlugin())
        bridge?.registerPluginInstance(BereanShareInboxPlugin())
        bridge?.registerPluginInstance(BereanPowerPlugin())
        bridge?.registerPluginInstance(BereanA11yPlugin())
        bridge?.registerPluginInstance(BereanLocationPlugin())
        bridge?.registerPluginInstance(BereanGlassPlugin())
        NSLog("[Berean] native plugins registered: BereanSQLite=%@ BereanCloud=%@",
              bridge?.plugin(withName: "BereanSQLite") == nil ? "missing" : "ok",
              bridge?.plugin(withName: "BereanCloud") == nil ? "missing" : "ok")
    }
}
