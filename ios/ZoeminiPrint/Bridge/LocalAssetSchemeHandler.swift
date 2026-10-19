import Foundation
import WebKit

public class LocalAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let assetDirectoryURL: URL

    public override init() {
        if let bundleAssets = Bundle.main.url(forResource: "Assets", withExtension: nil) {
            self.assetDirectoryURL = bundleAssets
        } else {
            self.assetDirectoryURL = Bundle.main.bundleURL.appendingPathComponent("Assets", isDirectory: true)
        }
        super.init()
    }

    public init(assetDirectoryURL: URL) {
        self.assetDirectoryURL = assetDirectoryURL
        super.init()
    }

    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "LocalAssetSchemeHandler", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"]))
            return
        }

        var path = url.path
        if path.hasPrefix("/") {
            path = String(path.dropFirst())
        }
        if path.isEmpty || path == "/" {
            path = "index.html"
        }

        let fileURL = assetDirectoryURL.appendingPathComponent(path)

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            let errorResponse = HTTPURLResponse(
                url: url,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": "text/plain; charset=utf-8",
                    "Access-Control-Allow-Origin": "*"
                ]
            )!
            urlSchemeTask.didReceive(errorResponse)
            if let notFoundData = "404 Not Found: \(path)".data(using: .utf8) {
                urlSchemeTask.didReceive(notFoundData)
            }
            urlSchemeTask.didFinish()
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let mimeType = mimeTypeForPath(path)
            let headers: [String: String] = [
                "Content-Type": mimeType,
                "Content-Length": "\(data.count)",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache"
            ]

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!

            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Task stopped by WebKit, no-op
    }

    private func mimeTypeForPath(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html", "htm":
            return "text/html; charset=utf-8"
        case "js", "mjs":
            return "application/javascript; charset=utf-8"
        case "css":
            return "text/css; charset=utf-8"
        case "json":
            return "application/json; charset=utf-8"
        case "webmanifest":
            return "application/manifest+json; charset=utf-8"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "svg":
            return "image/svg+xml"
        case "ico":
            return "image/x-icon"
        case "wasm":
            return "application/wasm"
        default:
            return "application/octet-stream"
        }
    }
}
