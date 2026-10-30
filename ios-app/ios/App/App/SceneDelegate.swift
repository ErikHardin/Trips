import UIKit
import Capacitor
import WebKit
import WidgetKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ThemedBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // A widget tap that launched the app
        connectionOptions.urlContexts.map(\.url).filter(WidgetLinks.handles).forEach(WidgetLinks.shared.open)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let widget = URLContexts.filter { WidgetLinks.handles($0.url) }
        widget.forEach { WidgetLinks.shared.open($0.url) }
        let rest = URLContexts.subtracting(widget)
        if !rest.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: rest) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // Opening the app refreshes the home-screen widgets, so a widget stuck on
    // "Can't reach trips" (or showing stale flights) can be fixed by hand
    func sceneDidBecomeActive(_ scene: UIScene) {
        WidgetCenter.shared.reloadAllTimelines()
    }
}

// Light/dark colors for the native strips under the status bar and home indicator
// (contentInset keeps the page out of them). Matches the page background (--cream).
private let appBackground = UIColor { traits in
    traits.userInterfaceStyle == .dark
        ? UIColor(red: 0x2c / 255, green: 0x2c / 255, blue: 0x2e / 255, alpha: 1)
        : UIColor(red: 0xfa / 255, green: 0xf8 / 255, blue: 0xf4 / 255, alpha: 1)
}

// The web app posts its Appearance choice ("auto" | "light" | "dark") to the "theme"
// message handler; forcing the window's style recolors these strips and the status bar.
class ThemedBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func capacitorDidLoad() {
        webView?.backgroundColor = appBackground
        webView?.scrollView.backgroundColor = appBackground
        webView?.configuration.userContentController.add(WeakMessageHandler(self), name: "theme")
        webView?.configuration.userContentController.add(WeakMessageHandler(self), name: "widgetLink")
        WidgetLinks.shared.webView = webView
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "widgetLink" {
            WidgetLinks.shared.pageReady()
            return
        }
        let style: UIUserInterfaceStyle
        switch message.body as? String {
        case "light": style = .light
        case "dark": style = .dark
        default: style = .unspecified
        }
        view.window?.overrideUserInterfaceStyle = style
    }
}

// Taps on the Today widget (hardintrips://open?trip=…&day=…) go to the web
// app's handleWidgetLink. One that launches the app waits for the page to say
// it's up (its "widgetLink" message), so it isn't lost while the page loads.
final class WidgetLinks {
    static let shared = WidgetLinks()
    static func handles(_ url: URL) -> Bool { url.scheme == "hardintrips" }

    weak var webView: WKWebView?
    private var pending: URL?
    private var ready = false

    func open(_ url: URL) {
        pending = url
        if ready { deliver() }
    }

    func pageReady() {
        ready = true
        deliver()
    }

    private func deliver() {
        guard let url = pending, let webView = webView,
              let data = try? JSONEncoder().encode(url.absoluteString),
              let arg = String(data: data, encoding: .utf8) else { return }
        pending = nil
        webView.evaluateJavaScript("window.handleWidgetLink && handleWidgetLink(\(arg))")
    }
}

// WKUserContentController retains its handlers; this avoids a cycle with the view controller.
private class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
