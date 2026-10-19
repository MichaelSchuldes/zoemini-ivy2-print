import Foundation

public class BluetoothManager {
    public static let shared = BluetoothManager()

    private enum ActiveEngine {
        case none
        case externalAccessory
        case coreBluetooth
    }

    private var activeEngine: ActiveEngine = .none

    private init() {}

    public func isAvailable() -> Bool {
        return CoreBluetoothEngine.shared.isBluetoothAvailable() ||
               !ExternalAccessoryEngine.shared.getConnectedAccessories().isEmpty
    }

    public func getBondedDevices() -> [[String: String]] {
        var devices = ExternalAccessoryEngine.shared.getConnectedAccessories()
        let bleDevices = CoreBluetoothEngine.shared.getDiscoveredDevices()

        for dev in bleDevices {
            if !devices.contains(where: { $0["name"] == dev["name"] }) {
                devices.append(dev)
            }
        }
        return devices
    }

    public func connect(address: String) -> String {
        disconnect()

        // First attempt Bluetooth Classic / ExternalAccessory connection
        let eaResult = ExternalAccessoryEngine.shared.connect(address: address)
        if eaResult == "OK" {
            activeEngine = .externalAccessory
            return "OK"
        }

        // Fallback to CoreBluetooth BLE
        let cbResult = CoreBluetoothEngine.shared.connect(uuidString: address)
        if cbResult == "OK" {
            activeEngine = .coreBluetooth
            return "OK"
        }

        return eaResult
    }

    public func writeBase64(_ base64Data: String) -> String {
        guard let data = Data(base64Encoded: base64Data) else {
            return "Write failed: Invalid base64 payload"
        }

        switch activeEngine {
        case .externalAccessory:
            return ExternalAccessoryEngine.shared.write(data: data)
        case .coreBluetooth:
            return CoreBluetoothEngine.shared.write(data: data)
        case .none:
            return "Not connected to any printer."
        }
    }

    public func readBase64(byteCount: Int, timeoutMs: Int) -> String {
        switch activeEngine {
        case .externalAccessory:
            return ExternalAccessoryEngine.shared.read(byteCount: byteCount, timeoutMs: timeoutMs)
        case .coreBluetooth:
            return CoreBluetoothEngine.shared.read(byteCount: byteCount, timeoutMs: timeoutMs)
        case .none:
            return "ERR:Not connected"
        }
    }

    public func isConnected() -> Bool {
        switch activeEngine {
        case .externalAccessory:
            return ExternalAccessoryEngine.shared.isConnected()
        case .coreBluetooth:
            return CoreBluetoothEngine.shared.isConnected()
        case .none:
            return false
        }
    }

    public func disconnect() {
        if activeEngine == .externalAccessory {
            ExternalAccessoryEngine.shared.disconnect()
        } else if activeEngine == .coreBluetooth {
            CoreBluetoothEngine.shared.disconnect()
        }
        activeEngine = .none
    }
}
