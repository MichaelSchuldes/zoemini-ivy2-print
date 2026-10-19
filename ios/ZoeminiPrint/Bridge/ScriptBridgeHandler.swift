import Foundation
import WebKit

public class ScriptBridgeHandler: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let workQueue = DispatchQueue(label: "com.michaelschuldes.zoemini.bluetooth.worker", qos: .userInitiated)

    public init(webView: WKWebView?) {
        self.webView = webView
        super.init()
    }

    public func setWebView(_ webView: WKWebView) {
        self.webView = webView
    }

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "iosBluetoothBridge",
              let body = message.body as? [String: Any],
              let callId = body["id"] as? Int,
              let method = body["method"] as? String else {
            return
        }

        let args = body["args"] as? [String: Any] ?? [:]

        workQueue.async { [weak self] in
            guard let self = self else { return }

            var result: Any? = nil
            var errorString: String? = nil

            switch method {
            case "isAvailable":
                result = BluetoothManager.shared.isAvailable()

            case "getBondedDevices":
                result = BluetoothManager.shared.getBondedDevices()

            case "connect":
                let address = args["address"] as? String ?? ""
                result = BluetoothManager.shared.connect(address: address)

            case "writeBase64":
                let data = args["data"] as? String ?? ""
                result = BluetoothManager.shared.writeBase64(data)

            case "readBase64":
                let byteCount = args["byteCount"] as? Int ?? 34
                let timeoutMs = args["timeoutMs"] as? Int ?? 5000
                result = BluetoothManager.shared.readBase64(byteCount: byteCount, timeoutMs: timeoutMs)

            case "isConnected":
                result = BluetoothManager.shared.isConnected()

            case "disconnect":
                BluetoothManager.shared.disconnect()
                result = "OK"

            default:
                errorString = "Unknown method: \(method)"
            }

            self.respondToWeb(callId: callId, result: result, error: errorString)
        }
    }

    private func respondToWeb(callId: Int, result: Any?, error: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.webView else { return }

            let jsResult: String
            if let error = error {
                let escapedError = error.replacingOccurrences(of: "\"", with: "\\\"")
                jsResult = "window.__iosBluetoothCallback(\(callId), null, \"\(escapedError)\");"
            } else if let result = result {
                if let boolVal = result as? Bool {
                    jsResult = "window.__iosBluetoothCallback(\(callId), \(boolVal ? "true" : "false"), null);"
                } else if let strVal = result as? String {
                    let escaped = strVal.replacingOccurrences(of: "\\", with: "\\\\")
                                        .replacingOccurrences(of: "\"", with: "\\\"")
                                        .replacingOccurrences(of: "\n", with: "\\n")
                                        .replacingOccurrences(of: "\r", with: "\\r")
                    jsResult = "window.__iosBluetoothCallback(\(callId), \"\(escaped)\", null);"
                } else if let jsonData = try? JSONSerialization.data(withJSONObject: result),
                          let jsonString = String(data: jsonData, encoding: .utf8) {
                    jsResult = "window.__iosBluetoothCallback(\(callId), \(jsonString), null);"
                } else {
                    jsResult = "window.__iosBluetoothCallback(\(callId), null, null);"
                }
            } else {
                jsResult = "window.__iosBluetoothCallback(\(callId), null, null);"
            }

            webView.evaluateJavaScript(jsResult, completionHandler: nil)
        }
    }
}
