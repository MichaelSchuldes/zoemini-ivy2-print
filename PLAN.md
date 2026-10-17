# Zoemini 2 / Ivy 2 Web Print Client — Development Plan (`PLAN.md`)

## 1. Project Overview & Goals

Build a **100% static, client-side web application** that enables printing photos (JPEG, PNG, WebP, GIF, etc.) and documents (multi-page PDFs) directly from a Chromium-based browser to a **Zoemini 2 (PV-223) / Ivy 2** pocket photo printer over Bluetooth Classic (RFCOMM / Serial Port Profile).

The application supports both official ZINK media formats:
1. **Standard 2×3" Full-Sheet ZINK Paper (`ZP-2030`)**: Prints a single photo or PDF page across the entire `50 × 76 mm` (`2" × 3"`) sheet.
2. **Pre-Cut Dual Round Sticker Paper (`ZP-2030-2C`)**: Features **two circular `33 mm` (`1.3"`) die-cut stickers** on a single `2" × 3"` sheet, allowing the user to assign **two separate images/PDF pages** (or duplicate one image to both cutouts) in a single print job.

### Core Constraints & Architecture Principles
- **Zero Backend / Fully Static:** Hosted as static HTML/CSS/JS assets (compatible with GitHub Pages, Cloudflare Pages, Netlify, or local `http://localhost`).
- **100% Client-Side Execution:** All file parsing, PDF rasterization, image cropping/scaling, dual-circle sticker composition, JPEG encoding, and binary Bluetooth packet framing happen directly inside the browser.
- **No Heavy Wasm Runtime Required:** Instead of shipping a 15–20 MB Pyodide + Pillow WebAssembly bundle, port the `dtgreene/ivy2` protocol logic directly to native JavaScript/TypeScript (`ArrayBuffer` / `DataView`), HTML5 `<canvas>`, and the **Web Serial API** (`navigator.serial`).

---

## 2. Technical Architecture

```
+-----------------------------------------------------------------------+
|                        Static Browser Web App                         |
|                                                                       |
|  +------------------+    +--------------------+    +---------------+  |
|  | File Input Layer | -> | Canvas Prep Engine | -> | Protocol Task |  |
|  | - Slot 1 (Full   |    | - Single 2x3" OR   |    | Framing       |  |
|  |   or Top Circle) |    |   Dual Round 1.3"  |    | (ArrayBuffer/ |  |
|  | - Slot 2 (Bottom |    | - 1280x1920 Preview|    |  DataView)    |  |
|  |   Circle Cutout) |    | - 640x1616 + 180°  |    +-------+-------+  |
|  | - Images & PDFs  |    |   ZINK Output JPEG |            |          |
|  +------------------+    +--------------------+            |          |
|                                                            v          |
|                                              +---------------------+  |
|                                              | Web Serial RFCOMM   |  |
|                                              | Buffered Transport  |  |
|                                              | (navigator.serial)  |  |
|                                              +----------+----------+  |
+---------------------------------------------------------|-------------+
                                                          | Bluetooth SPP
                                                          | (0x1101, Ch 1)
                                                          v
                                            +---------------------------+
                                            | Zoemini 2 / Ivy 2   |
                                            | (Model PV-223)            |
                                            +---------------------------+
```

### Why Web Serial API instead of Web Bluetooth API?
- The **Web Bluetooth API** (`navigator.bluetooth`) only supports Bluetooth Low Energy (BLE GATT).
- The Zoemini 2 uses **Bluetooth Classic RFCOMM** (Serial Port Profile UUID `00001101-0000-1000-8000-00805f9b34fb`, Channel 1).
- Chromium browsers (Chrome, Edge, Brave, Opera on Desktop & Android) expose paired Bluetooth Classic SPP devices via the **Web Serial API** (`navigator.serial.requestPort` with `allowedBluetoothServiceClassIds`).

---

## 3. Verified Zoemini 2 (`ivy2`) Binary Protocol Specification

Based on the discussion and the reference `dtgreene/ivy2` implementation (`task.py`, `ivy2.py`, `utils.py`, `client.py`, `image.py`), the binary protocol operates as follows:

### 3.1 Transport Constants
| Parameter | Value | Notes |
| :--- | :--- | :--- |
| **SPP UUID** | `00001101-0000-1000-8000-00805f9b34fb` | Standard Bluetooth Serial Port Profile (`0x1101`) |
| **Control Packet Size** | `34` bytes | Fixed length for all outbound commands and inbound ACK/status frames |
| **Start Code (Magic)** | `0x430F` (`17167`) | 16-bit Big-Endian unsigned integer at bytes `0..1` |
| **Image Chunk Size** | `990` bytes | Max JPEG slice sent per write operation during print transfer |
| **Inter-Packet Delay** | `20` ms | Recommended delay between writes (`client.py` uses `time.sleep(0.02)`) |
| **Inactivity Timeout** | `30` seconds | Printer/session auto-disconnects after 30s of inactivity |
| **Min Battery Level** | `30%` | Print jobs are rejected below 30% battery |

### 3.2 Outbound Control Packet Structure (34 Bytes)
Every outbound 34-byte packet is initialized with `get_base_message(command, flag1, flag2)` equivalent to Python's `struct.pack_into(">HhbHB", buf, 0, 17167, b1, b2, command, flag2 ? 1 : 0)`:

| Byte Offset | Type (Big-Endian) | Value / Description |
| :--- | :--- | :--- |
| `0..1` | `uint16` | `0x430F` (`17167`) — Start code |
| `2..3` | `int16` | `-1` (`0xFFFF`) if `flag1 === true` (Start Session only), else `1` (`0x0001`) |
| `4` | `int8` | `-1` (`0xFF`) if `flag1 === true` (Start Session only), else `32` (`0x20`) |
| `5..6` | `uint16` | Command ID (`0x0000`, `0x0101`, `0x0103`, `0x0301`, `0xFFFF`) |
| `7` | `uint8` | `1` if `flag2 === true` (write/setter task), else `0` (read/getter task) |
| `8..33` | `uint8[26]` | Command-specific payload (zero-filled by default) |

### 3.3 Supported Commands & Payloads

1. **Start Session (`COMMAND_START_SESSION = 0x0000` / `0`)**
   - **Outbound:** `flag1 = true`, `flag2 = false` (Bytes `2..4` are `0xFF 0xFF 0xFF`).
   - **Inbound Response (34 bytes):**
     - `batteryLevel = ((data[9] << 8) | data[10]) & 0x3F` (lower 6 bits)
     - `mtu = ((data[11] & 0xFF) << 8) | (data[12] & 0xFF)`

2. **Get Status (`COMMAND_GET_STATUS = 0x0101` / `257`)**
   - **Outbound:** `flag1 = false`, `flag2 = false`.
   - **Inbound Response (`payload = data.subarray(8)`):**
     - `rawStatus = (payload[0] << 8) | payload[1]`
     - `errorCode = payload[2]`
     - `batteryLevel = rawStatus & 0x3F`
     - `usbStatus = (rawStatus >> 7) & 1`
     - `queueFlags = ((payload[4] & 0xFF) << 8) | (payload[5] & 0xFF)`
     - `isCoverOpen = (queueFlags & 1) === 1`
     - `isNoPaper = (queueFlags & 2) === 2`
     - `isWrongSmartSheet = (queueFlags & 16) === 16`

3. **Get Settings (`COMMAND_SETTING_ACCESSORY = 0x0103` / `259`)**
   - **Outbound:** `flag1 = false`, `flag2 = false`.
   - **Inbound Response (`payload = data.subarray(8)`):**
     - `autoPowerOff = payload[0]` (minutes: `3`, `5`, or `10`)
     - `firmwareVersion = "${payload[1]}.${payload[2]}.${payload[3]}"`
     - `tmdVersion = payload[5]`
     - `photosPrinted = (payload[6] << 8) | payload[7]`
     - `colorId = payload[8]`

4. **Set Settings (`COMMAND_SETTING_ACCESSORY = 0x0103` / `259`)**
   - **Outbound:** `flag1 = false`, `flag2 = true`, `data[8] = autoPowerOff` (`3`, `5`, or `10`).

5. **Print Ready (`COMMAND_PRINT_READY = 0x0301` / `769`)**
   - **Outbound:** `flag1 = false`, `flag2 = false`.
     - Bytes `8..11` (`uint32` BE): `jpegByteLength`
     - Byte `12` (`uint8`): `1`
     - Byte `13` (`uint8`): `1` (or `2` if optional flag set)
   - **Inbound Response (`payload = data.subarray(8)`):**
     - `unknown = payload[2] & 0xFF`
     - `errorCode = payload[3] & 0xFF`

6. **Reboot (`COMMAND_REBOOT = 0xFFFF` / `65535`)**
   - **Outbound:** `flag1 = false`, `flag2 = true`, `data[8] = 1`.

### 3.4 Inbound Response Header Validation
For every 34-byte response received from the printer:
- `ack = ((data[5] & 0xFF) << 8) | (data[6] & 0xFF)` (must match the sent command's expected ACK code)
- `headerError = data[7] & 0xFF`
- `payload = data.subarray(8, 34)`

### 3.5 Complete Print Handshake Sequence
1. Ensure active session (connected + `StartSession` completed).
2. Send `GetStatus` (`0x0101`) and validate print worthiness:
   - `errorCode === 0`
   - `batteryLevel >= 30`
   - `!isCoverOpen && !isNoPaper && !isWrongSmartSheet`
3. Send `GetSetting` (`0x0103`) and await ACK.
4. Send `GetPrintReady(jpegBytes.length)` (`0x0301`) and await ACK.
5. Stream `jpegBytes` in slices of at most `990` bytes with a `~20ms` delay between chunks, updating UI progress (`0%` → `100%`).
6. Await final 34-byte completion message from the printer (with a 60-second transfer timeout).

---

## 4. Image, PDF & Dual Round Sticker Processing Pipeline

### 4.1 Multi-Format File Ingestion
- **Standard Images (`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/bmp`, `image/svg+xml`):**
  - Loaded client-side via `URL.createObjectURL(file)` into an `HTMLImageElement` or `createImageBitmap(file)`.
- **PDF Documents (`application/pdf`):**
  - Parsed client-side using **Mozilla PDF.js** (`pdf.min.mjs` + `pdf.worker.min.mjs` loaded via ES module CDN or bundled locally).
  - Supports multi-page navigation (`1..pdf.numPages`) and high-DPI rasterization (`scale: 3.0`, ~200–300 DPI) onto an offscreen `<canvas>`.

### 4.2 Unified Interactive Transform & Crop Engine (Both Paper Modes)

Every media slot—whether the **Full 2×3" Sheet (`Slot 1`)** or each of the **Dual Round Stickers (`Slot 1` & `Slot 2`)**—uses a unified `SlotTransformState` so regular images and PDFs have full interactive **Zoom, Rotation, Pan, and Aspect-Ratio Crop** capabilities:

| Property | Range / Options | Description |
| :--- | :--- | :--- |
| `scaleMode` | `'crop'` (Fill) \| `'contain'` (Fit) | `'crop'` fills the target `2:3` frame (or circular sticker) edge-to-edge; `'contain'` fits the entire image/PDF inside with `#FFFFFF` margins. |
| `zoom` | `0.25x` – `5.0x` (default `1.0x`) | Continuous zoom multiplier controlled via mouse wheel, touch pinch-to-zoom, or precision UI slider. |
| `panX`, `panY` | Pixels in canvas space | Interactive drag-to-reposition (`PointerEvents`) to frame any region of the zoomed/cropped image, plus a **"Center / Reset Crop"** button. |
| `rotation90` | `0°`, `90°`, `180°`, `270°` + Auto-Orient | Quick 90° step rotation buttons, horizontal/vertical flip (`flipX`, `flipY`), and optional **Auto-Rotate Landscape to Portrait** toggle. |
| `fineRotation` | `-45°` to `+45°` (0.5° steps) | Free-angle straightening slider for horizon/document alignment. |
| `cropBox` / Guides | Rule-of-thirds & Safe Print Margin | On-screen interactive crop overlay showing rule-of-thirds gridlines and outer ZINK edge-bleed safety zone (`~1.5 mm`) during drag/zoom/rotate operations. |

#### Layout A: Standard 2×3" Full Sheet (`50 mm × 76 mm` / `ZP-2030`)
- Uses `Slot 1` rendered across the full `1280 × 1920` (`2:3` aspect ratio) physical preview canvas.
- **Interactive 2:3 Crop & Framing:**
  - Users can drag directly on the `2×3"` canvas to pan the image, scroll/pinch or use the slider to **zoom in/out**, rotate (`90°` steps or fine `-45°..+45°` angle), flip horizontally/vertically, or switch between **2:3 Aspect-Ratio Crop (Fill)** and **Fit Entire Image (Letterbox/Pillarbox)**.
  - Displays an optional **Rule-of-Thirds Crop Grid** and **Edge Bleed Safe Zone** overlay while dragging/zooming (excluded from final print output).

#### Layout B: Pre-Cut Dual Round Sticker Sheet (`ZP-2030-2C`)
pre-cut circle sticker paper (`ZP-2030-2C`) has the same `50 mm × 76 mm` (`2" × 3"`) outer backing sheet, with **two circular `33 mm` (`1.3"`) die-cut stickers** arranged vertically along the center axis:

```
+---------------------------+  Y = 0 px (0 mm)
|                           |
|       . - ~ ~ ~ - .       |
|   . '               ' .   |
|  /     STICKER #1      \  |  Top Circle Center:
| |      (Top Slot)       | |  X = 640 px (25.0 mm)
| |     Ø 33mm (845px)    | |  Y = 480 px (18.75 mm) + offset
|  \       + bleed       /  |
|   .                 . '   |
|     ' - . _ _ . - '       |
| - - - - - - - - - - - - - |  Y = 960 px (38 mm midpoint)
|       . - ~ ~ ~ - .       |
|   . '               ' .   |
|  /     STICKER #2      \  |  Bottom Circle Center:
| |     (Bottom Slot)     | |  X = 640 px (25.0 mm)
| |     Ø 33mm (845px)    | |  Y = 1440 px (57.25 mm) + offset
|  \       + bleed       /  |
|   .                 . '   |
|     ' - . _ _ . - '       |
|                           |
+---------------------------+  Y = 1920 px (76 mm)
  X=0                   X=1280 (50 mm)
```

- **Physical-to-Pixel Mapping on the `1280 × 1920` Canvas (`25.6 px/mm`):**
  - **Sheet Width:** `50 mm` = `1280 px`
  - **Sheet Height:** `76 mm` = `1920 px` (`25.26 px/mm` vertical)
  - **Nominal Cutout Diameter:** `33 mm` ≈ `845 px` (Radius `R_cut = 422.5 px`)
  - **Print Bleed Radius (`R_print`):** `R_cut + bleedPx` (default `+2.0 mm` / `+51 px` bleed, i.e., `R_print ≈ 474 px`, configurable from `0 mm` to `+4 mm`). Printing slightly outside the `33 mm` die-cut circle ensures edge-to-edge graphics with no unprinted white slivers if mechanical paper feed shifts by `±1 mm`.
  - **Default Centers:**
    - **Top Sticker (`Slot 1`):** `(cx1 = 640, cy1 = 480 + topOffsetY)`
    - **Bottom Sticker (`Slot 2`):** `(cx2 = 640, cy2 = 1440 + bottomOffsetY)`
- **Dual-Slot Assignment & Controls:**
  - Users can assign **two independent files** (e.g., two different photos, two different PDFs, or two different pages of the same PDF) to **Slot 1 (Top Circle)** and **Slot 2 (Bottom Circle)**.
  - Quick actions: **"Copy Top → Bottom"** (print 2 identical round stickers on one sheet), **"Swap Top ⇅ Bottom"**, and per-slot **"Clear"**.
  - Each slot uses the full `SlotTransformState` (`scaleMode`, interactive `panX`/`panY`, `zoom`, `rotation90`, `fineRotation`, `flipX`/`flipY`, `pdfPageNumber`, and image filter adjustments).
  - **UI Cut-Line Overlay vs. Printed Output:**
    - When rendering for the **UI Preview**, draw a dashed circular guide ring at `R_cut` (`33 mm`) and dim the non-sticker backing area outside `R_cut` so the user sees exactly where the physical peel-off edge is.
    - When rendering for **Printer Output**, omit the dashed UI guide lines and clip each slot's drawing region using `ctx.arc(cx, cy, R_print, 0, Math.PI * 2)` so the bleed zone prints cleanly onto the waste margin.

### 4.3 Two-Stage ZINK Resolution & Aspect Ratio Pipeline
The Zoemini 2 prints on **2×3 inch** ZINK paper (`2:3` physical aspect ratio), but the ZINK feed mechanism uses non-square vertical step timing requiring a **640 × 1616** image rotated **180°**.

1. **Stage 1 — Physical Composition Canvas (`1280 × 1920`, 2:3 Aspect Ratio):**
   - Fill base canvas with `#FFFFFF` (white).
   - Render either the **Full-Sheet single slot** (with its 2:3 crop, pan, zoom, and rotation transforms) or the **Dual Round Sticker slots (Slot 1 + Slot 2 with circular bleed masks)** onto the `1280 × 1920` canvas.
   - Display this `1280 × 1920` canvas (plus optional non-printed UI crop grid / circular cut-line overlays) directly in the workspace so proportions are 100% true-to-life.

2. **Stage 2 — ZINK Hardware Output Canvas (`640 × 1616`, Rotated `180°`):**
   - Create an offscreen `640 × 1616` `<canvas>`.
   - Translate to `(640, 1616)` and rotate by `Math.PI` (`180°`), then draw the clean `1280 × 1920` composition canvas (without UI guide overlays) stretched onto `(0, 0, 640, 1616)` with `imageSmoothingQuality = "high"`.
   - Encode via `canvas.toBlob(resolve, "image/jpeg", quality)` (default quality `0.95`–`1.0`), producing a standard **baseline JPEG**, and convert to `Uint8Array`.

---

## 5. Proposed Project Directory Structure

No build step is strictly required if using native ES Modules, though Vite can optionally be used for local dev/bundling. Designing with clean native ES Modules ensures the site works immediately from any static file server:

```text
zoeminiweb/
├── index.html                  # Main application shell & responsive UI
├── css/
│   └── styles.css              # Modern, responsive layout, print preview & dark/light theme
├── js/
│   ├── main.js                 # App bootstrap, UI state bindings, event listeners
│   ├── transport/
│   │   ├── web-serial.js       # ZoeminiSerialTransport (Web Serial API + exact-byte ring buffer)
│   │   └── mock-transport.js   # Simulated Zoemini 2 responder for UI testing without hardware
│   ├── protocol/
│   │   ├── constants.js        # Command IDs, ACK codes, packet sizes, bitmasks
│   │   ├── packets.js          # DataView builders & parsers for all 34-byte messages
│   │   ├── errors.js           # Custom error classes (LowBatteryError, CoverOpenError, etc.)
│   │   └── printer-client.js   # High-level ZoeminiPrinter class (handshake, status, print, keep-alive)
│   ├── media/
│   │   ├── file-loader.js      # Unified dispatcher for Image blobs and PDF documents
│   │   ├── pdf-renderer.js     # PDF.js integration, page count, and high-DPI page rasterization
│   │   ├── image-processor.js  # Two-stage canvas pipeline (1280x1920 composition -> 640x1616 rotated JPEG)
│   │   └── sticker-layout.js   # Full-sheet & Dual 33mm circle geometry, crop/pan/zoom/rotate transforms
│   └── ui/
│       ├── status-panel.js     # Battery gauge, firmware info, cover/paper indicators, settings
│       ├── preview-editor.js   # Interactive 2x3" & Dual-Circle crop/zoom/rotate editor, PDF page controls
│       └── debug-console.js    # Hex packet inspector & protocol log viewer
└── PLAN.md                     # This development plan
```

---

## 6. Phased Implementation Plan

### Phase 1: Transport & Binary Protocol Engine (`js/transport/`, `js/protocol/`)
1. **Implement `ZoeminiSerialTransport` (`js/transport/web-serial.js`):**
   - Check browser support (`"serial" in navigator`) and secure context (`window.isSecureContext`).
   - Request port with Bluetooth SPP UUID `00001101-0000-1000-8000-00805f9b34fb`.
   - Open port at `baudRate: 115200` and attach reader/writer streams.
   - Implement an asynchronous `readExact(byteCount, timeoutMs)` byte queue that accumulates incoming `Uint8Array` chunks from `reader.read()` until at least `byteCount` (34) bytes are available.
   - Emit raw TX/RX byte events for the hex debug console.
2. **Implement Packet Builders & Parsers (`js/protocol/packets.js`):**
   - Port `get_base_message` and all 6 tasks (`StartSession`, `GetStatus`, `GetSetting`, `SetSetting`, `GetPrintReady`, `Reboot`) using `ArrayBuffer(34)` and `DataView`.
   - Port `parse_incoming_message` and task-specific response decoders with bitmask extraction (`battery_level`, `mtu`, `is_cover_open`, `is_no_paper`, `is_wrong_smart_sheet`, `firmware_version`, `number_of_photos_printed`).
3. **Implement `ZoeminiPrinter` Controller (`js/protocol/printer-client.js`):**
   - Manage connection lifecycle and automatic 25-second keep-alive status polling (preventing the printer's 30-second idle disconnect timer while the user edits an image).
   - Serialize command execution via a promise mutex so status polls never collide with an active print handshake.
   - Implement `print(jpegBytes, onProgress)` executing the full sequence (`getStatus` -> `getSetting` -> `getPrintReady` -> 990-byte chunk loop with 20ms pacing -> completion wait).
4. **Implement `MockZoeminiTransport` (`js/transport/mock-transport.js`):**
   - Provide a toggleable "Demo / Simulator Mode" that emulates 34-byte printer ACKs, battery/paper status, and chunk transfer progress so the entire UI and protocol framing can be tested without wasting ZINK paper.

### Phase 2: Multi-Format Media, Interactive Crop/Zoom/Rotate & ZINK Pipeline (`js/media/`)
1. **Image & PDF Loader (`js/media/file-loader.js`, `js/media/pdf-renderer.js`):**
   - Integrate Mozilla `pdf.js` (`v4.x` via CDN ES module).
   - Support drag-and-drop, file picker (`accept="image/*,application/pdf"`), and clipboard paste (`Ctrl+V`) targeting either the active full-sheet slot or specific Top/Bottom circle slots.
   - Expose PDF metadata (`numPages`, current page) and render the selected PDF page at `3.0x` scale to an offscreen canvas.
2. **Unified Transform & Layout Engine (`js/media/sticker-layout.js`):**
   - Implement `SlotTransformState` supporting both **Standard 2×3" Full-Sheet** and **Dual Round Sticker (`ZP-2030-2C`)** modes:
     - **Zoom (`0.25x`–`5.0x`)**, **Pan (`panX`, `panY`)**, **Rotation (`0°/90°/180°/270°` + fine `-45°..+45°` straightening)**, **Flip (`flipX`/`flipY`)**, and **Crop Mode (`crop` fill vs. `contain` fit)**.
   - Define geometry for `ZP-2030-2C` (`33 mm` / `845 px` diameter cutouts at `(640, 480)` and `(640, 1440)` on the `1280 × 1920` canvas) with configurable **Bleed Margin** (`0 mm` to `+4 mm`, default `+2 mm`) and **Fine Alignment Offsets** (`topOffsetY`, `bottomOffsetY`, `offsetX` in `mm`, persisted in `localStorage`).
3. **Two-Stage Canvas Processor (`js/media/image-processor.js`):**
   - Render the interactive **1280 × 1920** composition canvas for both **Full Sheet** and **Dual Round Sticker** modes.
   - Provide a non-printed UI overlay layer showing:
     - In **Full-Sheet Mode:** Rule-of-thirds crop grid and `1.5 mm` print-margin safety border during pan/zoom/rotate interactions.
     - In **Dual Round Sticker Mode:** Dashed `33 mm` circular cut lines, dimmed backing margin, and active slot highlight ring.
   - Generate the final **640 × 1616 (180° rotated)** baseline JPEG `Uint8Array` and report exact payload size in KB.

### Phase 3: User Interface & Diagnostic Console (`index.html`, `css/`, `js/ui/`)
1. **Browser Compatibility & Pairing Guide Banner:**
   - Detect if `navigator.serial` is unavailable (e.g., Firefox/Safari or insecure HTTP) and show clear instructions (use Chrome/Edge on Desktop or Android over HTTPS/`localhost`, pair Zoemini 2 in OS Bluetooth settings first).
2. **Printer Connection & Telemetry Dashboard:**
   - Connect / Disconnect button + Demo Simulator toggle.
   - Live telemetry badges: Battery percentage (with `<30%` warning), Cover status, Paper status, Smart Sheet status, Firmware version, Print counter, and Auto Power-Off selector (`3m`, `5m`, `10m`) + Reboot action.
3. **Paper Mode & Interactive Crop/Zoom/Rotate Workspace (`js/ui/preview-editor.js`):**
   - **Paper Type Selector:** Toggle between **Full 2×3" Sheet (`ZP-2030`)** and **Dual Round Stickers (`ZP-2030-2C`)**.
   - **Interactive Canvas Manipulation (Both Modes):**
     - Pointer drag (`mousedown`/`touchstart` + `mousemove`) to pan the image inside the `2:3` frame or active circular cutout.
     - Mouse wheel / pinch gesture + UI **Zoom Slider (`25%` – `500%`)** for precise cropping.
     - **Rotation & Aspect Toolbar:** `Rotate 90° CCW`, `Rotate 90° CW`, `Auto-Rotate Landscape`, `Fine Angle Slider (-45° to +45°)`, `Flip H/V`, `Crop (Fill 2:3)` vs. `Fit (Contain)`, and `Reset Crop/Transform`.
   - **Dual-Slot Controls (in Round Sticker Mode):**
     - Dedicated **Top Circle (Sticker #1)** and **Bottom Circle (Sticker #2)** upload/drop cards + **"Duplicate Top to Bottom"** and **"Swap Slots"** buttons.
     - Clicking either circle on the preview canvas selects that slot for interactive pan/zoom/rotate/crop and PDF page selection.
     - Collapsible **Cutout Calibration & Bleed** popover (`Bleed mm`, `Center X/Y offset mm`) so users can dial in exact die-cut registration.
   - Print button with real-time progress bar (`Handshaking` -> `Sending chunk X/Y (Z%)` -> `Printing`).
4. **Collapsible Protocol Hex Logger:**
   - Real-time log of sent/received 34-byte control frames in hex + decoded human-readable fields, plus ability to export logs for troubleshooting regional Zoemini 2 firmware nuances.

---

## 7. Verification & Testing Strategy

1. **Unit / Protocol Framing Verification (Simulator Mode):**
   - Verify generated 34-byte packets byte-for-byte against `dtgreene/ivy2`:
     - `StartSession`: `43 0f ff ff ff 00 00 00 ...`
     - `GetStatus`: `43 0f 00 01 20 01 01 00 ...`
     - `GetSetting`: `43 0f 00 01 20 01 03 00 ...`
     - `SetSetting(5)`: `43 0f 00 01 20 01 03 01 05 ...`
     - `GetPrintReady(len)`: `43 0f 00 01 20 03 01 00 <len:4B> 01 01 ...`
2. **Media, Interactive Crop/Zoom/Rotate & Dual Round Sticker Verification:**
   - Test portrait and landscape JPEGs, transparent PNGs (ensuring transparent pixels render as `#FFFFFF` white rather than black), WebP images, and multi-page PDFs.
   - In **Standard 2×3" Full-Sheet (`ZP-2030`)** mode:
     - Verify interactive zoom (`0.25x`–`5.0x`), drag-to-pan cropping, `90°` step rotation, fine angle straightening (`-45°..+45°`), and `crop` (Fill 2:3) vs. `contain` (Fit) modes accurately reflect in both the `1280 × 1920` preview and the `640 × 1616` rotated printer output.
   - In **Dual Round Sticker (`ZP-2030-2C`)** mode:
     - Verify assigning two distinct images (e.g., Image A to Top Circle, Image B or PDF Page 2 to Bottom Circle) renders both circular masks cleanly at `(640, 480)` and `(640, 1440)` on the `1280 × 1920` canvas with independent pan/zoom/rotation per circle.
     - Verify crop grids and dashed cut-line overlays appear only on the on-screen preview and are excluded from the exported `640 × 1616` JPEG sent to the printer.
   - Verify output JPEG starts with `FF D8` (SOI), ends with `FF D9` (EOI), has dimensions `640 × 1616`, and is rotated 180°.
3. **Hardware End-to-End Test (Zoemini 2):**
   - Pair Zoemini 2 with host OS (`bluetoothctl` on Linux or OS Bluetooth settings on Windows/macOS/Android).
   - Connect via Web Serial chooser (`00001101-0000-1000-8000-00805f9b34fb`).
   - Verify battery, firmware, and paper status readouts before executing test prints on both standard `2×3"` paper and `ZP-2030-2C` dual round cutout sticker paper.
