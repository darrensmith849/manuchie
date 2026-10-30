// Offscreen renderer for QA screenshots: WebKit view in a window that is never shown.
// No browser app, tab, profile or history. Usage:
//   swift render.swift <base-url> <login.json> <axe.min.js> <out-dir>
import Cocoa
import WebKit

let args = CommandLine.arguments
let base = args[1], loginPath = args[2], axePath = args[3], outDir = args[4]
let login = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: loginPath))) as! [String: String]
let axeSource = try! String(contentsOfFile: axePath, encoding: .utf8)

@MainActor
final class Shooter: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!
    var pending: CheckedContinuation<Void, Never>?
    var errors: [String] = []
    var report: [[String: Any]] = []

    func make(width: CGFloat, height: CGFloat) {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        let uc = WKUserContentController()
        uc.add(self, name: "err")
        uc.addUserScript(WKUserScript(source: """
          window.addEventListener('error', function (e) { webkit.messageHandlers.err.postMessage('error: ' + e.message); });
          window.addEventListener('unhandledrejection', function (e) { webkit.messageHandlers.err.postMessage('rejection: ' + (e.reason && e.reason.message || e.reason)); });
          document.addEventListener('securitypolicyviolation', function (e) { webkit.messageHandlers.err.postMessage('csp: ' + e.violatedDirective + ' ' + e.blockedURI); });
          (function () { var ce = console.error; console.error = function () { webkit.messageHandlers.err.postMessage('console: ' + Array.prototype.join.call(arguments, ' ')); return ce.apply(console, arguments); }; })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = uc
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: cfg)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = web
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { errors.append("\(m.body)") }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { pending?.resume(); pending = nil }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { pending?.resume(); pending = nil }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { errors.append("load failed: \(e.localizedDescription)"); pending?.resume(); pending = nil }
    func webView(_ w: WKWebView, didReceive ch: URLAuthenticationChallenge, completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // local wrangler dev uses a self-signed certificate
        if let t = ch.protectionSpace.serverTrust { completionHandler(.useCredential, URLCredential(trust: t)) } else { completionHandler(.performDefaultHandling, nil) }
    }

    func load(_ path: String) async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            pending = c
            web.load(URLRequest(url: URL(string: base + path)!))
        }
    }
    func js(_ s: String) async -> Any? { try? await web.evaluateJavaScript(s) }
    func ajs(_ s: String) async -> Any? { try? await web.callAsyncJavaScript(s, arguments: [:], in: nil, contentWorld: .page) }
    func settle() async {
        for _ in 0..<100 {
            if let ok = await js("document.readyState === 'complete' && !document.querySelector('#main .loading') && (document.fonts ? document.fonts.status === 'loaded' : true)") as? Bool, ok { break }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
        try? await Task.sleep(nanoseconds: 500_000_000)
    }

    func shot(_ name: String, width: CGFloat, fullPage: Bool, viewport: CGFloat, axe: Bool) async {
        let overflow = (await js("document.documentElement.scrollWidth - window.innerWidth") as? Double) ?? 0
        var violations = "skipped"
        if axe {
            _ = await js(axeSource + ";true")
            if let r = await ajs("""
              const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } });
              return JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, t: (v.nodes[0] || {}).target })));
            """) as? String { violations = r } else { violations = "axe failed" }
        }
        var h = viewport
        if fullPage { h = CGFloat((await js("Math.ceil(document.documentElement.scrollHeight)") as? Double) ?? Double(viewport)) }
        window.setContentSize(NSSize(width: width, height: h))
        web.frame = NSRect(x: 0, y: 0, width: width, height: h)
        try? await Task.sleep(nanoseconds: 450_000_000)
        let cfg = WKSnapshotConfiguration()
        cfg.rect = CGRect(x: 0, y: 0, width: width, height: h)
        cfg.afterScreenUpdates = true
        if let img = try? await web.takeSnapshot(configuration: cfg), let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: "\(outDir)/dashboard-\(name)-\(Int(width)).png"))
        }
        window.setContentSize(NSSize(width: width, height: viewport))
        web.frame = NSRect(x: 0, y: 0, width: width, height: viewport)
        let errs = errors
        errors = []
        report.append(["page": name, "width": Int(width), "overflow": overflow, "axe": violations, "errors": errs])
        print("\(Int(width))px \(name.padding(toLength: 18, withPad: " ", startingAt: 0)) overflow=\(Int(overflow)) axe=\(violations) errors=\(errs)")
    }

    func run() async {
        for width in [390.0, 768.0, 1024.0, 1440.0] as [CGFloat] {
            let vh: CGFloat = width < 800 ? 844 : 900
            let doAxe = width == 390 || width == 1440
            make(width: width, height: vh)
            await load("/admin/login"); await settle()
            await shot("login", width: width, fullPage: false, viewport: vh, axe: doAxe)
            let status = await ajs("""
              const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '\(login["email"]!)', password: '\(login["password"]!)' }) });
              return r.status;
            """)
            if "\(status ?? "nil")" != "200" { print("login failed: \(status ?? "nil")"); exit(1) }
            await load("/admin/"); await settle()
            let ids = await ajs("""
              const e = await (await fetch('/api/admin/enquiries?per=5')).json();
              const c = await (await fetch('/api/admin/contacts?per=5&q=tariro')).json();
              const p = await (await fetch('/api/admin/projects?view=active')).json();
              return [e.rows[0].id, c.rows[0].id, p.rows[0].id].join(',');
            """) as? String ?? ",,"
            let parts = ids.split(separator: ",").map(String.init)
            var routes: [(String, String)] = [("overview", "#/overview"), ("analytics", "#/analytics"), ("enquiries", "#/enquiries?view=todo"),
                                               ("enquiry", "#/enquiries/\(parts[0])"), ("projects", "#/projects"), ("project", "#/projects/\(parts[2])"),
                                               ("project-new", "#/projects/new"), ("money", "#/money"), ("contacts", "#/contacts"), ("contact", "#/contacts/\(parts[1])"), ("settings", "#/settings")]
            if width < 800 { routes.append(("more", "#/more")) }
            var n = 0
            for (name, hash) in routes {
                n += 1
                await load("/admin/?r=\(n)\(hash)"); await settle()
                await shot(name, width: width, fullPage: true, viewport: vh, axe: doAxe)
            }
            // the bulk bar, with one enquiry ticked
            await load("/admin/?r=99#/enquiries?view=todo"); await settle()
            _ = await js("var b = document.querySelector('input[data-id]'); b && b.click(); true")
            try? await Task.sleep(nanoseconds: 300_000_000)
            await shot("enquiries-selected", width: width, fullPage: false, viewport: vh, axe: false)
        }
        let data = try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try! data.write(to: URL(fileURLWithPath: "\(outDir)/dashboard-qa.json"))
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
Task { @MainActor in
    let s = Shooter()
    await s.run()
    exit(0)
}
app.run()
