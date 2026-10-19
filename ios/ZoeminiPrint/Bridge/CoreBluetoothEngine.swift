import Foundation
import CoreBluetooth

public class CoreBluetoothEngine: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    public static let shared = CoreBluetoothEngine()

    private var centralManager: CBCentralManager?
    private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
    private var connectedPeripheral: CBPeripheral?
    private var writeCharacteristic: CBCharacteristic?
    private var notifyCharacteristic: CBCharacteristic?

    private var rxBuffer = Data()
    private let dataCondition = NSCondition()

    public override init() {
        super.init()
        self.centralManager = CBCentralManager(delegate: self, queue: nil)
    }

    public func isBluetoothAvailable() -> Bool {
        return centralManager?.state == .poweredOn
    }

    public func getDiscoveredDevices() -> [[String: String]] {
        return discoveredPeripherals.values.compactMap { peripheral in
            let name = peripheral.name ?? "Unknown"
            if name.lowercased().contains("canon") ||
               name.lowercased().contains("zoemini") ||
               name.lowercased().contains("ivy") ||
               name.lowercased().contains("printer") {
                return [
                    "name": name,
                    "address": peripheral.identifier.uuidString
                ]
            }
            return nil
        }
    }

    public func startScanning() {
        guard centralManager?.state == .poweredOn else { return }
        centralManager?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    public func stopScanning() {
        centralManager?.stopScan()
    }

    public func connect(uuidString: String) -> String {
        guard let uuid = UUID(uuidString: uuidString),
              let peripheral = discoveredPeripherals[uuid] else {
            return "BLE peripheral not found for UUID: \(uuidString)"
        }

        disconnect()
        connectedPeripheral = peripheral
        peripheral.delegate = self
        centralManager?.connect(peripheral, options: nil)
        return "OK"
    }

    public func write(data: Data) -> String {
        guard let peripheral = connectedPeripheral,
              let characteristic = writeCharacteristic else {
            return "BLE peripheral or characteristic not ready."
        }

        let writeType: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
        peripheral.writeValue(data, for: characteristic, type: writeType)
        return "OK"
    }

    public func read(byteCount: Int, timeoutMs: Int) -> String {
        guard connectedPeripheral != nil else {
            return "ERR:Not connected"
        }

        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)

        dataCondition.lock()
        defer { dataCondition.unlock() }

        while rxBuffer.count < byteCount {
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 {
                return "ERR:Timeout waiting for \(byteCount) bytes (got \(rxBuffer.count))"
            }

            if !dataCondition.wait(until: Date().addingTimeInterval(remaining)) {
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
        return connectedPeripheral?.state == .connected
    }

    public func disconnect() {
        if let peripheral = connectedPeripheral {
            centralManager?.cancelPeripheralConnection(peripheral)
        }
        connectedPeripheral = nil
        writeCharacteristic = nil
        notifyCharacteristic = nil

        dataCondition.lock()
        rxBuffer.removeAll()
        dataCondition.broadcast()
        dataCondition.unlock()
    }

    // MARK: - CBCentralManagerDelegate
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            startScanning()
        }
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        discoveredPeripherals[peripheral.identifier] = peripheral
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if connectedPeripheral == peripheral {
            disconnect()
        }
    }

    // MARK: - CBPeripheralDelegate
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services else { return }
        for service in services {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let characteristics = service.characteristics else { return }
        for char in characteristics {
            if char.properties.contains(.notify) {
                notifyCharacteristic = char
                peripheral.setNotifyValue(true, for: char)
            }
            if char.properties.contains(.write) || char.properties.contains(.writeWithoutResponse) {
                writeCharacteristic = char
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        dataCondition.lock()
        rxBuffer.append(data)
        dataCondition.broadcast()
        dataCondition.unlock()
    }
}
