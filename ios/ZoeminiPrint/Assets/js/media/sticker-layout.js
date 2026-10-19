/**
 * Unified Transform State & Dual Round Sticker Geometry Engine
 * Supports both Standard 2x3" Full-Sheet (ZP-2030) and Pre-Cut Dual Round Stickers (ZP-2030-2C).
 */

import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PX_PER_MM_X,
  PX_PER_MM_Y,
  PAPER_MODE_DUAL_ROUND,
  ROUND_STICKER_DIAMETER_MM,
  ROUND_STICKER_DEFAULT_BLEED_MM,
  ROUND_STICKER_TOP_CENTER_Y_MM,
  ROUND_STICKER_BOTTOM_CENTER_Y_MM,
  ROUND_STICKER_CENTER_X_MM,
} from "../protocol/constants.js";

const CALIBRATION_STORAGE_KEY = "zoeminiweb_round_calibration_v1";

/**
 * Creates a fresh transform state for any media slot (Full-Sheet or Round Sticker Slot 1/2).
 */
export function createSlotTransformState(overrides = {}) {
  return {
    scaleMode: "crop",          // 'crop' (Fill) | 'contain' (Fit)
    zoom: 1.0,                  // 0.25x .. 5.0x
    panX: 0,                    // Horizontal pan offset in 1280x1920 canvas pixels
    panY: 0,                    // Vertical pan offset in 1280x1920 canvas pixels
    rotation90: 0,              // 0, 90, 180, 270 degrees
    fineRotation: 0,            // -45 .. +45 degrees
    flipX: false,
    flipY: false,
    autoRotateLandscape: false, // Optional auto-90° rotation for landscape images on full 2x3" sheet
    brightness: 100,            // 50% .. 150%
    contrast: 100,              // 50% .. 150%
    saturation: 100,            // 0% .. 200%
    ...overrides,
  };
}

/**
 * Clones a slot transform state cleanly (used e.g. when copying Slot 1 -> Slot 2).
 */
export function cloneSlotTransformState(state) {
  return createSlotTransformState({ ...state });
}

/**
 * Default calibration parameters for ZP-2030-2C Dual Round Sticker sheets.
 */
export function getDefaultStickerCalibration() {
  return {
    diameterMm: ROUND_STICKER_DIAMETER_MM,       // 33.0 mm nominal circle diameter
    bleedMm: ROUND_STICKER_DEFAULT_BLEED_MM,     // +2.0 mm radial print bleed
    offsetXMm: 0.0,                              // Horizontal center adjustment (-5..+5 mm)
    topOffsetYMm: 0.0,                           // Top circle vertical adjustment (-5..+5 mm)
    bottomOffsetYMm: 0.0,                        // Bottom circle vertical adjustment (-5..+5 mm)
  };
}

export function loadStickerCalibration() {
  const defaults = getDefaultStickerCalibration();
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      diameterMm: Number.isFinite(parsed.diameterMm) ? parsed.diameterMm : defaults.diameterMm,
      bleedMm: Number.isFinite(parsed.bleedMm) ? parsed.bleedMm : defaults.bleedMm,
      offsetXMm: Number.isFinite(parsed.offsetXMm) ? parsed.offsetXMm : defaults.offsetXMm,
      topOffsetYMm: Number.isFinite(parsed.topOffsetYMm) ? parsed.topOffsetYMm : defaults.topOffsetYMm,
      bottomOffsetYMm: Number.isFinite(parsed.bottomOffsetYMm)
        ? parsed.bottomOffsetYMm
        : defaults.bottomOffsetYMm,
    };
  } catch (_) {
    return defaults;
  }
}

export function saveStickerCalibration(calibration) {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
  } catch (_) {
    // Ignore storage quota errors
  }
}

/**
 * Computes pixel coordinates on the 1280x1920 preview canvas for both round cutouts.
 */
export function getDualRoundGeometry(calibration = getDefaultStickerCalibration()) {
  const cutRadiusPx = ((calibration.diameterMm || ROUND_STICKER_DIAMETER_MM) / 2) * PX_PER_MM_X;
  const bleedPx = Math.max(0, (calibration.bleedMm ?? ROUND_STICKER_DEFAULT_BLEED_MM) * PX_PER_MM_X);
  const printRadiusPx = cutRadiusPx + bleedPx;

  const cx = (ROUND_STICKER_CENTER_X_MM + (calibration.offsetXMm || 0)) * PX_PER_MM_X;
  const topCy = (ROUND_STICKER_TOP_CENTER_Y_MM + (calibration.topOffsetYMm || 0)) * PX_PER_MM_Y;
  const bottomCy =
    (ROUND_STICKER_BOTTOM_CENTER_Y_MM + (calibration.bottomOffsetYMm || 0)) * PX_PER_MM_Y;

  return {
    slot1: {
      id: "slot1",
      label: "Sticker #1 (Top Circle)",
      cx,
      cy: topCy,
      cutRadius: cutRadiusPx,
      printRadius: printRadiusPx,
      boxWidth: cutRadiusPx * 2,
      boxHeight: cutRadiusPx * 2,
    },
    slot2: {
      id: "slot2",
      label: "Sticker #2 (Bottom Circle)",
      cx,
      cy: bottomCy,
      cutRadius: cutRadiusPx,
      printRadius: printRadiusPx,
      boxWidth: cutRadiusPx * 2,
      boxHeight: cutRadiusPx * 2,
    },
  };
}

/**
 * Determines which slot ('slot1' or 'slot2') corresponds to a pointer coordinate
 * (x, y) in 1280x1920 preview canvas space.
 */
export function hitTestSlot(canvasX, canvasY, paperMode, calibration) {
  if (paperMode !== PAPER_MODE_DUAL_ROUND) {
    return "slot1";
  }
  const geom = getDualRoundGeometry(calibration);
  const dist1 = Math.hypot(canvasX - geom.slot1.cx, canvasY - geom.slot1.cy);
  const dist2 = Math.hypot(canvasX - geom.slot2.cx, canvasY - geom.slot2.cy);

  if (dist1 <= geom.slot1.printRadius) return "slot1";
  if (dist2 <= geom.slot2.printRadius) return "slot2";

  // Otherwise pick whichever half of the sheet was clicked
  return canvasY < PREVIEW_HEIGHT / 2 ? "slot1" : "slot2";
}
