/**
 * Web Serial API RFCOMM Transport for Zoemini 2 / Ivy 2
 * Connects via Bluetooth Classic SPP UUID (00001101-0000-1000-8000-00805f9b34fb)
 * and provides exact-byte buffered reads equivalent to Python's sock.recv(34).
 */

import {
  SPP_UUID,
  ALLOWED_BT_SERVICE_UUIDS,
  CONTROL_PACKET_SIZE,
  DEFAULT_COMMAND_TIMEOUT_MS,
} from "../protocol/constants.js";
import { ClientUnavailableError, ReceiveTimeoutError } from "../protocol/errors.js";

export class ZoeminiSerialTransport {
  /**
   * @param {Object} options
   * @param {string|null} [options.targetAddress]
   * @param {string|null} [options.deviceName]
   * @param {(direction: 'TX'|'RX'|'INFO'|'ERR', bytes: Uint8Array|null, note?: string) => void} [options.onTraffic]
   * @param {() => void} [options.onDisconnect]
   */
  constructor({ targetAddress = null, deviceName = null, onTraffic = null, onDisconnect = null } = {}) {
    this.port = null;
    this.targetAddress = targetAddress;
    this.deviceName = deviceName;
    this.reader = null;
    this.writer = null;
    this.rxBuffer = new Uint8Array(0);
    this.connected = false;
    this.onTraffic = onTraffic;
    this.onDisconnect = onDisconnect;
    this._boundDisconnectHandler = () => {
      this._handleSuddenDisconnect();
    };
  }

  static isSupported() {
    return (
      (typeof window !== "undefined" && typeof window.AndroidBluetoothSerial !== "undefined") ||
      (typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext)
    );
  }

  async connect({ targetAddress = null } = {}) {
    if (!ZoeminiSerialTransport.isSupported()) {
      throw new ClientUnavailableError(
        "Web Serial API is unavailable. Please use a Chromium browser (Chrome, Edge, Brave, Opera) over HTTPS or localhost."
      );
    }

    if (typeof window !== "undefined" && window.AndroidBluetoothSerial) {
      this.isAndroidBridge = true;
      let address = targetAddress || this.targetAddress;

      if (!address) {
        let devices = [];
        try {
          devices = JSON.parse(window.AndroidBluetoothSerial.getBondedDevices() || "[]");
        } catch (e) {
          console.warn("Error parsing bonded devices", e);
        }

        let target = devices.find((d) =>
          /(canon|zoemini|ivy|mini printer)/i.test(d.name || "")
        );

        if (!target && devices.length > 0) {
          target = devices[0];
        }

        if (!target) {
          throw new ClientUnavailableError(
            "No paired Canon printer found. Please pair the Zoemini in Android Bluetooth settings first."
          );
        }
        address = target.address;
      }

      const res = window.AndroidBluetoothSerial.connect(address);
      if (res !== "OK") {
        throw new ClientUnavailableError(res || "Failed to connect to printer via native Bluetooth.");
      }

      this.deviceName =
        this.deviceName || (target && target.name) || address || "Canon Mini Printer";
      this.connected = true;
      if (this.onTraffic) {
        this.onTraffic(
          "INFO",
          null,
          `Opened Native Android RFCOMM stream to ${this.deviceName} (${address})`
        );
      }
      return;
    }

    // Request paired Bluetooth Classic SPP device (0x1101 on Channel 1) OR /dev/rfcomm0 serial port.
    this.port = await navigator.serial.requestPort({
      allowedBluetoothServiceClassIds: ALLOWED_BT_SERVICE_UUIDS,
    });

    // baudRate is required by Web Serial API syntax, though ignored over Bluetooth RFCOMM
    await this.port.open({ baudRate: 115200 });

    this.deviceName = this.deviceName || "Zoemini 2 / Ivy 2";
    this.port.addEventListener("disconnect", this._boundDisconnectHandler);
    this.rxBuffer = new Uint8Array(0);
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.connected = true;

    if (this.onTraffic) {
      this.onTraffic("INFO", null, `Opened Web Serial RFCOMM stream to ${this.deviceName} (115200 / SPP Channel 1)`);
    }
  }

  async write(uint8Array) {
    if (!this.connected) {
      throw new ClientUnavailableError();
    }

    if (this.isAndroidBridge) {
      let binary = "";
      const len = uint8Array.byteLength;
      const chunkSize = 8192;
      for (let i = 0; i < len; i += chunkSize) {
        const sub = uint8Array.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, sub);
      }
      const b64 = btoa(binary);
      const res = window.AndroidBluetoothSerial.writeBase64(b64);
      if (res !== "OK") {
        throw new ClientUnavailableError(res);
      }
      if (this.onTraffic) {
        this.onTraffic("TX", uint8Array);
      }
      return;
    }

    if (!this.writer) {
      throw new ClientUnavailableError();
    }
    await this.writer.write(uint8Array);
    if (this.onTraffic) {
      this.onTraffic("TX", uint8Array);
    }
  }

  /**
   * Reads a control packet (`byteCount = 34` bytes) from the RFCOMM stream.
   * Note: Zoemini 2 (firmware v1.4.x) sends 36 bytes for StartSession (0x0000)
   * and 34 bytes for GetStatus/GetSetting/PrintReady, always starting with magic
   * bytes `0x43 0xF0` (or `0x43 0x0F`). Aligning to the magic header and stripping
   * trailing padding bytes prevents the 2 extra bytes of StartSession from shifting
   * subsequent packets.
   */
  async readExact(byteCount = CONTROL_PACKET_SIZE, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    if (!this.connected) {
      throw new ClientUnavailableError();
    }

    if (this.isAndroidBridge) {
      const res = window.AndroidBluetoothSerial.readBase64(byteCount, timeoutMs);
      if (!res || res.startsWith("ERR:")) {
        const err = res ? res.substring(4) : "Timeout";
        if (err.toLowerCase().includes("timeout")) {
          throw new ReceiveTimeoutError(err);
        }
        this._handleSuddenDisconnect();
        throw new ClientUnavailableError(err);
      }
      const binary = atob(res);
      const packet = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        packet[i] = binary.charCodeAt(i);
      }
      if (this.onTraffic) {
        this.onTraffic("RX", packet);
      }
      return packet;
    }

    if (!this.reader) {
      throw new ClientUnavailableError();
    }

    const deadline = Date.now() + timeoutMs;

    while (true) {
      // Align rxBuffer to magic start code 0x43 0xF0 or 0x43 0x0F if any leading padding exists
      if (this.rxBuffer.length >= 2) {
        let magicIdx = -1;
        for (let i = 0; i <= this.rxBuffer.length - 2; i++) {
          if (
            this.rxBuffer[i] === 0x43 &&
            (this.rxBuffer[i + 1] === 0xf0 || this.rxBuffer[i + 1] === 0x0f)
          ) {
            magicIdx = i;
            break;
          }
        }
        if (magicIdx > 0) {
          this.rxBuffer = this.rxBuffer.slice(magicIdx);
        } else if (magicIdx === -1 && this.rxBuffer[this.rxBuffer.length - 1] !== 0x43) {
          // Discard leading zero padding bytes from previous 36-byte StartSession frame
          this.rxBuffer = new Uint8Array(0);
        }
      }

      if (this.rxBuffer.length >= byteCount) {
        // Check if this is a 36-byte StartSession response (ack 0x0000 at bytes 5..6)
        const isStartSessionAck =
          this.rxBuffer.length >= 7 &&
          this.rxBuffer[5] === 0x00 &&
          this.rxBuffer[6] === 0x00;
        const frameLen =
          isStartSessionAck && this.rxBuffer.length >= 36 ? 36 : byteCount;

        const packet = this.rxBuffer.slice(0, frameLen);
        this.rxBuffer = this.rxBuffer.slice(frameLen);

        if (this.onTraffic) {
          this.onTraffic("RX", packet);
        }
        return packet;
      }

      const remainingMs = Math.max(50, deadline - Date.now());
      if (Date.now() >= deadline) {
        throw new ReceiveTimeoutError(
          `Timed out after ${timeoutMs}ms waiting for ${byteCount} bytes from printer.`
        );
      }

      let timeoutId = null;
      const readPromise = this.reader.read();
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new ReceiveTimeoutError(
              `Timed out after ${timeoutMs}ms waiting for ${byteCount} bytes from printer.`
            )
          );
        }, remainingMs);
      });

      let result;
      try {
        result = await Promise.race([readPromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      const { value, done } = result;
      if (done) {
        this._handleSuddenDisconnect();
        throw new ClientUnavailableError(
          "Bluetooth RFCOMM stream closed. Make sure the printer is powered on and connected."
        );
      }

      if (value && value.length > 0) {
        const merged = new Uint8Array(this.rxBuffer.length + value.length);
        merged.set(this.rxBuffer, 0);
        merged.set(value, this.rxBuffer.length);
        this.rxBuffer = merged;
      }
    }
  }

  _handleSuddenDisconnect() {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected && this.onTraffic) {
      this.onTraffic("ERR", null, "Bluetooth RFCOMM transport disconnected.");
    }
    if (wasConnected && this.onDisconnect) {
      this.onDisconnect();
    }
  }

  async disconnect() {
    this.connected = false;
    if (this.isAndroidBridge) {
      try {
        window.AndroidBluetoothSerial.disconnect();
      } catch (_) {}
      if (this.onTraffic) {
        this.onTraffic("INFO", null, "Disconnected Native Android RFCOMM stream.");
      }
      return;
    }
    try {
      if (this.port) {
        this.port.removeEventListener("disconnect", this._boundDisconnectHandler);
      }
      if (this.reader) {
        await this.reader.cancel().catch(() => {});
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close().catch(() => {});
        this.writer.releaseLock();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close().catch(() => {});
        this.port = null;
      }
      if (this.onTraffic) {
        this.onTraffic("INFO", null, "Disconnected Web Serial RFCOMM stream.");
      }
    } catch (_) {
      // Ignore cleanup errors on already-closed ports
    }
  }
}
