/**
 * Diagnostic Protocol Hex Logger & Packet Inspector UI
 */

import { toHexString, describePacket } from "../protocol/packets.js";

export class DebugConsole {
  constructor() {
    this.logContainer = document.getElementById("hex-log-entries");
    this.countBadge = document.getElementById("hex-log-count");
    this.clearBtn = document.getElementById("btn-clear-log");
    this.exportBtn = document.getElementById("btn-export-log");
    this.hideChunksCheckbox = document.getElementById("chk-hide-jpeg-chunks");

    this.entries = [];
    this._bindEvents();
  }

  _bindEvents() {
    if (this.clearBtn) {
      this.clearBtn.addEventListener("click", () => this.clear());
    }
    if (this.exportBtn) {
      this.exportBtn.addEventListener("click", () => this.exportLogs());
    }
    if (this.hideChunksCheckbox) {
      this.hideChunksCheckbox.addEventListener("change", () => this._rerenderAll());
    }
  }

  /**
   * Records a transport event ('TX' | 'RX' | 'INFO' | 'ERR').
   */
  logTraffic(direction, bytes = null, note = "") {
    const timestamp = new Date().toISOString().slice(11, 23);
    const isJpegChunk =
      bytes &&
      bytes.length > 0 &&
      !(bytes.length === 34 && bytes[0] === 0x43 && bytes[1] === 0x0f);

    const summary = note || (bytes ? describePacket(bytes, direction) : "");
    const hex = bytes ? toHexString(bytes, 40) : "";

    const entry = {
      id: this.entries.length + 1,
      timestamp,
      direction,
      summary,
      hex,
      byteLength: bytes ? bytes.length : 0,
      isJpegChunk,
    };

    this.entries.push(entry);
    if (this.entries.length > 500) {
      this.entries.shift();
    }

    this._updateCount();
    this._appendEntryDom(entry);
  }

  _shouldShow(entry) {
    if (this.hideChunksCheckbox && this.hideChunksCheckbox.checked && entry.isJpegChunk) {
      return false;
    }
    return true;
  }

  _appendEntryDom(entry) {
    if (!this.logContainer || !this._shouldShow(entry)) return;

    const emptyEl = this.logContainer.querySelector(".log-empty");
    if (emptyEl) emptyEl.remove();

    const row = document.createElement("div");
    row.className = `log-row log-${entry.direction.toLowerCase()}`;

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = entry.timestamp;

    const dirSpan = document.createElement("span");
    dirSpan.className = `log-dir dir-${entry.direction.toLowerCase()}`;
    dirSpan.textContent = entry.direction;

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "log-body";

    const summaryDiv = document.createElement("div");
    summaryDiv.className = "log-summary";
    summaryDiv.textContent = entry.summary;
    bodyDiv.appendChild(summaryDiv);

    if (entry.hex) {
      const hexCode = document.createElement("code");
      hexCode.className = "log-hex";
      hexCode.textContent = entry.hex;
      bodyDiv.appendChild(hexCode);
    }

    row.appendChild(timeSpan);
    row.appendChild(dirSpan);
    row.appendChild(bodyDiv);

    this.logContainer.appendChild(row);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  _rerenderAll() {
    if (!this.logContainer) return;
    this.logContainer.innerHTML = "";
    const visible = this.entries.filter((e) => this._shouldShow(e));
    if (visible.length === 0) {
      this.logContainer.innerHTML = `<div class="log-empty">No protocol packets logged yet. Connect to printer to inspect traffic.</div>`;
      return;
    }
    for (const entry of visible) {
      this._appendEntryDom(entry);
    }
  }

  _updateCount() {
    if (this.countBadge) {
      this.countBadge.textContent = String(this.entries.length);
    }
  }

  clear() {
    this.entries = [];
    this._updateCount();
    this._rerenderAll();
  }

  exportLogs() {
    const content = JSON.stringify(this.entries, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zoemini2-protocol-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
