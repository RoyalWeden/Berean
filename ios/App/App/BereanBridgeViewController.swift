import UIKit
import Capacitor
import BereanNative

/// The app's Capacitor bridge controller, instantiated by SceneDelegate.swift (Capacitor 8 creates
/// the root view controller in code; the storyboard class is not what runs). Registers Berean's
/// local plugins from the BereanNative Swift package — the documented way to register plugins that
/// are not npm packages (`capacitorDidLoad`).
class BereanBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BereanSQLitePlugin())
        bridge?.registerPluginInstance(BereanCloudPlugin())
        NSLog("[Berean] native plugins registered: BereanSQLite=%@ BereanCloud=%@",
              bridge?.plugin(withName: "BereanSQLite") == nil ? "missing" : "ok",
              bridge?.plugin(withName: "BereanCloud") == nil ? "missing" : "ok")
    }
}
