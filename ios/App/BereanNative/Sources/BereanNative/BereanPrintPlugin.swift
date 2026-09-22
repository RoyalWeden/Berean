import Foundation
import UIKit
import Capacitor

/// Print and PDF export for notes (docs/mobile Phase 18): the same HTML the desktop's
/// PrintPreviewModal produces, handed to AirPrint (`UIPrintInteractionController`) or rendered to
/// a PDF (`UIPrintPageRenderer`) and offered through the share sheet (Files, Mail, AirDrop…).
@objc(BereanPrintPlugin)
public class BereanPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanPrintPlugin"
    public let jsName = "BereanPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportPdf", returnType: CAPPluginReturnPromise),
    ]

    private func pageSize(_ name: String?) -> CGRect {
        switch (name ?? "").lowercased() {
        case "a4": return CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
        case "legal": return CGRect(x: 0, y: 0, width: 612, height: 1008)
        default: return CGRect(x: 0, y: 0, width: 612, height: 792)   // US Letter
        }
    }

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html") else { call.reject("missing html"); return }
        let jobName = call.getString("title") ?? "Berean note"
        DispatchQueue.main.async {
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = jobName
            controller.printInfo = info
            let formatter = UIMarkupTextPrintFormatter(markupText: html)
            formatter.perPageContentInsets = UIEdgeInsets(top: 36, left: 36, bottom: 36, right: 36)
            controller.printFormatter = formatter
            controller.present(animated: true) { _, completed, error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["success": completed]) }
            }
        }
    }

    @objc func exportPdf(_ call: CAPPluginCall) {
        guard let html = call.getString("html") else { call.reject("missing html"); return }
        let name = (call.getString("name") ?? "note").replacingOccurrences(of: "/", with: "-")
        let paper = pageSize(call.getString("pageSize"))
        DispatchQueue.main.async {
            let formatter = UIMarkupTextPrintFormatter(markupText: html)
            let renderer = UIPrintPageRenderer()
            renderer.addPrintFormatter(formatter, startingAtPageAt: 0)
            let printable = paper.insetBy(dx: 36, dy: 36)
            renderer.setValue(paper, forKey: "paperRect")
            renderer.setValue(printable, forKey: "printableRect")
            let data = NSMutableData()
            UIGraphicsBeginPDFContextToData(data, paper, nil)
            renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
            for i in 0..<renderer.numberOfPages {
                UIGraphicsBeginPDFPage()
                renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
            }
            UIGraphicsEndPDFContext()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).pdf")
            do { try data.write(to: url, options: .atomic) } catch { call.reject(error.localizedDescription); return }
            guard let vc = self.bridge?.viewController else { call.reject("no view controller"); return }
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            share.completionWithItemsHandler = { _, completed, _, error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["success": completed, "canceled": !completed]) }
            }
            share.popoverPresentationController?.sourceView = vc.view
            vc.present(share, animated: true)
        }
    }
}
