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
        // No system scroll-edge blur under the status bar (iOS 26): it smeared the compact passage
        // pill at the Dynamic Island into a dark haze (simulator, 2026-10-19). The page draws its own
        // status-bar band in the Scripture colour (readerChrome.css .mobile-compact-band).
        if #available(iOS 26.0, *) {
            webView?.scrollView.topEdgeEffect.isHidden = true
        }
        bridge?.registerPluginInstance(BereanSQLitePlugin())
        bridge?.registerPluginInstance(BereanCloudPlugin())
        bridge?.registerPluginInstance(BereanAudioPlugin())
        bridge?.registerPluginInstance(BereanSpeechPlugin())
        bridge?.registerPluginInstance(BereanVoicePackPlugin())
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
