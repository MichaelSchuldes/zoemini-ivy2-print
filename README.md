# Zoemini 2 / Ivy 2 — Web Print Studio

A **100% client-side, zero-backend web application** for printing photos, vector SVGs, and PDFs directly from your browser to a **Zoemini 2 (`PV-223`)** or **Ivy 2** pocket ZINK printer over Bluetooth Classic RFCOMM using the **Web Serial API** (`navigator.serial`).

> **Built with Gemini 4** • Protocol implementation based on the reverse-engineering work in **[dtgreene/ivy2](https://github.com/dtgreene/ivy2)**.

---

## ✨ Features

- **100% Static & Client-Side:** No server, no native driver installation, and no build step required. Runs directly from GitHub Pages (`github.io`) or any static HTTP server.
- **Supports Both ZINK Paper Formats:**
  - **2×3" Full Sheet (`ZP-2030`):** Full-bleed `50 × 76 mm` portrait photo printing.
  - **2× Round Cutout Stickers (`ZP-2030-2C`):** Dual circular die-cut stickers (`Ø 33 mm` top & bottom circles on a single sheet) with independent image slots (`Slot #1` & `Slot #2`), radial bleed rendering, and millimeter-level X/Y cutout calibration.
- **Multi-Format Media Support:**
  - **Raster Images:** JPEG, PNG, WebP, GIF, BMP, AVIF.
  - **Vector Graphics (`SVG`):** High-resolution (`2048px`) vector normalization and rasterization supporting `viewBox`-only icons, physical unit dimensions, file uploads, drag-and-drop, and direct `<svg>...</svg>` clipboard pasting (`Ctrl+V` / `Cmd+V`).
  - **Multi-Page PDFs:** Client-side PDF page rendering and page selector powered by `PDF.js`.
- **Interactive 2:3 Print Editor (Desktop & Mobile):**
  - **Aspect Ratio Framing:** Switch between *Crop to Fill (Cover)* and *Fit Entire (Contain)* per slot.
  - **Touch & Mouse Gestures:** Drag to pan, mouse-wheel zoom, and **two-finger mobile pinch-to-zoom** (`25%` – `500%`).
  - **Orientation & Color:** `±90°` step rotation, horizontal/vertical mirroring, auto-rotate landscape option, `-45°` to `+45°` fine straightening slider, and brightness/contrast/saturation/JPEG quality controls.
- **Live Hardware Telemetry & Tray Awareness (`PV-223`):**
  - Real-time battery level (`>= 30%` print safety check), Top Cover open/close detection, paper-out & Smart Sheet status, firmware version, thermal calibration (`TMD`), and lifetime print counter.
  - Automatic prompt when the printer's **Top Cover** is opened and closed to confirm whether you swapped between `ZP-2030` (Full Sheet) and `ZP-2030-2C` (2× Round Stickers), with mismatch warnings before printing.
- **Developer Tools & Hardware Simulator:**
  - Built-in **Simulator Mode** (accessible via the header `⋮` menu) that emulates the `PV-223` state machine, battery level, cover/paper faults, and RFCOMM packet responses without physical hardware.
  - Live **Protocol Hex Inspector** logging 34-byte/36-byte control frames with JSON export.

---

## 🚀 Quick Start

### 1. Browser Requirements
Because the Zoemini 2 / Ivy 2 (`PV-223`) communicates over **Bluetooth Classic SPP (RFCOMM)** (UUID `00001101-0000-1000-8000-00805f9b34fb`), desktop web connections require a browser supporting the **Web Serial API** (`navigator.serial`):
- **Google Chrome** / **Chromium** (v117+ recommended)
- **Microsoft Edge** (v117+)
- **Opera**

---

### 2. Pairing & Connection by Platform

#### Windows / macOS / ChromeOS
1. Turn on your **Zoemini 2 / Ivy 2** (hold the power button until the LED illuminates).
2. Pair the printer in your OS Bluetooth settings.
3. Open the web app in Chrome/Edge, click **Connect Bluetooth (Web Serial)**, and select your printer.

#### Linux (BlueZ `/dev/rfcomm0`)
On Linux, Chromium's chooser often disconnects if it tries to open a raw Bluetooth socket directly without an active RFCOMM TTY binding. Bind the printer to `/dev/rfcomm0` first:
```bash
# 1. Pair and trust the printer (replace with your printer's MAC address)
bluetoothctl pair 04:7F:0E:A1:3B:57
bluetoothctl trust 04:7F:0E:A1:3B:57

# 2. Bind Bluetooth RFCOMM channel 1 to /dev/rfcomm0
sudo rfcomm bind 0 04:7F:0E:A1:3B:57 1
```
Then click **Connect Bluetooth (Web Serial)** in the browser and select **`rfcomm0`**.

---

### 📱 Android: The Bluetooth Pairing Issue & Solution

If you use Android, you may notice three common issues when trying to connect through normal means:

1. **Why Android System Bluetooth Settings says "Couldn't Connect":**
   Android's system Bluetooth settings menu is designed only for system-managed profiles: Audio (A2DP), Phone Calls (HFP), and Keyboards/Mice (HID). Android **does not have an OS-level daemon for SPP (Serial Port Profile)**. When you tap the printer in Android's Bluetooth menu, the phone attempts to connect via audio/input profiles, which the printer rejects. **This is normal:** on Android, SPP devices are paired in settings, but the actual connection is established on-demand by an app.
2. **Why Chrome for Android cannot connect in a normal browser tab:**
   - **Web Bluetooth (`navigator.bluetooth`):** Only supports Bluetooth Low Energy (BLE) GATT services. The Zoemini 2 uses Bluetooth Classic RFCOMM and is invisible to Web Bluetooth.
   - **Web Serial (`navigator.serial`):** Chrome on Android requires the runtime `BLUETOOTH_CONNECT` ("Nearby devices") permission and relies exclusively on already-bonded devices.
3. **Exclusive Connection Lock:**
   The Zoemini 2 hardware only accepts **one active Bluetooth connection at a time**. If your printer is connected to your Linux/PC computer, or if the official Canon Mini Print app (`com.canon.cebm.miniprint.android.us`) is running in the background on your phone, other connection attempts will fail with a socket timeout (`read ret: -1`). Ensure previous apps are closed.

#### 🌟 Solution: The Standalone Android Companion APK (`com.michaelschuldes.zoemini-ivy2-print`)

We provide a lightweight, 100% self-contained Android APK that bundles this studio with a native **Insecure RFCOMM Bluetooth bridge**:
- **Bypasses OS limitations:** Opens an insecure RFCOMM socket directly to channel 1 (`BluetoothDevice.createInsecureRfcommSocketToServiceRecord`), matching the exact connection technique used by the official Canon app.
- **In-App Device Chooser:** Displays a device selection dialog with your paired Bluetooth devices and shows a live progress spinner during connection.
- **Android Gallery Sharing:** Integrates directly with Android's system share sheet (`ACTION_SEND` and `ACTION_SEND_MULTIPLE`). Share 1 photo into the active slot, or share 2 photos at once to automatically populate both stickers in Dual Round mode!
- **100% Offline:** All web assets and PDF rendering engines are packaged directly inside the APK assets via `WebViewAssetLoader`.

You can download the APK from the [GitHub Releases](https://github.com/MichaelSchuldes/zoemini-ivy2-print/releases) page or build it using the included GitHub Actions workflow.

---

## 💻 Running Locally

Because ES Modules (`<script type="module">`) cannot be loaded over the `file://` protocol due to browser CORS policies, serve the folder over `http://localhost`:

```bash
# Using the included zero-dependency Perl HTTP server:
./serve.sh 8080
```
Or with Python / Node:
```bash
python3 -m http.server 8080
# or
npx serve .
```
Then open `http://localhost:8080` in Chrome/Chromium.

---

## 🔧 How the ZINK Hardware Pipeline Works

As documented in **[dtgreene/ivy2](https://github.com/dtgreene/ivy2)**:
1. **Non-Square Pixel Aspect Ratio (`640 × 1616`):**
   Although the physical ZINK sheet is **2 × 3 inches** (`2:3` aspect ratio), the `PV-223` thermal printhead has **640 horizontal heating elements** across the 2-inch width (~320 DPI) and steps **1616 lines** down the 3-inch length (~538.7 DPI).
2. **Two-Stage Canvas Pipeline:**
   - **Stage 1 (Physical `2:3` Composition):** Your photo, SVG, or PDF (or both circular stickers in `ZP-2030-2C` mode) is composed at true `2:3` physical geometry (`1280 × 1920`).
   - **Stage 2 (Anamorphic Hardware Output):** Immediately before printing, the clean `1280 × 1920` composition (without UI cut guides) is resampled to **`640 × 1616`**, rotated **180°** (required by the `PV-223` feed orientation), and encoded as a **Baseline DCT JPEG** (`0xFFC0`).
3. **RFCOMM Packet Framing:**
   - Handshake (`StartSession` → `GetSetting` → `GetStatus`) uses big-endian framed packets (`0x43 0x62` magic header, `0x96` trailer).
   - Print jobs send `BeginPrint (0x0202)` → `PrintReady (0x0101)` → `990-byte` JPEG chunks (`50 ms` pacing) → `PrintComplete (0x0102)`.

---

## 📁 Project Structure

```text
.
├── index.html                    # Main studio web interface
├── manifest.json                 # PWA Web App Manifest with Android share_target
├── sw.js                         # Service Worker intercepting POST /share-target
├── icons/
│   ├── icon.svg                  # Vector Material print icon
│   ├── icon-192.png              # 192x192 PWA icon
│   └── icon-512.png              # 512x512 PWA icon
├── css/
│   └── styles.css                # Responsive desktop & mobile dark-theme UI
├── js/
│   ├── main.js                   # App bootstrap, SW registration & share-target loader
│   ├── protocol/
│   │   ├── constants.js          # Protocol opcodes, UUIDs & ZINK physical constants
│   │   ├── errors.js             # Hardware status & error code decoder
│   │   ├── packets.js            # Binary 34B/36B packet builders & parsers
│   │   └── printer-client.js     # State machine, polling & print job orchestrator
│   ├── transport/
│   │   ├── web-serial.js         # Web Serial (navigator.serial) RFCOMM transport
│   │   └── mock-transport.js     # Interactive hardware simulator transport
│   ├── media/
│   │   ├── file-loader.js        # Image, high-res SVG & PDF loader + sample cards
│   │   ├── pdf-renderer.js       # PDF.js integration
│   │   ├── sticker-layout.js     # 2x3" & ZP-2030-2C dual-circle geometry engine
│   │   └── image-processor.js    # 1280x1920 -> 640x1616 (180°) baseline JPEG encoder
│   └── ui/
│       ├── preview-editor.js     # Interactive canvas pan/pinch-zoom/crop editor
│       ├── status-panel.js       # Telemetry dashboard
│       └── debug-console.js      # Live hex packet inspector
├── .github/workflows/
│   └── deploy-pages.yml          # GitHub Actions workflow for GitHub Pages (github.io)
├── serve.sh                      # Zero-dependency local HTTP server
└── PLAN.md                       # Architecture & binary protocol reference
```

---

## 🙏 Credits & Acknowledgments

- **[dtgreene/ivy2](https://github.com/dtgreene/ivy2)** — Special thanks to `@dtgreene` for reverse-engineering and documenting the Ivy 2 / Zoemini 2 (`PV-223`) Bluetooth RFCOMM protocol, packet structures, and `640 × 1616` ZINK image specifications.
- **Gemini 4** — This web application, protocol driver, interactive print studio, and hardware simulator were designed and implemented using **Gemini 4**.
