/**
 * Two-Stage ZINK Canvas Composition & Baseline JPEG Encoding Pipeline
 *
 * Stage 1: Renders a true 2:3 physical composition canvas (1280 x 1920)
 *          supporting both Full-Sheet (ZP-2030) and Dual Round Stickers (ZP-2030-2C)
 *          with interactive zoom, pan, 90°/fine rotation, flip, and crop/contain modes.
 * Stage 2: Stretches the clean 1280 x 1920 composition onto the 640 x 1616 ZINK
 *          hardware canvas, rotates 180°, and encodes as a baseline JPEG Uint8Array.
 */

import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PRINT_FINAL_WIDTH,
  PRINT_FINAL_HEIGHT,
  PX_PER_MM_X,
  PX_PER_MM_Y,
  PAPER_MODE_DUAL_ROUND,
} from "../protocol/constants.js";
import { getDualRoundGeometry } from "./sticker-layout.js";

/**
 * Draws a single media slot (Image or rasterized PDF page) inside a target bounding region
 * (`targetCx`, `targetCy`, `targetWidth`, `targetHeight`) with an optional circular clip mask.
 */
function renderMediaSlot(ctx, media, transform, region) {
  if (!media || !media.drawable) return;

  const {
    cx,
    cy,
    boxWidth,
    boxHeight,
    clipCircleRadius = null,
  } = region;

  ctx.save();

  // Clip to either circular print bleed radius or rectangular region
  ctx.beginPath();
  if (clipCircleRadius !== null) {
    ctx.arc(cx, cy, clipCircleRadius, 0, Math.PI * 2);
  } else {
    ctx.rect(cx - boxWidth / 2, cy - boxHeight / 2, boxWidth, boxHeight);
  }
  ctx.clip();

  // Fill region background with pure white (prevents black transparent PNG/PDF margins)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(cx - boxWidth, cy - boxHeight, boxWidth * 2, boxHeight * 2);

  // Compute effective rotation
  let baseAngleDeg = Number(transform.rotation90) || 0;
  if (transform.autoRotateLandscape && media.width > media.height && baseAngleDeg === 0) {
    baseAngleDeg = 90;
  }
  const totalAngleRad = ((baseAngleDeg + (Number(transform.fineRotation) || 0)) * Math.PI) / 180;

  // Determine source dimensions after 90/270 step rotation for base fit/crop calculation
  const isQuarterTurn = Math.abs(baseAngleDeg % 180) === 90;
  const effSrcW = isQuarterTurn ? media.height : media.width;
  const effSrcH = isQuarterTurn ? media.width : media.height;

  // Base scale to either cover ('crop') or fit ('contain') the nominal boxWidth x boxHeight
  let baseScale;
  if (transform.scaleMode === "contain") {
    baseScale = Math.min(boxWidth / effSrcW, boxHeight / effSrcH);
  } else {
    // 'crop' mode: if circular, cover the circle diameter (or bleed diameter if zoom >= 1)
    const targetCoverW = clipCircleRadius ? Math.max(boxWidth, clipCircleRadius * 2) : boxWidth;
    const targetCoverH = clipCircleRadius ? Math.max(boxHeight, clipCircleRadius * 2) : boxHeight;
    baseScale = Math.max(targetCoverW / effSrcW, targetCoverH / effSrcH);
  }

  const userZoom = Math.max(0.1, Math.min(8.0, Number(transform.zoom) || 1.0));
  const finalScale = baseScale * userZoom;

  // Apply CSS filter adjustments if modified
  const b = Number(transform.brightness) ?? 100;
  const c = Number(transform.contrast) ?? 100;
  const s = Number(transform.saturation) ?? 100;
  if (b !== 100 || c !== 100 || s !== 100) {
    ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
  }

  // Transform around slot center + user pan offset
  ctx.translate(cx + (Number(transform.panX) || 0), cy + (Number(transform.panY) || 0));
  ctx.rotate(totalAngleRad);
  ctx.scale(
    (transform.flipX ? -1 : 1) * finalScale,
    (transform.flipY ? -1 : 1) * finalScale
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(media.drawable, -media.width / 2, -media.height / 2, media.width, media.height);

  ctx.restore();
}

/**
 * Renders the clean 1280 x 1920 (2:3 physical aspect ratio) sheet onto `canvas`.
 * Does NOT include any UI-only guide lines or selection rings.
 */
export function renderCleanComposition(canvas, workspaceState) {
  if (canvas.width !== PREVIEW_WIDTH) canvas.width = PREVIEW_WIDTH;
  if (canvas.height !== PREVIEW_HEIGHT) canvas.height = PREVIEW_HEIGHT;

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  if (workspaceState.paperMode === PAPER_MODE_DUAL_ROUND) {
    const geom = getDualRoundGeometry(workspaceState.calibration);

    // Render Top Circle (Slot 1) clipped to printRadius (cutRadius + bleed)
    renderMediaSlot(ctx, workspaceState.slots.slot1.media, workspaceState.slots.slot1.transform, {
      cx: geom.slot1.cx,
      cy: geom.slot1.cy,
      boxWidth: geom.slot1.boxWidth,
      boxHeight: geom.slot1.boxHeight,
      clipCircleRadius: geom.slot1.printRadius,
    });

    // Render Bottom Circle (Slot 2) clipped to printRadius (cutRadius + bleed)
    renderMediaSlot(ctx, workspaceState.slots.slot2.media, workspaceState.slots.slot2.transform, {
      cx: geom.slot2.cx,
      cy: geom.slot2.cy,
      boxWidth: geom.slot2.boxWidth,
      boxHeight: geom.slot2.boxHeight,
      clipCircleRadius: geom.slot2.printRadius,
    });
  } else {
    // Full 2x3" Sheet Mode (Slot 1)
    renderMediaSlot(ctx, workspaceState.slots.slot1.media, workspaceState.slots.slot1.transform, {
      cx: PREVIEW_WIDTH / 2,
      cy: PREVIEW_HEIGHT / 2,
      boxWidth: PREVIEW_WIDTH,
      boxHeight: PREVIEW_HEIGHT,
      clipCircleRadius: null,
    });
  }

  ctx.restore();
  return canvas;
}

/**
 * Renders the 1280 x 1920 preview canvas INCLUDING non-printed visual guides
 * (crop rule-of-thirds grid, safe print margin, or Dual Round 33mm die-cut lines).
 */
export function renderInteractivePreview(previewCanvas, workspaceState) {
  renderCleanComposition(previewCanvas, workspaceState);

  if (!workspaceState.showGuides && workspaceState.paperMode !== PAPER_MODE_DUAL_ROUND) {
    return;
  }

  const ctx = previewCanvas.getContext("2d");
  ctx.save();

  if (workspaceState.paperMode === PAPER_MODE_DUAL_ROUND) {
    const geom = getDualRoundGeometry(workspaceState.calibration);
    const circles = [geom.slot1, geom.slot2];

    // Dim the non-sticker backing area outside the two 33mm nominal cut circles
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    for (const c of circles) {
      ctx.moveTo(c.cx + c.cutRadius, c.cy);
      ctx.arc(c.cx, c.cy, c.cutRadius, 0, Math.PI * 2, true);
    }
    ctx.fillStyle = "rgba(15, 23, 42, 0.36)";
    ctx.fill("evenodd");
    ctx.restore();

    // Horizontal sheet midpoint divider
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(0, PREVIEW_HEIGHT / 2);
    ctx.lineTo(PREVIEW_WIDTH, PREVIEW_HEIGHT / 2);
    ctx.stroke();

    for (const c of circles) {
      const isSelected = workspaceState.activeSlot === c.id;
      const slotMedia = workspaceState.slots[c.id]?.media;

      // Empty placeholder prompt if no media in this circle slot
      if (!slotMedia) {
        ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
        ctx.font = "700 40px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          c.id === "slot1" ? "TOP STICKER (#1)" : "BOTTOM STICKER (#2)",
          c.cx,
          c.cy - 20
        );
        ctx.font = "500 28px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "rgba(71, 85, 105, 0.9)";
        ctx.fillText("Click or drop Image / PDF", c.cx, c.cy + 34);
      }

      // Outer print-bleed boundary ring (dotted)
      if (c.printRadius > c.cutRadius + 1 && workspaceState.showGuides) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.printRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Optional rule-of-thirds crosshair inside active circle when guides enabled
      if (isSelected && workspaceState.showGuides) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(c.cx - c.cutRadius, c.cy);
        ctx.lineTo(c.cx + c.cutRadius, c.cy);
        ctx.moveTo(c.cx, c.cy - c.cutRadius);
        ctx.lineTo(c.cx, c.cy + c.cutRadius);
        ctx.stroke();
      }

      // Physical 33mm die-cut circle ring
      ctx.setLineDash([16, 10]);
      ctx.lineWidth = isSelected ? 6 : 4;
      ctx.strokeStyle = isSelected ? "#38bdf8" : "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.cutRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Badge label pill at top of circle
      const badgeText = c.id === "slot1" ? "#1 Top (Ø 33mm)" : "#2 Bottom (Ø 33mm)";
      ctx.font = "600 24px system-ui, -apple-system, sans-serif";
      const textW = ctx.measureText(badgeText).width + 28;
      const badgeX = c.cx - textW / 2;
      const badgeY = c.cy - c.cutRadius - 42;

      ctx.fillStyle = isSelected ? "#0284c7" : "rgba(15, 23, 42, 0.78)";
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, textW, 34, 17);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(badgeText, c.cx, badgeY + 24);
    }
  } else if (workspaceState.showGuides) {
    // Full 2x3" Sheet Guides: Rule of Thirds + 1.5mm ZINK Safe Print Margin
    const safeMarginX = 1.5 * PX_PER_MM_X;
    const safeMarginY = 1.5 * PX_PER_MM_Y;

    // Rule of thirds lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i <= 2; i++) {
      const x = (PREVIEW_WIDTH / 3) * i;
      const y = (PREVIEW_HEIGHT / 3) * i;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PREVIEW_HEIGHT);
      ctx.moveTo(0, y);
      ctx.lineTo(PREVIEW_WIDTH, y);
    }
    ctx.stroke();

    // Subtle dark shadow line for visibility on white backgrounds
    ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 1.5 mm ZINK edge bleed safe zone
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      safeMarginX,
      safeMarginY,
      PREVIEW_WIDTH - safeMarginX * 2,
      PREVIEW_HEIGHT - safeMarginY * 2
    );
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/**
 * Generates the final 640 x 1616 (180° rotated) baseline JPEG payload for the printer.
 * Matches dtgreene/ivy2 image.py:
 * 1. Renders clean 1280 x 1920 composition (no UI overlays)
 * 2. Resizes to 640 x 1616
 * 3. Rotates 180.0 degrees
 * 4. Encodes as baseline JPEG
 */
export async function buildZinkPrintJpeg(workspaceState, quality = 0.95) {
  const compositionCanvas = document.createElement("canvas");
  compositionCanvas.width = PREVIEW_WIDTH;
  compositionCanvas.height = PREVIEW_HEIGHT;
  renderCleanComposition(compositionCanvas, workspaceState);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = PRINT_FINAL_WIDTH;
  outputCanvas.height = PRINT_FINAL_HEIGHT;

  const outCtx = outputCanvas.getContext("2d");
  outCtx.fillStyle = "#FFFFFF";
  outCtx.fillRect(0, 0, PRINT_FINAL_WIDTH, PRINT_FINAL_HEIGHT);

  // Rotate 180 degrees around the center of the 640x1616 buffer
  outCtx.save();
  outCtx.translate(PRINT_FINAL_WIDTH, PRINT_FINAL_HEIGHT);
  outCtx.rotate(Math.PI);
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(
    compositionCanvas,
    0,
    0,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    0,
    0,
    PRINT_FINAL_WIDTH,
    PRINT_FINAL_HEIGHT
  );
  outCtx.restore();

  const clampedQuality = Math.max(0.5, Math.min(1.0, Number(quality) || 0.95));
  const jpegBlob = await new Promise((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas JPEG encoding failed."));
      },
      "image/jpeg",
      clampedQuality
    );
  });

  const arrayBuffer = await jpegBlob.arrayBuffer();
  const jpegBytes = new Uint8Array(arrayBuffer);

  return {
    jpegBytes,
    jpegBlob,
    compositionCanvas,
    outputCanvas,
    width: PRINT_FINAL_WIDTH,
    height: PRINT_FINAL_HEIGHT,
  };
}
