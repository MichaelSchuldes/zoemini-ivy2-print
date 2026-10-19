/**
 * Zoemini 2 (PV-223) / Ivy 2 Protocol & Media Constants
 * Verified against dtgreene/ivy2 reference implementation.
 */

export const SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb";
export const PV223_SERVICE_UUID = "00500056-0223-0000-0000-000000000000";
export const VENDOR_SERVICE_UUID = "e5b152ed-6b46-09e9-4678-665e9a972cbc";

export const ALLOWED_BT_SERVICE_UUIDS = [
  SPP_UUID,
  PV223_SERVICE_UUID,
  VENDOR_SERVICE_UUID,
];

export const START_CODE = 0x430f; // 17167
export const CONTROL_PACKET_SIZE = 34;
export const PRINT_DATA_CHUNK = 990;
export const INTER_CHUNK_DELAY_MS = 20;
export const PRINT_BATTERY_MIN = 30;
export const AUTO_DISCONNECT_TIMEOUT_MS = 30000;
export const KEEP_ALIVE_INTERVAL_MS = 4000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 5000;
export const PRINT_TRANSFER_TIMEOUT_MS = 60000;

// Command & ACK Identifiers (16-bit Big-Endian at bytes 5..6)
export const COMMAND_START_SESSION = 0x0000;      // 0
export const COMMAND_GET_STATUS = 0x0101;         // 257
export const COMMAND_SETTING_ACCESSORY = 0x0103;  // 259
export const COMMAND_PRINT_READY = 0x0301;        // 769
export const COMMAND_REBOOT = 0xffff;             // 65535

export const ACK_START_SESSION = 0x0000;
export const ACK_GET_STATUS = 0x0101;
export const ACK_SETTING_ACCESSORY = 0x0103;
export const ACK_PRINT_READY = 0x0301;
export const ACK_REBOOT = 0xffff;

export const COMMAND_NAMES = {
  [COMMAND_START_SESSION]: "START_SESSION (0x0000)",
  [COMMAND_GET_STATUS]: "GET_STATUS (0x0101)",
  [COMMAND_SETTING_ACCESSORY]: "SETTING_ACCESSORY (0x0103)",
  [COMMAND_PRINT_READY]: "PRINT_READY (0x0301)",
  [COMMAND_REBOOT]: "REBOOT (0xFFFF)",
};

// Stage 1 Physical Preview Canvas Dimensions (True 2:3 Aspect Ratio for 50x76 mm sheet)
export const PREVIEW_WIDTH = 1280;
export const PREVIEW_HEIGHT = 1920;

// Stage 2 ZINK Hardware Output Dimensions (Non-square vertical step compensation, rotated 180 deg)
export const PRINT_FINAL_WIDTH = 640;
export const PRINT_FINAL_HEIGHT = 1616;

// Physical Paper Dimensions in millimeters
export const SHEET_WIDTH_MM = 50.0;
export const SHEET_HEIGHT_MM = 76.0;
export const PX_PER_MM_X = PREVIEW_WIDTH / SHEET_WIDTH_MM;   // 25.6 px/mm
export const PX_PER_MM_Y = PREVIEW_HEIGHT / SHEET_HEIGHT_MM; // ~25.263 px/mm

// Pre-Cut Dual Round Sticker Paper (ZP-2030-2C) Specifications
export const PAPER_MODE_FULL = "full-2x3";
export const PAPER_MODE_DUAL_ROUND = "dual-round-2c";

export const ROUND_STICKER_DIAMETER_MM = 33.0; // 1.3 inch nominal cutout diameter
export const ROUND_STICKER_DEFAULT_BLEED_MM = 2.0; // +2.0 mm radius bleed past die-cut line
export const ROUND_STICKER_TOP_CENTER_Y_MM = 19.0; // 1/4 of 76 mm sheet height
export const ROUND_STICKER_BOTTOM_CENTER_Y_MM = 57.0; // 3/4 of 76 mm sheet height
export const ROUND_STICKER_CENTER_X_MM = 25.0; // Center of 50 mm sheet width

// Supported Auto Power-Off settings in minutes
export const SUPPORTED_AUTO_POWER_OFF = [3, 5, 10];
