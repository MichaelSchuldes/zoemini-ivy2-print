import UIKit
import WebKit

class ViewController: UIViewController {
    private var webView: WKWebView!
    private var bridgeHandler: ScriptBridgeHandler!

    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        loadLocalApp()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    private func setupWebView() {
        let configuration = WKWebViewConfiguration()

        // 1. Register LocalAssetSchemeHandler for custom "app" scheme
        let schemeHandler = LocalAssetSchemeHandler()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "app")

        // 2. Setup WKScriptMessageHandler for Bluetooth bridge
        let userContentController = WKUserContentController()
        bridgeHandler = ScriptBridgeHandler(webView: nil)
        userContentController.add(bridgeHandler, name: "iosBluetoothBridge")

        // 3. Inject window.iOSBluetoothSerial shim at document start
        let bridgeShimScript = """
        (function() {
            if (window.iOSBluetoothSerial) return;

            var callbacks = {};
            var callbackId = 0;

            window.__iosBluetoothCallback = function(id, result, error) {
                if (callbacks[id]) {
                    if (error) {
                        callbacks[id].reject(new Error(error));
                    } else {
                        callbacks[id].resolve(result);
                    }
                    delete callbacks[id];
                }
            };

            function invoke(method, args) {
                return new Promise(function(resolve, reject) {
                    var id = ++callbackId;
                    callbacks[id] = { resolve: resolve, reject: reject };
                    window.webkit.messageHandlers.iosBluetoothBridge.postMessage({
                        id: id,
                        method: method,
                        args: args || {}
                    });
                });
            }

            window.iOSBluetoothSerial = {
                isAvailable: function() { return invoke('isAvailable'); },
                getBondedDevices: function() { return invoke('getBondedDevices'); },
                connect: function(address) { return invoke('connect', { address: address }); },
                writeBase64: function(base64Data) { return invoke('writeBase64', { data: base64Data }); },
                readBase64: function(byteCount, timeoutMs) { return invoke('readBase64', { byteCount: byteCount, timeoutMs: timeoutMs }); },
                isConnected: function() { return invoke('isConnected'); },
                disconnect: function() { return invoke('disconnect'); }
            };
        })();
        """

        let userScript = WKUserScript(
            source: bridgeShimScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        userContentController.addUserScript(userScript)

        configuration.userContentController = userContentController
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.backgroundColor = UIColor(red: 0.05, green: 0.07, blue: 0.1, alpha: 1.0)
        webView.isOpaque = true
        webView.scrollView.bounces = false

        bridgeHandler.setWebView(webView)

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func loadLocalApp() {
        guard let url = URL(string: "app://localhost/index.html") else { return }
        let request = URLRequest(url: url)
        webView.load(request)
    }
}
