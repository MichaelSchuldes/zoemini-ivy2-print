/**
 * Simulated Zoemini 2 / Ivy 2 Transport for Hardware-Free Testing
 * Emulates exact 34-byte responses for StartSession, GetStatus, GetSetting,
 * SetSetting, GetPrintReady, Reboot, and JPEG chunk ingestion.
 */

import {
  START_CODE,
  CONTROL_PACKET_SIZE,
  COMMAND_START_SESSION,
  COMMAND_GET_STATUS,
  COMMAND_SETTING_ACCESSORY,
  COMMAND_PRINT_READY,
  COMMAND_REBOOT,
  PAPER_MODE_DUAL_ROUND,
} from "../protocol/constants.js";
import { ClientUnavailableError, ReceiveTimeoutError } from "../protocol/errors.js";

export class MockZoeminiTransport {
  constructor({ onTraffic = null, onDisconnect = null } = {}) {
    this.connected = false;
    this.rxBuffer = new Uint8Array(0);
    this.onTraffic = onTraffic;
    this.onDisconnect = onDisconnect;

    // Configurable simulated hardware telemetry
    this.simState = {
      batteryLevel: 63,       // 6-bit value (0..63, where >=30 is healthy)
      mtu: 990,
      usbStatus: 0,
      errorCode: 0,
      isCoverOpen: false,
      isNoPaper: false,
      isWrongSmartSheet: false,
      loadedPaperMode: PAPER_MODE_DUAL_ROUND, // 'dual-round-2c' | 'full-2x3'
      autoPowerOff: 5,        // minutes (3, 5, 10)
      firmwareMajor: 1,
      firmwareMinor: 4,
      firmwarePatch: 7,
      tmdVersion: 22,         // 0x16 (ZP-2030-2C Smart Sheet TMD)
      photosPrinted: 139,
      colorId: 0,
    };

    // JPEG streaming state
    this._awaitingJpegBytes = 0;
    this._receivedJpegBytes = 0;
  }

  async connect() {
    await new Promise((r) => setTimeout(r, 120));
    this.connected = true;
    this.rxBuffer = new Uint8Array(0);
    this._awaitingJpegBytes = 0;
    this._receivedJpegBytes = 0;

    if (this.onTraffic) {
      this.onTraffic("INFO", null, "Connected to Simulated Zoemini 2 (PV-223 Simulator)");
    }
  }

  async write(uint8Array) {
    if (!this.connected) {
      throw new ClientUnavailableError();
    }
    if (this.onTraffic) {
      this.onTraffic("TX", uint8Array);
    }

    // If currently receiving JPEG image chunks
    if (this._awaitingJpegBytes > 0) {
      this._receivedJpegBytes += uint8Array.length;
      if (this._receivedJpegBytes >= this._awaitingJpegBytes) {
        const totalReceived = this._receivedJpegBytes;
        this._awaitingJpegBytes = 0;
        this._receivedJpegBytes = 0;
        this.simState.photosPrinted += 1;

        // Emit completion 34-byte message after short simulated print spooling delay
        setTimeout(() => {
          if (!this.connected) return;
          const donePacket = this._buildAckFrame(COMMAND_PRINT_READY, 0);
          if (this.onTraffic) {
            this.onTraffic(
              "INFO",
              null,
              `Simulator received all ${totalReceived} JPEG bytes; sending print completion ACK.`
            );
          }
          this._enqueueRx(donePacket);
        }, 180);
      }
      return;
    }

    // Otherwise parse 34-byte command frame
    if (uint8Array.length === CONTROL_PACKET_SIZE && uint8Array[0] === 0x43 && uint8Array[1] === 0x0f) {
      const view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
      const command = view.getUint16(5, false);
      const isSetter = view.getUint8(7) === 1;

      setTimeout(() => {
        if (!this.connected) return;
        this._handleCommand(command, isSetter, view);
      }, 25);
    }
  }

  _handleCommand(command, isSetter, reqView) {
    switch (command) {
      case COMMAND_START_SESSION: {
        const resp = this._buildAckFrame(COMMAND_START_SESSION, 0);
        // battery_level = parse_bit_range((data[9] << 8) | data[10], 6)
        const bat = this.simState.batteryLevel & 0x3f;
        resp[9] = (bat >> 8) & 0xff;
        resp[10] = bat & 0xff;
        // mtu = (data[11] << 8) | data[12]
        resp[11] = (this.simState.mtu >> 8) & 0xff;
        resp[12] = this.simState.mtu & 0xff;
        this._enqueueRx(resp);
        break;
      }

      case COMMAND_GET_STATUS: {
        const resp = this._buildAckFrame(COMMAND_GET_STATUS, 0);
        const payload = resp.subarray(8);
        // i = (payload[0] << 8) | payload[1], battery_level = i & 0x3F, usb_status = (i >> 7) & 1
        const iVal = (this.simState.batteryLevel & 0x3f) | ((this.simState.usbStatus & 1) << 7);
        payload[0] = (iVal >> 8) & 0xff;
        payload[1] = iVal & 0xff;
        payload[2] = this.simState.errorCode & 0xff;

        let queueFlags = 0;
        if (this.simState.isCoverOpen) queueFlags |= 1;
        if (this.simState.loadedPaperMode === PAPER_MODE_DUAL_ROUND && !this.simState.isNoPaper) {
          queueFlags |= 2;
        }
        if (this.simState.isNoPaper) queueFlags |= 4;
        if (this.simState.isWrongSmartSheet) queueFlags |= 16;

        payload[4] = (queueFlags >> 8) & 0xff;
        payload[5] = queueFlags & 0xff;
        this._enqueueRx(resp);
        break;
      }

      case COMMAND_SETTING_ACCESSORY: {
        if (isSetter) {
          this.simState.autoPowerOff = reqView.getUint8(8);
        }
        const isCirclePaper = this.simState.loadedPaperMode === PAPER_MODE_DUAL_ROUND;
        const resp = this._buildAckFrame(COMMAND_SETTING_ACCESSORY, 0);
        const payload = resp.subarray(8);
        payload[0] = this.simState.autoPowerOff & 0xff;
        payload[1] = this.simState.firmwareMajor & 0xff;
        payload[2] = this.simState.firmwareMinor & 0xff;
        payload[3] = this.simState.firmwarePatch & 0xff;
        payload[4] = isCirclePaper ? 0x05 : 0x01;
        payload[5] = isCirclePaper ? 0x16 : 0x03; // TMD 22 (0x16) for ZP-2030-2C, TMD 3 for ZP-2030
        payload[6] = (this.simState.photosPrinted >> 8) & 0xff;
        payload[7] = this.simState.photosPrinted & 0xff;
        payload[8] = this.simState.colorId & 0xff;
        payload[9] = 0x00;
        payload[10] = isCirclePaper ? 0x12 : 0x00;
        this._enqueueRx(resp);
        break;
      }

      case COMMAND_PRINT_READY: {
        const jpegLength = reqView.getUint32(8, false);
        this._awaitingJpegBytes = jpegLength;
        this._receivedJpegBytes = 0;
        const resp = this._buildAckFrame(COMMAND_PRINT_READY, 0);
        const payload = resp.subarray(8);
        payload[2] = 1; // ready
        payload[3] = 0; // error_code = 0
        this._enqueueRx(resp);
        break;
      }

      case COMMAND_REBOOT: {
        const resp = this._buildAckFrame(COMMAND_REBOOT, 0);
        this._enqueueRx(resp);
        break;
      }

      default: {
        const resp = this._buildAckFrame(command, 0);
        this._enqueueRx(resp);
        break;
      }
    }
  }

  _buildAckFrame(ackCode, errorByte = 0) {
    const buf = new ArrayBuffer(CONTROL_PACKET_SIZE);
    const view = new DataView(buf);
    view.setUint16(0, START_CODE, false);
    view.setUint16(2, 1, false);
    view.setUint8(4, 32);
    view.setUint16(5, ackCode, false);
    view.setUint8(7, errorByte & 0xff);
    return new Uint8Array(buf);
  }

  _enqueueRx(bytes) {
    const merged = new Uint8Array(this.rxBuffer.length + bytes.length);
    merged.set(this.rxBuffer, 0);
    merged.set(bytes, this.rxBuffer.length);
    this.rxBuffer = merged;
  }

  async readExact(byteCount, timeoutMs = 5000) {
    if (!this.connected) {
      throw new ClientUnavailableError();
    }
    const deadline = Date.now() + timeoutMs;
    while (this.rxBuffer.length < byteCount) {
      if (!this.connected) {
        throw new ClientUnavailableError();
      }
      if (Date.now() >= deadline) {
        throw new ReceiveTimeoutError(`Simulator timed out after ${timeoutMs}ms waiting for ${byteCount} bytes.`);
      }
      await new Promise((r) => setTimeout(r, 15));
    }

    const packet = this.rxBuffer.slice(0, byteCount);
    this.rxBuffer = this.rxBuffer.slice(byteCount);

    if (this.onTraffic) {
      this.onTraffic("RX", packet);
    }
    return packet;
  }

  async disconnect() {
    this.connected = false;
    this._awaitingJpegBytes = 0;
    this._receivedJpegBytes = 0;
    if (this.onTraffic) {
      this.onTraffic("INFO", null, "Disconnected Simulated Zoemini 2.");
    }
  }
}
