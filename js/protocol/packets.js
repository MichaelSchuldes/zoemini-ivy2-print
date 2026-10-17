/**
 * Binary Packet Framing & Parsing for Zoemini 2 / Ivy 2
 * Exact 1:1 port of dtgreene/ivy2 task.py and utils.py using ArrayBuffer & DataView.
 */

import {
  START_CODE,
  CONTROL_PACKET_SIZE,
  COMMAND_START_SESSION,
  COMMAND_GET_STATUS,
  COMMAND_SETTING_ACCESSORY,
  COMMAND_PRINT_READY,
  COMMAND_REBOOT,
  COMMAND_NAMES,
  PAPER_MODE_FULL,
  PAPER_MODE_DUAL_ROUND,
} from "./constants.js";

/**
 * Equivalent to utils.parse_bit_range(input, size) in dtgreene/ivy2.
 * Extracts the lowest `size` bits from `input`.
 */
export function parseBitRange(input, size) {
  const mask = (1 << size) - 1;
  return input & mask;
}

/**
 * Equivalent to get_base_message(command, flag_1=False, flag_2=False) in task.py:
 * struct.pack_into(">HhbHB", byte_array, 0, START_CODE, b1, b2, command, 1 if flag_2 else 0)
 *
 * Byte layout:
 * - 0..1: uint16 BE = START_CODE (0x430F / 17167)
 * - 2..3: int16 BE  = -1 (0xFFFF) if flag1 else 1 (0x0001)
 * - 4:    int8      = -1 (0xFF)   if flag1 else 32 (0x20)
 * - 5..6: uint16 BE = command
 * - 7:    uint8     = 1 if flag2 else 0
 * - 8..33: 26 bytes command payload (zero-initialized)
 */
export function getBaseMessage(command, flag1 = false, flag2 = false) {
  const buffer = new ArrayBuffer(CONTROL_PACKET_SIZE);
  const view = new DataView(buffer);

  const b1 = flag1 ? -1 : 1;
  const b2 = flag1 ? -1 : 32;

  view.setUint16(0, START_CODE, false);
  view.setInt16(2, b1, false);
  view.setInt8(4, b2);
  view.setUint16(5, command, false);
  view.setUint8(7, flag2 ? 1 : 0);

  return { buffer, view, bytes: new Uint8Array(buffer) };
}

/**
 * Builds StartSessionTask (0x0000) outbound 34-byte message.
 */
export function buildStartSessionPacket() {
  return getBaseMessage(COMMAND_START_SESSION, true, false).bytes;
}

/**
 * Builds GetStatusTask (0x0101) outbound 34-byte message.
 */
export function buildGetStatusPacket() {
  return getBaseMessage(COMMAND_GET_STATUS, false, false).bytes;
}

/**
 * Builds GetSettingTask (0x0103) outbound 34-byte message.
 */
export function buildGetSettingPacket() {
  return getBaseMessage(COMMAND_SETTING_ACCESSORY, false, false).bytes;
}

/**
 * Builds SetSettingTask (0x0103, flag2=true) outbound 34-byte message.
 * @param {number} autoPowerOffMinutes - 3, 5, or 10
 */
export function buildSetSettingPacket(autoPowerOffMinutes) {
  const { view, bytes } = getBaseMessage(COMMAND_SETTING_ACCESSORY, false, true);
  view.setUint8(8, autoPowerOffMinutes & 0xff);
  return bytes;
}

/**
 * Builds GetPrintReadyTask (0x0301) outbound 34-byte message.
 * Packs >BBBBBB at offset 8: 4-byte BE image length, 1, 1 (or 2 if flag).
 * @param {number} imageByteLength
 * @param {boolean} flag
 */
export function buildGetPrintReadyPacket(imageByteLength, flag = false) {
  const { view, bytes } = getBaseMessage(COMMAND_PRINT_READY, false, false);
  view.setUint32(8, imageByteLength >>> 0, false);
  view.setUint8(12, 1);
  view.setUint8(13, flag ? 2 : 1);
  return bytes;
}

/**
 * Builds RebootTask (0xFFFF, flag2=true) outbound 34-byte message.
 */
export function buildRebootPacket() {
  const { view, bytes } = getBaseMessage(COMMAND_REBOOT, false, true);
  view.setUint8(8, 1);
  return bytes;
}

/**
 * General parser for all 34/36-byte messages arriving from the printer.
 * Equivalent to utils.parse_incoming_message(data).
 */
export function parseIncomingMessage(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 8) {
    throw new Error(`Invalid incoming packet length: ${data ? data.byteLength : 0}`);
  }
  const startCode = ((data[0] & 0xff) << 8) | (data[1] & 0xff);
  const ack = ((data[5] & 0xff) << 8) | (data[6] & 0xff);
  const error = data[7] & 0xff;
  const payload = data.subarray(8);

  return {
    data,
    payload,
    startCode,
    ack,
    error,
  };
}

/**
 * Decodes StartSessionTask response:
 * battery_level = parse_bit_range((data[9] << 8) | (data[10]), 6)
 * mtu = (((data[11] & 255) << 8) | (data[12] & 255))
 */
export function parseStartSessionResponse(parsedMsg) {
  const { data } = parsedMsg;
  const rawBattery = ((data[9] & 0xff) << 8) | (data[10] & 0xff);
  const batteryLevel = parseBitRange(rawBattery, 6);
  const mtu = ((data[11] & 0xff) << 8) | (data[12] & 0xff);

  return { batteryLevel, mtu };
}

/**
 * Decodes GetStatusTask (0x0101) response:
 * Live Zoemini 2 (PV-223, FW 1.4.7) with ZP-2030-2C (2x Round Cutouts) loaded:
 *   payload = 46 2f 00 00 00 02 00 ...
 *   - payload[0..1] = 0x462f -> batteryLevel = 47, usbStatus = 0
 *   - payload[2]    = 0x00   -> errorCode = 0
 *   - payload[3]    = 0x00   -> queueStatus = 0
 *   - payload[4..5] = 0x0002 -> queueFlags = 2
 *
 * Note: On physical PV-223 firmware v1.4.7, queueFlags === 0x0002 with errorCode === 0
 * is reported while ZP-2030-2C (2-circle sticker paper) is loaded and ready.
 * Actual paper-out faults set bit 2 (0x0004) or a non-zero errorCode.
 */
export function parseStatusResponse(parsedMsg) {
  const { payload } = parsedMsg;
  const i = ((payload[0] & 0xff) << 8) | (payload[1] & 0xff);
  const errorCode = payload[2] & 0xff;
  const queueStatus = payload[3] & 0xff;
  const batteryLevel = parseBitRange(i, 6);
  const usbStatus = (i >> 7) & 1;
  const queueFlags = ((payload[4] & 0xff) << 8) | (payload[5] & 0xff);

  const isCoverOpen = (queueFlags & 1) === 1;
  // Bit 2 (0x04) or errorCode === 2 indicates paper out; bit 1 (0x02) with errorCode === 0
  // is reported on Zoemini 2 when ZP-2030-2C (2x Round Cutout) paper is loaded.
  const isNoPaper = (queueFlags & 4) === 4 || errorCode === 2;
  const isWrongSmartSheet = (queueFlags & 16) === 16;

  return {
    errorCode,
    queueStatus,
    batteryLevel,
    usbStatus,
    queueFlags,
    isCoverOpen,
    isNoPaper,
    isWrongSmartSheet,
  };
}

/**
 * Decodes GetSettingTask (0x0103) response:
 * Live Zoemini 2 (PV-223, FW 1.4.7) with ZP-2030-2C (2x Round Cutouts) loaded:
 *   payload = 03 01 04 07 05 16 00 8b 00 00 12 00 ...
 *   - payload[0]    = 0x03   -> autoPowerOff (3 min)
 *   - payload[1..3] = 010407 -> firmwareVersion ("1.4.7")
 *   - payload[4]    = 0x05   -> mediaCode (5)
 *   - payload[5]    = 0x16   -> tmdVersion (22 decimal — Smart Sheet calibration profile)
 *   - payload[6..7] = 0x008b -> photosPrinted (139)
 *   - payload[8]    = 0x00   -> colorId (0)
 *   - payload[9..10]= 0x0012 -> paperProfileId (18 decimal)
 */
export function parseSettingResponse(parsedMsg) {
  const { payload } = parsedMsg;
  const autoPowerOff = payload[0] & 0xff;
  const firmwareVersion = `${payload[1] & 0xff}.${payload[2] & 0xff}.${payload[3] & 0xff}`;
  const mediaCode = payload[4] & 0xff;
  const tmdVersion = payload[5] & 0xff;
  const photosPrinted = ((payload[6] & 0xff) << 8) | (payload[7] & 0xff);
  const colorId = payload[8] & 0xff;
  const paperProfileId =
    payload.length >= 11 ? ((payload[9] & 0xff) << 8) | (payload[10] & 0xff) : 0;

  return {
    autoPowerOff,
    firmwareVersion,
    mediaCode,
    tmdVersion,
    photosPrinted,
    colorId,
    paperProfileId,
  };
}

/**
 * Determines the loaded ZINK paper format for the connected printer.
 *
 * Hardware Note (Zoemini 2 PV-223, FW v1.4.7):
 * Both ZP-2030 (2x3" Full Sheet) and ZP-2030-2C (2x Round Cutouts) have identical 50x76mm
 * backing and ZINK thermal crystal chemistry, so the printer returns identical GetStatus
 * (queueFlags = 0x0002) and GetSetting (TMD = 22 / 0x16, profile = 0x0012) registers for both.
 * Only the mechanical Top Cover switch (queueFlags bit 0 = 0x0001) changes when swapping paper.
 *
 * Therefore, we track the loaded tray paper via `paperTypeOverride` (persisted in localStorage
 * and prompted automatically whenever the Top Cover is opened and closed).
 *
 * @param {Object} telemetry
 * @returns {'full-2x3'|'dual-round-2c'|null}
 */
export function detectDevicePaperMode(telemetry) {
  if (!telemetry || !telemetry.connected) return null;
  if (
    telemetry.paperTypeOverride === PAPER_MODE_FULL ||
    telemetry.paperTypeOverride === PAPER_MODE_DUAL_ROUND
  ) {
    return telemetry.paperTypeOverride;
  }

  if (telemetry.isSimulator) {
    return telemetry.tmdVersion === 0x16 ? PAPER_MODE_DUAL_ROUND : PAPER_MODE_FULL;
  }

  return PAPER_MODE_FULL;
}

/**
 * Decodes GetPrintReadyTask response:
 * unknown = payload[2] & 255
 * error_code = payload[3] & 255
 */
export function parsePrintReadyResponse(parsedMsg) {
  const { payload } = parsedMsg;
  const unknown = payload[2] & 0xff;
  const errorCode = payload[3] & 0xff;
  return { unknown, errorCode };
}

/**
 * Formats a Uint8Array as a space-separated hex string.
 */
export function toHexString(uint8Array, maxBytes = 64) {
  const slice = uint8Array.length > maxBytes ? uint8Array.subarray(0, maxBytes) : uint8Array;
  const hex = Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" ");
  if (uint8Array.length > maxBytes) {
    return `${hex} … (+${uint8Array.length - maxBytes} bytes)`;
  }
  return hex;
}

/**
 * Summarizes a 34/36-byte control packet or JPEG data chunk for the diagnostic console.
 * Outbound packets begin with 0x430F; inbound printer responses begin with 0x43F0 (or 0x430F).
 */
export function describePacket(uint8Array, direction = "TX") {
  if (!uint8Array || uint8Array.length === 0) return "Empty frame";

  const isControlHeader =
    uint8Array.length >= CONTROL_PACKET_SIZE &&
    uint8Array[0] === 0x43 &&
    (uint8Array[1] === 0x0f || uint8Array[1] === 0xf0);

  if (isControlHeader) {
    const cmdOrAck = ((uint8Array[5] & 0xff) << 8) | (uint8Array[6] & 0xff);
    const flagOrErr = uint8Array[7] & 0xff;
    const name = COMMAND_NAMES[cmdOrAck] || `0x${cmdOrAck.toString(16).padStart(4, "0")}`;

    if (direction === "TX") {
      if (cmdOrAck === COMMAND_PRINT_READY) {
        const view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
        const jpegLen = view.getUint32(8, false);
        return `CMD ${name} [jpegLen=${jpegLen} B]`;
      }
      if (cmdOrAck === COMMAND_SETTING_ACCESSORY && flagOrErr === 1) {
        return `CMD ${name} [SET autoPowerOff=${uint8Array[8]}m]`;
      }
      return `CMD ${name} [write=${flagOrErr}]`;
    } else {
      return `ACK ${name} [err=${flagOrErr}, len=${uint8Array.length}B]`;
    }
  }

  if (uint8Array[0] === 0xff && uint8Array[1] === 0xd8) {
    return `JPEG SOI Chunk (${uint8Array.length} bytes)`;
  }

  return `Data Chunk (${uint8Array.length} bytes)`;
}
