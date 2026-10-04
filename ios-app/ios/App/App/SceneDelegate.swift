import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ThemedBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
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
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let style: UIUserInterfaceStyle
        switch message.body as? String {
        case "light": style = .light
        case "dark": style = .dark
        default: style = .unspecified
        }
        view.window?.overrideUserInterfaceStyle = style
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
