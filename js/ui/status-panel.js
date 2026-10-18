/**
 * Printer Connection, Simulator Controls & Hardware Telemetry Panel
 */

import { ZoeminiSerialTransport } from "../transport/web-serial.js";
import { MockZoeminiTransport } from "../transport/mock-transport.js";
import {
  PRINT_BATTERY_MIN,
  PAPER_MODE_FULL,
  PAPER_MODE_DUAL_ROUND,
} from "../protocol/constants.js";

export class StatusPanel {
  /**
   * @param {Object} options
   * @param {import('../protocol/printer-client.js').ZoeminiPrinter} options.printer
   * @param {import('./debug-console.js').DebugConsole} options.debugConsole
   * @param {(msg: string, type?: 'info'|'success'|'warn'|'error') => void} options.showToast
   * @param {() => void} options.onConnectionChanged
   * @param {() => string} [options.getUiPaperMode]
   */
  constructor({
    printer,
    debugConsole,
    showToast,
    onConnectionChanged,
    getUiPaperMode = null,
  }) {
    this.printer = printer;
    this.debugConsole = debugConsole;
    this.showToast = showToast;
    this.onConnectionChanged = onConnectionChanged;
    this.getUiPaperMode = getUiPaperMode;

    this.mockTransportInstance = null;
    this.connectedDeviceName = null;
    this.connectingDeviceName = null;
    this.isConnecting = false;

    this._cacheDom();
    this._checkBrowserCompatibility();
    this._bindEvents();
  }

  _cacheDom() {
    this.compatBanner = document.getElementById("compat-warning-banner");
    this.compatMessage = document.getElementById("compat-warning-text");

    // Header connection indicators
    this.headerDeviceBadge = document.getElementById("header-connected-device");
    this.headerDeviceName = document.getElementById("header-device-name");
    this.headerSpinner = document.getElementById("header-conn-spinner");

    this.connBadge = document.getElementById("connection-status-badge");
    this.btnConnectBt = document.getElementById("btn-connect-bt");
    this.btnConnectSim = document.getElementById("btn-connect-sim");
    this.btnDisconnect = document.getElementById("btn-disconnect");
    this.headerMoreMenu = document.getElementById("header-more-menu");
    this.btnRefreshStatus = document.getElementById("btn-refresh-status");
    this.btnRebootPrinter = document.getElementById("btn-reboot-printer");
    this.selectAutoOff = document.getElementById("select-auto-power-off");
    this.selectPaperOverride = document.getElementById("select-device-paper-override");

    // Telemetry readouts
    this.elBatteryValue = document.getElementById("tel-battery-value");
    this.elBatteryBar = document.getElementById("tel-battery-bar");
    this.elCoverStatus = document.getElementById("tel-cover-status");
    this.elPaperStatus = document.getElementById("tel-paper-status");
    this.elSmartSheet = document.getElementById("tel-smart-sheet");
    this.elFirmware = document.getElementById("tel-firmware");
    this.elPrintCount = document.getElementById("tel-print-count");
    this.elMtu = document.getElementById("tel-mtu");

    // Simulator fault-injection panel
    this.simControlsBox = document.getElementById("simulator-fault-controls");
    this.simSelectPaper = document.getElementById("sim-select-paper");
    this.simBatInput = document.getElementById("sim-battery-range");
    this.simBatLabel = document.getElementById("sim-battery-label");
    this.simChkCover = document.getElementById("sim-chk-cover");
    this.simChkNoPaper = document.getElementById("sim-chk-nopaper");
    this.simChkSmartSheet = document.getElementById("sim-chk-smartsheet");

    // Bluetooth device selection modal
    this.deviceModal = document.getElementById("bt-device-modal");
    this.deviceList = document.getElementById("bt-device-list");
    this.btnCloseDeviceModal = document.getElementById("btn-close-device-modal");
    this.btnCancelDeviceModal = document.getElementById("btn-cancel-device-modal");
  }

  _checkBrowserCompatibility() {
    const supported = ZoeminiSerialTransport.isSupported();
    if (!supported && this.compatBanner) {
      this.compatBanner.hidden = false;
      if (!window.isSecureContext) {
        this.compatMessage.textContent =
          "Web Serial API requires HTTPS or http://localhost. Hardware Bluetooth connection is disabled, but you can prepare/download ZINK print files or use the Simulator from the ⋮ menu.";
      } else {
        this.compatMessage.textContent =
          "Your browser does not expose the Web Serial API (navigator.serial). Use Chrome, Edge, Brave, or Opera on Desktop/Android to print directly over Bluetooth RFCOMM.";
      }
    }
  }

  _bindEvents() {
    if (this.headerMoreMenu) {
      document.addEventListener("click", (e) => {
        if (this.headerMoreMenu.open && !this.headerMoreMenu.contains(e.target)) {
          this.headerMoreMenu.open = false;
        }
      });
    }
    if (this.btnConnectBt) {
      this.btnConnectBt.addEventListener("click", () => this.connectHardware());
    }
    if (this.btnConnectSim) {
      this.btnConnectSim.addEventListener("click", () => this.connectSimulator());
    }
    if (this.btnDisconnect) {
      this.btnDisconnect.addEventListener("click", () => this.disconnect());
    }
    if (this.btnRefreshStatus) {
      this.btnRefreshStatus.addEventListener("click", async () => {
        try {
          await this.printer.getStatus();
          await this.printer.getSetting();
          this.showToast("Printer telemetry refreshed.", "info");
        } catch (err) {
          this.showToast(err.message, "error");
        }
      });
    }
    if (this.selectPaperOverride) {
      this.selectPaperOverride.addEventListener("change", (e) => {
        const val = e.target.value;
        this.printer.setPaperTypeOverride(val);
        const label =
          val === PAPER_MODE_DUAL_ROUND
            ? "2× Round Cutouts (ZP-2030-2C)"
            : "2×3\" Full Sheet (ZP-2030)";
        this.showToast(`Loaded tray paper set to ${label}.`, "info");
      });
    }
    if (this.selectAutoOff) {
      this.selectAutoOff.addEventListener("change", async (e) => {
        const minutes = Number(e.target.value);
        if (![3, 5, 10].includes(minutes)) return;
        try {
          await this.printer.setSetting(minutes);
          this.showToast(`Auto power-off set to ${minutes} minutes.`, "success");
        } catch (err) {
          this.showToast(err.message, "error");
        }
      });
    }
    if (this.btnRebootPrinter) {
      this.btnRebootPrinter.addEventListener("click", async () => {
        try {
          await this.printer.reboot();
          this.showToast("Reboot command sent to printer.", "info");
        } catch (err) {
          this.showToast(err.message, "error");
        }
      });
    }

    // Simulator fault controls
    const syncSimFaults = async () => {
      if (!this.mockTransportInstance) return;
      const bat = Number(this.simBatInput.value);
      this.simBatLabel.textContent = `${bat}%`;
      this.mockTransportInstance.simState.batteryLevel = bat;
      this.mockTransportInstance.simState.isCoverOpen = this.simChkCover.checked;
      this.mockTransportInstance.simState.isNoPaper = this.simChkNoPaper.checked;
      this.mockTransportInstance.simState.isWrongSmartSheet = this.simChkSmartSheet.checked;
      if (this.simSelectPaper) {
        this.mockTransportInstance.simState.loadedPaperMode = this.simSelectPaper.value;
        this.printer.setPaperTypeOverride(this.simSelectPaper.value);
      }
      if (this.printer.isConnected() && this.printer.telemetry.isSimulator) {
        await this.printer.getStatus().catch(() => {});
        await this.printer.getSetting().catch(() => {});
      }
    };

    if (this.simSelectPaper) this.simSelectPaper.addEventListener("change", syncSimFaults);
    if (this.simBatInput) this.simBatInput.addEventListener("input", syncSimFaults);
    if (this.simChkCover) this.simChkCover.addEventListener("change", syncSimFaults);
    if (this.simChkNoPaper) this.simChkNoPaper.addEventListener("change", syncSimFaults);
    if (this.simChkSmartSheet) this.simChkSmartSheet.addEventListener("change", syncSimFaults);
  }

  selectDeviceModal(devices) {
    return new Promise((resolve) => {
      if (!this.deviceModal || !this.deviceList) {
        resolve(devices[0] || null);
        return;
      }

      this.deviceList.innerHTML = "";
      devices.forEach((dev) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "device-item";

        const isPrinter = /(canon|zoemini|ivy|mini printer)/i.test(dev.name || "");
        item.innerHTML = `
          <div class="device-info">
            <span class="device-name">${dev.name || "Unknown Device"}</span>
            <span class="device-address">${dev.address}</span>
          </div>
          ${isPrinter ? '<span class="device-badge">Printer</span>' : ""}
        `;

        item.addEventListener("click", () => {
          this.deviceModal.hidden = true;
          cleanup();
          resolve(dev);
        });

        this.deviceList.appendChild(item);
      });

      const onCancel = () => {
        this.deviceModal.hidden = true;
        cleanup();
        resolve(null);
      };

      const cleanup = () => {
        this.btnCloseDeviceModal?.removeEventListener("click", onCancel);
        this.btnCancelDeviceModal?.removeEventListener("click", onCancel);
      };

      this.btnCloseDeviceModal?.addEventListener("click", onCancel);
      this.btnCancelDeviceModal?.addEventListener("click", onCancel);

      this.deviceModal.hidden = false;
    });
  }

  _renderHeaderState() {
    const isConn = Boolean(this.printer?.connected);
    const isConnecting = Boolean(this.isConnecting);

    if (this.headerSpinner) {
      this.headerSpinner.hidden = !isConnecting;
    }

    if (this.btnConnectBt) {
      this.btnConnectBt.disabled = isConnecting;
      if (isConnecting) {
        this.btnConnectBt.innerHTML = `<span class="spinner" aria-hidden="true"></span> Connecting...`;
      } else {
        this.btnConnectBt.innerHTML = `Connect Bluetooth (Web Serial)`;
      }
      this.btnConnectBt.hidden = isConn;
    }

    if (this.btnDisconnect) {
      this.btnDisconnect.hidden = !isConn;
    }

    if (this.btnConnectSim) {
      this.btnConnectSim.disabled = isConnecting;
      this.btnConnectSim.hidden = isConn;
    }

    if (this.headerDeviceBadge && this.headerDeviceName) {
      if (isConn && this.connectedDeviceName) {
        this.headerDeviceName.textContent = this.connectedDeviceName;
        this.headerDeviceBadge.hidden = false;
      } else if (isConnecting && this.connectingDeviceName) {
        this.headerDeviceName.textContent = this.connectingDeviceName;
        this.headerDeviceBadge.hidden = false;
      } else {
        this.headerDeviceBadge.hidden = true;
      }
    }

    if (this.connBadge) {
      if (isConnecting) {
        this.connBadge.textContent = "Connecting...";
        this.connBadge.className = "status-pill pill-warn";
      } else if (!isConn) {
        this.connBadge.textContent = "Disconnected";
        this.connBadge.className = "status-pill pill-neutral";
      } else if (this.printer.isSimulator) {
        this.connBadge.textContent = "Simulator Active";
        this.connBadge.className = "status-pill pill-sim";
      } else {
        this.connBadge.textContent = "Connected";
        this.connBadge.className = "status-pill pill-ok";
      }
    }
  }

  async connectHardware() {
    let chosenAddress = null;
    let chosenName = null;

    if (typeof window !== "undefined" && window.AndroidBluetoothSerial) {
      let devices = [];
      try {
        devices = JSON.parse(window.AndroidBluetoothSerial.getBondedDevices() || "[]");
      } catch (e) {
        console.warn("Failed to parse bonded devices", e);
      }

      if (devices.length === 0) {
        this.showToast(
          "No paired Bluetooth devices found. Please pair your Zoemini in Android Bluetooth settings first.",
          "warn"
        );
        return;
      }

      const selected = await this.selectDeviceModal(devices);
      if (!selected) {
        // User cancelled selection modal
        return;
      }
      chosenAddress = selected.address;
      chosenName = selected.name || "Canon Mini Printer";
    }

    this.isConnecting = true;
    this.connectingDeviceName = chosenName || "Zoemini 2 / Ivy 2";
    this._renderHeaderState();

    try {
      const transport = new ZoeminiSerialTransport({
        targetAddress: chosenAddress,
        deviceName: chosenName,
        onTraffic: (dir, bytes, note) => this.debugConsole.logTraffic(dir, bytes, note),
        onDisconnect: () => {
          this.connectedDeviceName = null;
          this.printer.disconnect();
          this._renderHeaderState();
          this.showToast("Bluetooth connection closed.", "warn");
        },
      });
      await this.printer.connect(transport, false);
      this.connectedDeviceName = transport.deviceName || chosenName || "Zoemini 2 / Ivy 2";
      this.showToast("Connected to Zoemini 2 / Ivy 2 over Bluetooth RFCOMM!", "success");
    } catch (err) {
      this.connectedDeviceName = null;
      if (err && err.name !== "NotFoundError") {
        this.showToast(err.message || "Failed to connect to printer.", "error");
      }
    } finally {
      this.isConnecting = false;
      this.connectingDeviceName = null;
      this._renderHeaderState();
      if (this.onConnectionChanged) this.onConnectionChanged();
    }
  }

  async connectSimulator() {
    this.isConnecting = true;
    this.connectingDeviceName = "Hardware Simulator";
    this._renderHeaderState();

    try {
      this.mockTransportInstance = new MockZoeminiTransport({
        onTraffic: (dir, bytes, note) => this.debugConsole.logTraffic(dir, bytes, note),
      });
      // Sync initial simulator UI controls
      if (this.simBatInput) {
        this.mockTransportInstance.simState.batteryLevel = Number(this.simBatInput.value);
        this.mockTransportInstance.simState.isCoverOpen = this.simChkCover.checked;
        this.mockTransportInstance.simState.isNoPaper = this.simChkNoPaper.checked;
        this.mockTransportInstance.simState.isWrongSmartSheet = this.simChkSmartSheet.checked;
      }
      if (this.simSelectPaper) {
        this.mockTransportInstance.simState.loadedPaperMode =
          this.printer.telemetry.paperTypeOverride || this.simSelectPaper.value;
        this.simSelectPaper.value = this.mockTransportInstance.simState.loadedPaperMode;
      }
      await this.printer.connect(this.mockTransportInstance, true);
      this.connectedDeviceName = "Hardware Simulator";
      this.showToast("Connected to Zoemini 2 / Ivy 2 Hardware Simulator.", "success");
    } catch (err) {
      this.connectedDeviceName = null;
      this.showToast(err.message || "Simulator error.", "error");
    } finally {
      this.isConnecting = false;
      this.connectingDeviceName = null;
      this._renderHeaderState();
      if (this.onConnectionChanged) this.onConnectionChanged();
    }
  }

  async disconnect() {
    this.connectedDeviceName = null;
    await this.printer.disconnect();
    this._renderHeaderState();
    this.showToast("Disconnected from printer.", "info");
    if (this.onConnectionChanged) this.onConnectionChanged();
  }

  /**
   * Updates all telemetry badges when printer state or UI paper mode changes.
   */
  renderTelemetry(tel) {
    const isConn = Boolean(tel.connected);
    const uiPaperMode = this.getUiPaperMode ? this.getUiPaperMode() : null;

    if (this.selectPaperOverride && tel.paperTypeOverride) {
      this.selectPaperOverride.value = tel.paperTypeOverride;
    }

    this._renderHeaderState();

    if (this.btnRefreshStatus) this.btnRefreshStatus.disabled = !isConn;
    if (this.btnRebootPrinter) this.btnRebootPrinter.disabled = !isConn;
    if (this.selectAutoOff) this.selectAutoOff.disabled = !isConn;
    if (this.simControlsBox) {
      this.simControlsBox.hidden = !(isConn && tel.isSimulator);
    }

    if (!isConn) {
      this.elBatteryValue.textContent = "—";
      this.elBatteryBar.style.width = "0%";
      this.elBatteryBar.className = "battery-fill";
      this.elCoverStatus.textContent = "—";
      this.elCoverStatus.className = "tel-badge";
      this.elPaperStatus.textContent = "—";
      this.elPaperStatus.className = "tel-badge";
      this.elSmartSheet.textContent = "—";
      this.elSmartSheet.className = "tel-badge";
      this.elFirmware.textContent = "—";
      this.elPrintCount.textContent = "—";
      this.elMtu.textContent = "—";
      return;
    }

    // Battery (6-bit value, typically 0..63 or 0..100%)
    const bat = tel.batteryLevel ?? 0;
    const batPct = Math.min(100, Math.max(0, Math.round((bat / 63) * 100)));
    const displayBat = bat <= 63 ? `${bat}% (raw)` : `${bat}%`;
    this.elBatteryValue.textContent = `${bat}%`;
    this.elBatteryValue.title = displayBat;
    this.elBatteryBar.style.width = `${Math.max(bat, batPct)}%`;
    this.elBatteryBar.className =
      bat < PRINT_BATTERY_MIN ? "battery-fill bat-low" : "battery-fill bat-ok";

    // Cover status
    this.elCoverStatus.textContent = tel.isCoverOpen ? "Open (!)" : "Closed";
    this.elCoverStatus.className = tel.isCoverOpen ? "tel-badge badge-err" : "tel-badge badge-ok";

    // Loaded ZINK Paper & Mismatch status
    if (tel.isNoPaper) {
      this.elPaperStatus.textContent = "Empty (!)";
      this.elPaperStatus.className = "tel-badge badge-err";
    } else if (tel.detectedPaperMode === PAPER_MODE_DUAL_ROUND) {
      const isMismatch = uiPaperMode && uiPaperMode !== PAPER_MODE_DUAL_ROUND;
      this.elPaperStatus.textContent = isMismatch
        ? "2× Circles (Mismatch!)"
        : "2× Circles (ZP-2030-2C)";
      this.elPaperStatus.className = isMismatch
        ? "tel-badge badge-warn"
        : "tel-badge badge-ok";
    } else if (tel.detectedPaperMode === PAPER_MODE_FULL) {
      const isMismatch = uiPaperMode && uiPaperMode !== PAPER_MODE_FULL;
      this.elPaperStatus.textContent = isMismatch
        ? "2×3\" Sheet (Mismatch!)"
        : "2×3\" Sheet (ZP-2030)";
      this.elPaperStatus.className = isMismatch
        ? "tel-badge badge-warn"
        : "tel-badge badge-ok";
    } else {
      this.elPaperStatus.textContent = "Loaded";
      this.elPaperStatus.className = "tel-badge badge-ok";
    }

    // Smart Sheet status
    this.elSmartSheet.textContent = tel.isWrongSmartSheet ? "Invalid (!)" : "OK";
    this.elSmartSheet.className = tel.isWrongSmartSheet
      ? "tel-badge badge-err"
      : "tel-badge badge-ok";

    // Firmware & counters
    this.elFirmware.textContent = tel.firmwareVersion
      ? `v${tel.firmwareVersion} (TMD ${tel.tmdVersion ?? 0})`
      : "—";
    this.elPrintCount.textContent =
      tel.photosPrinted !== null && tel.photosPrinted !== undefined
        ? `${tel.photosPrinted} prints`
        : "—";
    this.elMtu.textContent = tel.mtu ? `${tel.mtu} B` : "990 B";

    if (this.selectAutoOff && [3, 5, 10].includes(tel.autoPowerOff)) {
      this.selectAutoOff.value = String(tel.autoPowerOff);
    }
  }
}
