# Zoemini 2 & Ivy 2 — Bluetooth Setup & Troubleshooting Guide

This guide describes how to configure and connect your **Canon Zoemini 2** (Europe/Asia) or **Canon Ivy 2** (North America) printer on **Linux**, **Android**, **Windows**, **macOS**, and **iOS**.

---

## 1. Bluetooth Architecture Overview

The Canon Zoemini 2 and Ivy 2 printers communicate using **Bluetooth Classic 5.0 (BR/EDR)** using the **Serial Port Profile (SPP / RFCOMM)**:
- **Service UUID**: `00001101-0000-1000-8000-00805F9B34FB` (Standard Bluetooth SerialPortServiceClass_UUID)
- **RFCOMM Channel**: `1`
- **Control Packets**: Fixed 34-byte frames starting with `0x00 0x00 0x00 0x1E`
- **Print Data**: Raw JPEG stream sent in 990-byte chunks

Because the printer uses Bluetooth Classic SPP rather than Bluetooth Low Energy (BLE GATT), standard browser Web Bluetooth (`navigator.bluetooth`) cannot connect directly. Instead:
- **Desktop (Linux / Windows / macOS)**: Uses the **Web Serial API** (`navigator.serial`) via standard Chromium-based browsers (Chrome, Edge, Brave, Opera).
- **Android**: Uses the native **Zoemini Print APK** (`android/` in this repo) which bridges the native Android Bluetooth RFCOMM socket to the web app.
- **iOS**: Uses the native **Zoemini Print iOS app** (`ios/` in this repo) utilizing Apple's `ExternalAccessory.framework` MFi protocol (`jp.co.canon.cp.miniprint.pp1`).

---

## 2. Linux Setup

On Linux, Chromium browsers access Bluetooth Classic serial devices through Linux RFCOMM device nodes (`/dev/rfcomm*`).

### Step 1: Pair and Trust the Printer
1. Turn on the printer by holding the power button until the white LED turns on.
2. Open a terminal and run `bluetoothctl`:
   ```bash
   bluetoothctl
   ```
3. In the `bluetoothctl` prompt:
   ```text
   [bluetooth]# power on
   [bluetooth]# agent on
   [bluetooth]# default-agent
   [bluetooth]# scan on
   ```
4. Locate your printer in the scan results (named `Canon Mini Printer` or similar, note the MAC address like `00:11:22:33:44:55`).
5. Pair and trust the device:
   ```text
   [bluetooth]# pair 00:11:22:33:44:55
   [bluetooth]# trust 00:11:22:33:44:55
   [bluetooth]# scan off
   [bluetooth]# exit
   ```

### Step 2: Bind the RFCOMM Serial Device
Bind the printer's SPP channel (channel 1) to `/dev/rfcomm0`:
```bash
sudo rfcomm bind 0 00:11:22:33:44:55 1
```

Verify that the device node exists:
```bash
ls -l /dev/rfcomm0
```

> **Optional: Automatically bind at boot**
> You can create a systemd service or add to `/etc/bluetooth/rfcomm.conf`:
> ```ini
> rfcomm0 {
>     bind yes;
>     device 00:11:22:33:44:55;
>     channel 1;
>     comment "Canon Zoemini 2 / Ivy 2";
> }
> ```

### Step 3: Configure User Permissions
To allow your user account to access serial ports without `sudo`, add your user to the `dialout` (Debian/Ubuntu) or `uucp` (Arch/Fedora) group:
```bash
sudo usermod -a -G dialout $USER
# On Arch Linux / Manjaro:
sudo usermod -a -G uucp $USER
```
*(Log out and log back in for group changes to take effect, or run `sudo chmod 666 /dev/rfcomm0` for immediate testing).*

### Step 4: Connect in the Web App
1. Open the app in Google Chrome, Brave, Chromium, or Microsoft Edge.
2. Click the blue **Connect** button in the header.
3. In the browser device picker, select `/dev/rfcomm0`.
4. The button turns red and reads **Disconnect**. You are connected!

To release the RFCOMM port when finished:
```bash
sudo rfcomm release 0
```

---

## 3. Android Setup

### Important Note on Android System Bluetooth Settings
When you pair the Zoemini 2 / Ivy 2 in Android's standard **Settings → Bluetooth**:
- Android may show a message like *"Couldn't connect"* or *"App needed to use device"*.
- **This is expected and normal!** The printer does not expose an audio, keyboard, or standard BLE profile. It only accepts connections when an app opens an active RFCOMM socket.

### Recommended: Standalone Zoemini Print Android App
Because Google Chrome on Android disables the Web Serial API for Bluetooth Classic devices, we provide a lightweight standalone Android app:
1. **Download the APK** from the [GitHub Releases](https://github.com/MichaelSchuldes/zoemini-ivy2-print/releases) page or build it from `android/`:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```
2. Install the APK on your Android device (enable "Install unknown apps" if prompted).
3. Open **Zoemini Print**.
4. Grant the requested Bluetooth permissions:
   - Android 12+: `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`
   - Android 11 and earlier: `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION`
5. Tap **Connect**. The app will display a list of paired Bluetooth devices. Tap your printer.
6. The app opens a native RFCOMM socket and connects directly!

### Gallery & Photo Sharing on Android
The Android app registers as an Android **Send/Share target**:
1. Open **Google Photos**, **Gallery**, or any file manager.
2. Select any photo (or select 2 photos for 2× Round sticker mode).
3. Tap **Share** → **Zoemini Print**.
4. The images are imported directly into the editing canvas!

---

## 4. Windows Setup (Windows 10 & 11)

Windows has built-in support for Bluetooth SPP and assigns a virtual COM port upon pairing.

### Step 1: Pair the Printer
1. Turn on your Zoemini 2 / Ivy 2 printer.
2. In Windows, go to **Settings** → **Bluetooth & devices** → **Add device**.
3. Select **Bluetooth**.
4. Choose **Canon Mini Printer** (or the device displaying your printer's name).
5. Wait for Windows to finish pairing and setting up the device.

### Step 2: Verify the Outgoing COM Port
1. In Windows 11: Go to **Settings** → **Bluetooth & devices** → **Devices** → scroll down to **More Bluetooth settings** (or in Windows 10: **More Bluetooth options**).
2. Click the **COM Ports** tab.
3. Note the COM port number listed with Direction **Outgoing** (e.g., `COM3` or `COM4`).

### Step 3: Connect in Chrome or Edge
1. Open **Google Chrome**, **Microsoft Edge**, or **Brave**.
2. Navigate to the Zoemini Print Web Studio.
3. Click the blue **Connect** button in the header.
4. In the browser serial port prompt, select `Standard Serial over Bluetooth link (COMx)` matching the outgoing COM port.
5. Click **Connect**. The button will turn red and show **Disconnect**.

---

## 5. Apple macOS & iOS Setup

### macOS
1. Turn on the printer and pair it under **System Settings** → **Bluetooth**.
2. Open Google Chrome, Brave, or Microsoft Edge on macOS.
3. Click **Connect** and select the paired Bluetooth serial device in the Web Serial prompt.

### iOS & iPadOS
Because Apple's Mobile Safari does not support Web Serial or Bluetooth SPP:
1. Pair your printer in **Settings** → **Bluetooth**.
2. Use the native Swift iOS app in the `ios/` folder of this repository:
   - Uses Apple's `ExternalAccessory.framework` MFi protocol: `jp.co.canon.cp.miniprint.pp1`.
   - Also supports CoreBluetooth discovery.
   - Provides full native bridging to the Web Studio interface.

---

## 6. Printer Operations & Best Practices

| Feature | Behavior & Requirement |
| :--- | :--- |
| **Keep-Alive Heartbeat** | The web app automatically sends a status ping every 24 seconds to keep the Bluetooth connection alive and prevent the printer's 3-minute sleep timer from disconnecting. |
| **Battery Safety Threshold** | Printing is automatically disabled if the battery level is **below 10%** (`PRINT_BATTERY_MIN`). Charge the printer via USB-C before printing. |
| **SmartSheet Calibration** | Each 10-pack of ZINK paper comes with a blue SmartSheet barcode card. Always load the blue card facing **barcode down** at the bottom of the stack. |
| **Top Cover Sensor** | If the top cover is opened, the app detects cover-open status and prompts you to verify paper format (2×3" Full Sheet vs 2× Round Cutouts) upon closing. |
| **Paper Formats** | • **ZP-2030**: 2×3" Full Sheet photo paper (50×76 mm, 640×1616 target payload)<br>• **ZP-2030-2C**: 2× Round Cutout sticker paper (two Ø 33 mm circle stickers) |

---

## 7. Troubleshooting Guide

### Connection Fails or Device Not Found
- Ensure the printer is powered on (LED is solid white, not off or charging amber).
- If the printer is paired to another phone or computer nearby, turn off Bluetooth on that device. The Zoemini 2 accepts only one active RFCOMM link at a time.
- Power cycle the printer: Hold the power button for 3 seconds to shut down, then power it back on.

### Linux: `Device or resource busy` or `Permission denied`
- Verify user group permissions: `groups $USER` must include `dialout` or `uucp`.
- If an existing process has `/dev/rfcomm0` locked:
  ```bash
  sudo fuser -k /dev/rfcomm0
  sudo rfcomm release 0
  sudo rfcomm bind 0 <MAC_ADDRESS> 1
  ```

### Windows: Serial Port Fails to Open
- **Device Must Be "Paired", NOT "Connected" in Windows Settings**: The Zoemini only accepts one RFCOMM connection at a time. If Windows Bluetooth settings currently shows the printer as **Connected**, Windows has already claimed the link or COM port. Disconnect it in Windows Settings (leave it **Paired**), and let the browser initiate the connection when you click **Connect**.
- **Selecting the Correct Port in the Browser Prompt**: If Chrome shows both a Bluetooth device and virtual COM ports, select either the printer with the Serial Port Profile UUID (`00001101-0000-1000-8000-00805f9b34fb`) or the assigned outgoing COM port (`Standard Serial over Bluetooth link (COMx)`).
- Check Windows Device Manager under **Ports (COM & LPT)** to ensure the driver is active and not showing an error triangle.
- In Chrome, ensure no other browser tab is currently holding the COM port open.

### Print Job Halts Mid-Transfer
- The app streams print data in 990-byte chunks with an inter-packet delay. Ensure the printer remains within 2–3 meters of your Bluetooth adapter.
- If the connection drops during transmission, the printer will discard partial packets and reboot cleanly without damaging the paper mechanism.
