import Foundation
import UIKit
import WebKit
import Capacitor

/// The phone's YouTube player (docs/mobile Phase 17): a native WKWebView laid over the app's web
/// view at the rectangle the page reports, loading a small wrapper page with an https base URL.
/// Why native: YouTube's embed player refuses the app origin (capacitor://localhost) as a
/// Referer (error 153) and Capacitor iOS cannot serve the bundle over https; a WKWebView given
/// `baseURL: https://…` sends a valid Referer. It also brings the native video player (inline,
/// fullscreen, system Picture in Picture) and keeps playing under the audio session.
///
/// JS ↔ native: `open`, `setRect`, `show`/`hide`, `command` (IFrame API calls), `close`;
/// the wrapper relays IFrame API messages back as `state` / `position` / `error` events.
@objc(BereanWebViewPlugin)
public class BereanWebViewPlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandler, WKNavigationDelegate {
    public let identifier = "BereanWebViewPlugin"
    public let jsName = "BereanWebView"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private var player: WKWebView?
    private static let baseURL = URL(string: "https://player.berean.app/")!

    private func rect(from call: CAPPluginCall) -> CGRect? {
        guard let r = call.getObject("rect"), let x = r["x"] as? Double, let y = r["y"] as? Double,
              let w = r["width"] as? Double, let h = r["height"] as? Double else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let videoId = call.getString("videoId") else { call.reject("missing videoId"); return }
        let start = Int(call.getDouble("startTime") ?? 0)
        let frame = rect(from: call) ?? .zero
        DispatchQueue.main.async {
            self.closePlayer()
            let config = WKWebViewConfiguration()
            config.allowsInlineMediaPlayback = true
            config.allowsPictureInPictureMediaPlayback = true
            config.mediaTypesRequiringUserActionForPlayback = []
            config.userContentController.add(self, name: "berean")
            let wv = WKWebView(frame: frame, configuration: config)
            wv.navigationDelegate = self
            wv.isOpaque = false
            wv.backgroundColor = .black
            wv.scrollView.isScrollEnabled = false
            wv.scrollView.contentInsetAdjustmentBehavior = .never
            wv.layer.cornerRadius = 8
            wv.clipsToBounds = true
            guard let host = self.bridge?.viewController?.view else { call.reject("no host view"); return }
            host.addSubview(wv)
            self.player = wv
            let src = "https://www.youtube.com/embed/\(videoId)?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=https://player.berean.app" + (start > 5 ? "&start=\(start)" : "")
            let html = """
            <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>
            *{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden}
            iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
            </style></head><body>
            <iframe id="p" src="\(src)" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
            <script>
            var post=function(o){try{window.webkit.messageHandlers.berean.postMessage(o)}catch(e){}};
            var f=document.getElementById('p');
            var send=function(m){try{f.contentWindow.postMessage(JSON.stringify(m),'*')}catch(e){}};
            window.addEventListener('message',function(e){var d;try{d=typeof e.data==='string'?JSON.parse(e.data):e.data}catch(x){return}
              if(!d)return;
              if(d.event==='onReady'){send({event:'listening',id:1});post({type:'ready'})}
              if(d.event==='onStateChange'){post({type:'state',state:d.info})}
              if(d.event==='onError'){post({type:'error',code:d.info})}
              if(d.event==='infoDelivery'&&d.info&&typeof d.info.currentTime==='number'){post({type:'position',t:d.info.currentTime,d:d.info.duration||0})}
            });
            f.addEventListener('load',function(){send({event:'listening',id:1})});
            window.__cmd=function(fn,args){send({event:'command',func:fn,args:args||[]})};
            </script></body></html>
            """
            wv.loadHTMLString(html, baseURL: BereanWebViewPlugin.baseURL)
            call.resolve()
        }
    }

    @objc func setRect(_ call: CAPPluginCall) {
        guard let frame = rect(from: call) else { call.reject("missing rect"); return }
        DispatchQueue.main.async { self.player?.frame = frame; call.resolve() }
    }
    @objc func show(_ call: CAPPluginCall) { DispatchQueue.main.async { self.player?.isHidden = false; call.resolve() } }
    @objc func hide(_ call: CAPPluginCall) { DispatchQueue.main.async { self.player?.isHidden = true; call.resolve() } }
    @objc func command(_ call: CAPPluginCall) {
        guard let fn = call.getString("func") else { call.reject("missing func"); return }
        let args = call.getArray("args") ?? []
        let json = (try? JSONSerialization.data(withJSONObject: args)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        DispatchQueue.main.async {
            self.player?.evaluateJavaScript("window.__cmd(\(BereanWebViewPlugin.jsString(fn)), \(json))") { _, _ in }
            call.resolve()
        }
    }
    @objc func close(_ call: CAPPluginCall) { DispatchQueue.main.async { self.closePlayer(); call.resolve() } }

    private func closePlayer() {
        guard let wv = player else { return }
        wv.evaluateJavaScript("window.__cmd('stopVideo',[])") { _, _ in }
        wv.configuration.userContentController.removeScriptMessageHandler(forName: "berean")
        wv.removeFromSuperview()
        player = nil
    }

    private static func jsString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data()
        let arr = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    // MARK: wrapper → JS events
    public func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        notifyListeners(type, data: body)
    }
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Keep the player inside the wrapper: a tap on the YouTube logo / title would otherwise
        // navigate the native web view to youtube.com. Hand such links to the system instead.
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
