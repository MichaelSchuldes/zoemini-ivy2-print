import Foundation
import ExternalAccessory

public class ExternalAccessoryEngine: NSObject, StreamDelegate {
    public static let shared = ExternalAccessoryEngine()

    private static let supportedProtocols = [
        "jp.co.canon.icp",
        "com.canon.icp",
        "jp.co.canon.cec.icp"
    ]

    private var accessory: EAAccessory?
    private var session: EASession?
    private var inputStream: InputStream?
    private var outputStream: OutputStream?

    private var rxBuffer = Data()
    private let dataCondition = NSCondition()
    private var isStreamOpen = false

    public override init() {
        super.init()
        EAAccessoryManager.shared().registerForLocalNotifications()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDisconnected(_:)),
            name: .EAAccessoryDidDisconnect,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        EAAccessoryManager.shared().unregisterForLocalNotifications()
        disconnect()
    }

    public func getConnectedAccessories() -> [[String: String]] {
        let accessories = EAAccessoryManager.shared().connectedAccessories
        var list: [[String: String]] = []

        for acc in accessories {
            let name = acc.name
            let protocols = acc.protocolStrings

            // Include accessories that support our target protocols OR have matching names
            let matchesProtocol = protocols.contains { ExternalAccessoryEngine.supportedProtocols.contains($0) }
            let matchesName = name.lowercased().contains("canon") ||
                              name.lowercased().contains("zoemini") ||
                              name.lowercased().contains("ivy") ||
                              name.lowercased().contains("pv-223") ||
                              name.lowercased().contains("printer")

            if matchesProtocol || matchesName {
                list.append([
                    "name": name,
                    "address": "\(acc.connectionID)"
                ])
            }
        }
        return list
    }

    public func connect(address: String) -> String {
        disconnect()

        let accessories = EAAccessoryManager.shared().connectedAccessories
        guard let target = accessories.first(where: {
            "\($0.connectionID)" == address ||
            $0.name.lowercased().contains(address.lowercased())
        }) ?? accessories.first(where: { acc in
            acc.name.lowercased().contains("canon") ||
            acc.name.lowercased().contains("zoemini") ||
            acc.name.lowercased().contains("ivy")
        }) else {
            return "No matching connected accessory found for: \(address)"
        }

        // Find matching protocol string
        let selectedProtocol = target.protocolStrings.first { ExternalAccessoryEngine.supportedProtocols.contains($0) }
            ?? target.protocolStrings.first

        guard let proto = selectedProtocol else {
            return "Accessory has no supported protocol strings."
        }

        guard let newSession = EASession(accessory: target, forProtocol: proto) else {
            return "Failed to open EASession for protocol: \(proto)"
        }

        self.accessory = target
        self.session = newSession
        self.inputStream = newSession.inputStream
        self.outputStream = newSession.outputStream

        guard let inStream = self.inputStream, let outStream = self.outputStream else {
            disconnect()
            return "Failed to obtain streams from EASession."
        }

        inStream.delegate = self
        outStream.delegate = self

        inStream.schedule(in: .main, forMode: .common)
        outStream.schedule(in: .main, forMode: .common)

        inStream.open()
        outStream.open()

        isStreamOpen = true
        return "OK"
    }

    public func write(data: Data) -> String {
        guard let outStream = outputStream, isStreamOpen else {
            return "Not connected to accessory."
        }

        var totalWritten = 0
        let bytesCount = data.count

        return data.withUnsafeBytes { (rawBuffer: UnsafeRawBufferPointer) -> String in
            guard let ptr = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                return "Write failed: Invalid memory pointer"
            }

            var retries = 0
            while totalWritten < bytesCount {
                guard self.isStreamOpen else {
                    return "Write error: Stream closed"
                }
                if outStream.streamStatus == .error || outStream.streamStatus == .closed {
                    return "Write error: \(outStream.streamError?.localizedDescription ?? "Stream closed")"
                }
                if !outStream.hasSpaceAvailable {
                    Thread.sleep(forTimeInterval: 0.005)
                    retries += 1
                    if retries > 1000 {
                        return "Write error: Stream write timed out"
                    }
                    continue
                }
                let written = outStream.write(ptr.advanced(by: totalWritten), maxLength: bytesCount - totalWritten)
                if written < 0 {
                    return "Write error: \(outStream.streamError?.localizedDescription ?? "unknown")"
                } else if written == 0 {
                    Thread.sleep(forTimeInterval: 0.005)
                } else {
                    totalWritten += written
                    retries = 0
                }
            }
            return "OK"
        }
    }

    public func read(byteCount: Int, timeoutMs: Int) -> String {
        guard isStreamOpen, inputStream != nil else {
            return "ERR:Not connected"
        }

        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)

        dataCondition.lock()
        defer { dataCondition.unlock() }

        while rxBuffer.count < byteCount {
            guard isStreamOpen else {
                return "ERR:Not connected"
            }
            if Date() >= deadline {
                return "ERR:Timeout waiting for \(byteCount) bytes (got \(rxBuffer.count))"
            }

            if !dataCondition.wait(until: deadline) {
                if rxBuffer.count < byteCount {
                    return "ERR:Timeout waiting for \(byteCount) bytes (got \(rxBuffer.count))"
                }
            }
        }

        let subdata = rxBuffer.subdata(in: 0..<byteCount)
        rxBuffer.removeSubrange(0..<byteCount)

        return subdata.base64EncodedString()
    }

    public func isConnected() -> Bool {
        return isStreamOpen && session != nil
    }

    public func disconnect() {
        dataCondition.lock()
        isStreamOpen = false
        rxBuffer.removeAll()
        dataCondition.broadcast()
        dataCondition.unlock()

        let inStream = self.inputStream
        let outStream = self.outputStream
        self.inputStream = nil
        self.outputStream = nil
        self.session = nil
        self.accessory = nil

        let cleanup = {
            inStream?.close()
            inStream?.remove(from: .main, forMode: .common)
            inStream?.delegate = nil

            outStream?.close()
            outStream?.remove(from: .main, forMode: .common)
            outStream?.delegate = nil
        }

        if Thread.isMainThread {
            cleanup()
        } else {
            DispatchQueue.main.async(execute: cleanup)
        }
    }

    // MARK: - StreamDelegate
    public func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
        switch eventCode {
        case .hasBytesAvailable:
            if let inStream = aStream as? InputStream {
                var tempBuffer = [UInt8](repeating: 0, count: 4096)
                while inStream.hasBytesAvailable {
                    let bytesRead = inStream.read(&tempBuffer, maxLength: tempBuffer.count)
                    if bytesRead > 0 {
                        dataCondition.lock()
                        rxBuffer.append(tempBuffer, count: bytesRead)
                        dataCondition.broadcast()
                        dataCondition.unlock()
                    } else {
                        break
                    }
                }
            }
        case .errorOccurred:
            disconnect()
        case .endEncountered:
            disconnect()
        default:
            break
        }
    }

    @objc private func accessoryDisconnected(_ notification: Notification) {
        if let disconnectedAccessory = notification.userInfo?[EAAccessoryKey] as? EAAccessory,
           disconnectedAccessory.connectionID == accessory?.connectionID {
            disconnect()
        }
    }
}
