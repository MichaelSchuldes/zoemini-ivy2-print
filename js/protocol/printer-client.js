/**
 * High-Level Zoemini 2 / Ivy 2 Printer Client
 * Implements the full handshake, status verification, setting management,
 * 24s keep-alive polling, and 990-byte chunked JPEG transfer.
 */

import {
  CONTROL_PACKET_SIZE,
  PRINT_DATA_CHUNK,
  INTER_CHUNK_DELAY_MS,
  PRINT_BATTERY_MIN,
  KEEP_ALIVE_INTERVAL_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  PRINT_TRANSFER_TIMEOUT_MS,
  ACK_START_SESSION,
  ACK_GET_STATUS,
  ACK_SETTING_ACCESSORY,
  ACK_PRINT_READY,
  ACK_REBOOT,
} from "./constants.js";
import {
  buildStartSessionPacket,
  buildGetStatusPacket,
  buildGetSettingPacket,
  buildSetSettingPacket,
  buildGetPrintReadyPacket,
  buildRebootPacket,
  parseIncomingMessage,
  parseStartSessionResponse,
  parseStatusResponse,
  parseSettingResponse,
  parsePrintReadyResponse,
  detectDevicePaperMode,
} from "./packets.js";
import {
  ClientUnavailableError,
  AckError,
  LowBatteryError,
  CoverOpenError,
  NoPaperError,
  WrongSmartSheetError,
  PrinterHardwareError,
} from "./errors.js";

const LOADED_PAPER_STORAGE_KEY = "zoemini2_loaded_printer_paper_v1";

function loadPersistedTrayPaper() {
  try {
    const saved = localStorage.getItem(LOADED_PAPER_STORAGE_KEY);
    if (saved === "full-2x3" || saved === "dual-round-2c") {
      return saved;
    }
  } catch (_) {}
  return "full-2x3";
}

function savePersistedTrayPaper(mode) {
  try {
    if (mode === "full-2x3" || mode === "dual-round-2c") {
      localStorage.setItem(LOADED_PAPER_STORAGE_KEY, mode);
    } else {
      localStorage.removeItem(LOADED_PAPER_STORAGE_KEY);
    }
  } catch (_) {}
}

export class ZoeminiPrinter {
  /**
   * @param {Object} options
   * @param {(state: Object) => void} [options.onStateChange]
   * @param {(paperMode: string, isInitialConnect: boolean) => void} [options.onPaperModeDetected]
   * @param {() => void} [options.onCoverClosed]
   */
  constructor({
    onStateChange = null,
    onPaperModeDetected = null,
    onCoverClosed = null,
  } = {}) {
    this.transport = null;
    this.onStateChange = onStateChange;
    this.onPaperModeDetected = onPaperModeDetected;
    this.onCoverClosed = onCoverClosed;
    this._keepAliveTimer = null;
    this._mutex = Promise.resolve();
    this._isPrinting = false;
    this._lastNotifiedPaperMode = null;

    this.telemetry = {
      connected: false,
      isSimulator: false,
      batteryLevel: null,
      mtu: null,
      errorCode: 0,
      queueStatus: 0,
      queueFlags: null,
      usbStatus: 0,
      isCoverOpen: false,
      isNoPaper: false,
      isWrongSmartSheet: false,
      autoPowerOff: null,
      firmwareVersion: null,
      mediaCode: null,
      tmdVersion: null,
      photosPrinted: null,
      colorId: null,
      paperProfileId: null,
      paperTypeOverride: loadPersistedTrayPaper(), // 'full-2x3' | 'dual-round-2c'
      detectedPaperMode: null, // 'full-2x3' | 'dual-round-2c' | null
      lastUpdated: null,
    };
  }

  isConnected() {
    return Boolean(this.transport && this.transport.connected);
  }

  get connected() {
    return this.isConnected();
  }

  setPaperTypeOverride(overrideMode = null) {
    this.telemetry.paperTypeOverride = overrideMode || null;
    savePersistedTrayPaper(this.telemetry.paperTypeOverride);
    const prevMode = this.telemetry.detectedPaperMode;
    this.telemetry.detectedPaperMode = detectDevicePaperMode(this.telemetry);
    if (
      this.isConnected() &&
      this.telemetry.detectedPaperMode &&
      this.telemetry.detectedPaperMode !== prevMode &&
      this.onPaperModeDetected
    ) {
      this._lastNotifiedPaperMode = this.telemetry.detectedPaperMode;
      this.onPaperModeDetected(this.telemetry.detectedPaperMode, false);
    }
    this._notifyState();
  }

  /**
   * Connects using the provided transport (WebSerial or Mock), runs StartSession
   * (with automatic retry while the Bluetooth RFCOMM link transitions from config to connected),
   * queries initial Status and Settings, and starts the keep-alive loop.
   */
  async connect(transport, isSimulator = false) {
    if (this.isConnected()) {
      await this.disconnect();
    }

    this.transport = transport;
    await this.transport.connect();

    this.telemetry.connected = true;
    this.telemetry.isSimulator = isSimulator;
    this._lastNotifiedPaperMode = null;

    try {
      let sessionInfo = null;
      let lastErr = null;
      const maxAttempts = isSimulator ? 1 : 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          sessionInfo = await this.startSession();
          break;
        } catch (err) {
          lastErr = err;
          if (!this.isConnected() || attempt === maxAttempts) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (!sessionInfo && lastErr) {
        throw lastErr;
      }

      this.telemetry.batteryLevel = sessionInfo.batteryLevel;
      this.telemetry.mtu = sessionInfo.mtu;

      await this.getStatus();
      await this.getSetting();

      const detectedMode = detectDevicePaperMode(this.telemetry);
      this.telemetry.detectedPaperMode = detectedMode;
      if (detectedMode && this.onPaperModeDetected) {
        this._lastNotifiedPaperMode = detectedMode;
        this.onPaperModeDetected(detectedMode, true);
      }

      this._startKeepAlive();
      this._notifyState();
      return { ...this.telemetry };
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect() {
    this._stopKeepAlive();
    if (this.transport) {
      await this.transport.disconnect();
      this.transport = null;
    }
    this.telemetry.connected = false;
    this.telemetry.detectedPaperMode = null;
    this._lastNotifiedPaperMode = null;
    this._notifyState();
  }

  /**
   * Serializes all command/response exchanges so background status polling
   * never interleaves with user settings or print transfers.
   */
  _enqueueTask(fn) {
    const next = this._mutex.then(fn, fn);
    this._mutex = next.catch(() => {});
    return next;
  }

  async _performTask(outboundBytes, expectedAck, responseParser, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    if (!this.isConnected()) {
      throw new ClientUnavailableError();
    }

    await this.transport.write(outboundBytes);
    const rawResp = await this.transport.readExact(CONTROL_PACKET_SIZE, timeoutMs);
    const parsed = parseIncomingMessage(rawResp);

    if (parsed.ack !== expectedAck) {
      throw new AckError(expectedAck, parsed.ack, parsed.error);
    }

    return responseParser ? responseParser(parsed) : parsed;
  }

  async startSession() {
    return this._enqueueTask(async () => {
      const res = await this._performTask(
        buildStartSessionPacket(),
        ACK_START_SESSION,
        parseStartSessionResponse
      );
      this.telemetry.batteryLevel = res.batteryLevel;
      this.telemetry.mtu = res.mtu;
      this.telemetry.lastUpdated = new Date();
      this._notifyState();
      return res;
    });
  }

  async getStatus() {
    return this._enqueueTask(async () => {
      const wasCoverOpen = Boolean(this.telemetry.isCoverOpen);
      const res = await this._performTask(
        buildGetStatusPacket(),
        ACK_GET_STATUS,
        parseStatusResponse
      );
      Object.assign(this.telemetry, res, { lastUpdated: new Date() });
      this._refreshDetectedPaperMode();
      this._notifyState();

      if (wasCoverOpen && !res.isCoverOpen && this.onCoverClosed) {
        this.onCoverClosed();
      }
      return res;
    });
  }

  async getSetting() {
    return this._enqueueTask(async () => {
      const res = await this._performTask(
        buildGetSettingPacket(),
        ACK_SETTING_ACCESSORY,
        parseSettingResponse
      );
      Object.assign(this.telemetry, res, { lastUpdated: new Date() });
      this._refreshDetectedPaperMode();
      this._notifyState();
      return res;
    });
  }

  _refreshDetectedPaperMode() {
    const detected = detectDevicePaperMode(this.telemetry);
    this.telemetry.detectedPaperMode = detected;
    if (
      this._lastNotifiedPaperMode !== null &&
      detected &&
      detected !== this._lastNotifiedPaperMode &&
      this.onPaperModeDetected
    ) {
      this._lastNotifiedPaperMode = detected;
      this.onPaperModeDetected(detected, false);
    }
  }

  async setSetting(autoPowerOffMinutes) {
    return this._enqueueTask(async () => {
      await this._performTask(
        buildSetSettingPacket(autoPowerOffMinutes),
        ACK_SETTING_ACCESSORY,
        null
      );
      this.telemetry.autoPowerOff = autoPowerOffMinutes;
      this.telemetry.lastUpdated = new Date();
      this._notifyState();
      return this.telemetry.autoPowerOff;
    });
  }

  async reboot() {
    return this._enqueueTask(async () => {
      const res = await this._performTask(buildRebootPacket(), ACK_REBOOT, null);
      await this.disconnect();
      return res;
    });
  }

  /**
   * Verifies battery >= 30%, cover closed, paper present, and valid Smart Sheet.
   */
  async checkPrintWorthiness() {
    const status = await this.getStatus();

    if (status.errorCode !== 0) {
      throw new PrinterHardwareError(status.errorCode);
    }
    if (status.batteryLevel < PRINT_BATTERY_MIN) {
      throw new LowBatteryError(status.batteryLevel);
    }
    if (status.isCoverOpen) {
      throw new CoverOpenError();
    }
    if (status.isNoPaper) {
      throw new NoPaperError();
    }
    if (status.isWrongSmartSheet) {
      throw new WrongSmartSheetError();
    }

    return status;
  }

  /**
   * Executes the full ivy2 print sequence:
   * 1. checkPrintWorthiness() (GetStatus)
   * 2. getSetting()
   * 3. getPrintReady(jpegBytes.length)
   * 4. Stream JPEG in 990-byte chunks with 20ms pacing
   * 5. Wait for final 34-byte completion message from printer
   *
   * @param {Uint8Array} jpegBytes
   * @param {(progress: { phase: string, percent: number, sentBytes: number, totalBytes: number }) => void} [onProgress]
   */
  async print(jpegBytes, onProgress = null) {
    if (!(jpegBytes instanceof Uint8Array) || jpegBytes.length === 0) {
      throw new Error("Invalid or empty JPEG byte buffer.");
    }

    this._isPrinting = true;
    try {
      const totalBytes = jpegBytes.length;

      if (onProgress) {
        onProgress({ phase: "Checking printer status...", percent: 2, sentBytes: 0, totalBytes });
      }
      await this.checkPrintWorthiness();

      if (onProgress) {
        onProgress({ phase: "Reading printer settings...", percent: 5, sentBytes: 0, totalBytes });
      }
      await this.getSetting();

      return await this._enqueueTask(async () => {
        if (onProgress) {
          onProgress({
            phase: `Sending Print Ready (${(totalBytes / 1024).toFixed(1)} KB)...`,
            percent: 8,
            sentBytes: 0,
            totalBytes,
          });
        }

        const readyResp = await this._performTask(
          buildGetPrintReadyPacket(totalBytes),
          ACK_PRINT_READY,
          parsePrintReadyResponse
        );

        if (readyResp.errorCode !== 0) {
          throw new PrinterHardwareError(readyResp.errorCode);
        }

        // Stream JPEG in 990-byte chunks
        let startIndex = 0;
        while (startIndex < totalBytes) {
          const endIndex = Math.min(startIndex + PRINT_DATA_CHUNK, totalBytes);
          const chunk = jpegBytes.subarray(startIndex, endIndex);

          await this.transport.write(chunk);
          startIndex = endIndex;

          const transferPct = Math.min(95, 10 + Math.round((startIndex / totalBytes) * 85));
          if (onProgress) {
            onProgress({
              phase: `Streaming JPEG chunks (${Math.ceil(startIndex / PRINT_DATA_CHUNK)} / ${Math.ceil(totalBytes / PRINT_DATA_CHUNK)})...`,
              percent: transferPct,
              sentBytes: startIndex,
              totalBytes,
            });
          }

          if (startIndex < totalBytes) {
            await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
          }
        }

        if (onProgress) {
          onProgress({
            phase: "Transfer complete — waiting for printer spool confirmation...",
            percent: 97,
            sentBytes: totalBytes,
            totalBytes,
          });
        }

        const rawCompletion = await this.transport.readExact(
          CONTROL_PACKET_SIZE,
          PRINT_TRANSFER_TIMEOUT_MS
        );
        const completionMsg = parseIncomingMessage(rawCompletion);

        if (onProgress) {
          onProgress({
            phase: "Print job accepted! Printing now...",
            percent: 100,
            sentBytes: totalBytes,
            totalBytes,
          });
        }

        return completionMsg;
      });
    } finally {
      this._isPrinting = false;
      // Refresh status/print counter shortly after print completes
      if (this.isConnected()) {
        this.getSetting().catch(() => {});
        this.getStatus().catch(() => {});
      }
    }
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveTimer = setInterval(() => {
      if (this.isConnected() && !this._isPrinting) {
        this.getStatus().catch(() => {});
      }
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  _stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  _notifyState() {
    if (this.onStateChange) {
      this.onStateChange({ ...this.telemetry });
    }
  }
}
