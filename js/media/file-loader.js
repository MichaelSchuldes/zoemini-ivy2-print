/**
 * Unified Multi-Format Media Loader (Images & Multi-Page PDFs)
 * Also provides built-in sample calibration cards for instant testing.
 */

import { loadPdfDocument, renderPdfPageToCanvas } from "./pdf-renderer.js";

const SVG_TARGET_MAX_DIMENSION = 2048;

/**
 * Parses an SVG length attribute (e.g. "240", "100px", "50mm", "2in") into pixels (at 96 DPI).
 * Returns null for percentages or unparseable strings.
 * @param {string|null} raw
 * @returns {number|null}
 */
function parseSvgLengthToPx(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.endsWith("%")) return null;
  const match = trimmed.match(/^([+-]?\d*(?:\.\d+)?)\s*(px|pt|pc|mm|cm|in)?$/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = (match[2] || "px").toLowerCase();
  switch (unit) {
    case "pt":
      return val * (96 / 72);
    case "pc":
      return val * 16;
    case "mm":
      return val * (96 / 25.4);
    case "cm":
      return val * (96 / 2.54);
    case "in":
      return val * 96;
    default:
      return val;
  }
}

/**
 * Normalizes an SVG file/blob and rasterizes it at high print resolution (2048px max edge)
 * so vector paths, icons, and viewBox-only SVGs render crisply without aspect distortion.
 * @param {File|Blob} file
 * @returns {Promise<{canvas: HTMLCanvasElement, intrinsicWidth: number, intrinsicHeight: number}>}
 */
export async function loadSvgToCanvas(file) {
  const rawText = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawText, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  const svgEl = doc.querySelector("svg");

  if (parserError || !svgEl) {
    throw new Error(`Invalid or corrupted SVG file "${file.name || "graphic.svg"}".`);
  }

  // Ensure required XML namespaces exist for standalone Blob rendering
  if (!svgEl.getAttribute("xmlns")) {
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!svgEl.getAttribute("xmlns:xlink") && rawText.includes("xlink:")) {
    svgEl.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  // Extract viewBox and/or width & height
  let vbWidth = null;
  let vbHeight = null;
  const viewBoxAttr = svgEl.getAttribute("viewBox") || svgEl.getAttribute("viewbox");
  if (viewBoxAttr) {
    const parts = viewBoxAttr
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      vbWidth = parts[2];
      vbHeight = parts[3];
    }
  }

  const attrWidth = parseSvgLengthToPx(svgEl.getAttribute("width"));
  const attrHeight = parseSvgLengthToPx(svgEl.getAttribute("height"));

  const intrinsicWidth = vbWidth || attrWidth || 1280;
  const intrinsicHeight = vbHeight || attrHeight || 1920;

  // Inject viewBox if missing so setting width/height scales the vector paths
  if (!viewBoxAttr) {
    svgEl.setAttribute("viewBox", `0 0 ${intrinsicWidth} ${intrinsicHeight}`);
  }

  const scale = SVG_TARGET_MAX_DIMENSION / Math.max(intrinsicWidth, intrinsicHeight, 1);
  const targetWidth = Math.max(64, Math.round(intrinsicWidth * scale));
  const targetHeight = Math.max(64, Math.round(intrinsicHeight * scale));

  svgEl.setAttribute("width", String(targetWidth));
  svgEl.setAttribute("height", String(targetHeight));

  const serialized = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const img = await loadImageElement(svgBlob);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  return {
    canvas,
    intrinsicWidth: Math.round(intrinsicWidth * 100) / 100,
    intrinsicHeight: Math.round(intrinsicHeight * 100) / 100,
  };
}

/**
 * Loads an image File/Blob into an HTMLImageElement.
 * @param {File|Blob} file
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode image file "${file.name || "unnamed"}".`));
    };

    img.src = objectUrl;
  });
}

/**
 * Parses an incoming File (Image, SVG, or PDF) into a unified MediaSource descriptor.
 * @param {File} file
 * @param {number} [initialPage=1]
 */
export async function loadMediaFile(file, initialPage = 1) {
  if (!file) {
    throw new Error("No file provided.");
  }

  const isPdf =
    file.type === "application/pdf" ||
    (file.name && file.name.toLowerCase().endsWith(".pdf"));

  if (isPdf) {
    const { pdfDoc, numPages } = await loadPdfDocument(file);
    const pageNumber = Math.max(1, Math.min(initialPage, numPages));
    const renderedCanvas = await renderPdfPageToCanvas(pdfDoc, pageNumber);

    return {
      kind: "pdf",
      name: file.name || "Document.pdf",
      mimeType: "application/pdf",
      fileSize: file.size,
      pdfDoc,
      numPages,
      currentPage: pageNumber,
      drawable: renderedCanvas,
      width: renderedCanvas.width,
      height: renderedCanvas.height,
    };
  }

  const isSvg =
    file.type === "image/svg+xml" ||
    /\.svg$/i.test(file.name || "");

  if (isSvg) {
    const { canvas, intrinsicWidth, intrinsicHeight } = await loadSvgToCanvas(file);
    return {
      kind: "svg",
      name: file.name || "Vector.svg",
      mimeType: "image/svg+xml",
      fileSize: file.size,
      pdfDoc: null,
      numPages: 1,
      currentPage: 1,
      drawable: canvas,
      width: canvas.width,
      height: canvas.height,
      intrinsicWidth,
      intrinsicHeight,
    };
  }

  if (
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || "")
  ) {
    const img = await loadImageElement(file);
    return {
      kind: "image",
      name: file.name || "Photo.jpg",
      mimeType: file.type || "image/jpeg",
      fileSize: file.size,
      pdfDoc: null,
      numPages: 1,
      currentPage: 1,
      drawable: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
  }

  throw new Error(
    `Unsupported file format "${file.type || file.name}". Please select an Image (JPEG, PNG, WebP, GIF), SVG, or PDF.`
  );
}

/**
 * Switches a loaded PDF MediaSource to a different 1-indexed page number.
 */
export async function changePdfMediaPage(mediaSource, newPageNumber) {
  if (!mediaSource || mediaSource.kind !== "pdf" || !mediaSource.pdfDoc) {
    return mediaSource;
  }
  const pageNumber = Math.max(1, Math.min(newPageNumber, mediaSource.numPages));
  const renderedCanvas = await renderPdfPageToCanvas(mediaSource.pdfDoc, pageNumber);

  return {
    ...mediaSource,
    currentPage: pageNumber,
    drawable: renderedCanvas,
    width: renderedCanvas.width,
    height: renderedCanvas.height,
  };
}

/**
 * Generates a built-in synthetic test image/badge so users can test
 * full-sheet 2x3" cropping and Dual Round Sticker layouts right away.
 * @param {'photo-card'|'badge-top'|'badge-bottom'} preset
 */
export function createSampleMediaSource(preset = "photo-card") {
  const canvas = document.createElement("canvas");
  if (preset === "photo-card") {
    canvas.width = 1280;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");

    // Gradient sky & geometric horizon
    const grad = ctx.createLinearGradient(0, 0, 1280, 1920);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(0.45, "#1e3a8a");
    grad.addColorStop(0.75, "#ea580c");
    grad.addColorStop(1, "#fef08a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 1920);

    // Sun disc
    ctx.fillStyle = "rgba(254, 240, 138, 0.92)";
    ctx.beginPath();
    ctx.arc(640, 780, 240, 0, Math.PI * 2);
    ctx.fill();

    // Mountain silhouettes
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.moveTo(0, 1920);
    ctx.lineTo(0, 1320);
    ctx.lineTo(380, 980);
    ctx.lineTo(740, 1290);
    ctx.lineTo(1040, 920);
    ctx.lineTo(1280, 1180);
    ctx.lineTo(1280, 1920);
    ctx.closePath();
    ctx.fill();

    // Calibration border & label
    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.lineWidth = 8;
    ctx.strokeRect(48, 48, 1280 - 96, 1920 - 96);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 64px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ZOEMINI 2 / IVY 2", 640, 220);
    ctx.font = "500 38px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText("2×3\" ZINK Calibration Card (50 × 76 mm)", 640, 290);
    ctx.fillText("Drag to Pan • Scroll to Zoom • Rotate", 640, 1790);

    return {
      kind: "image",
      name: "Sample-2x3-Calibration.png",
      mimeType: "image/png",
      fileSize: 0,
      pdfDoc: null,
      numPages: 1,
      currentPage: 1,
      drawable: canvas,
      width: canvas.width,
      height: canvas.height,
    };
  }

  // Square circular sticker sample badge (1000x1000)
  canvas.width = 1000;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  const isTop = preset === "badge-top";

  const bgGrad = ctx.createRadialGradient(500, 500, 60, 500, 500, 520);
  if (isTop) {
    bgGrad.addColorStop(0, "#2563eb");
    bgGrad.addColorStop(1, "#0f172a");
  } else {
    bgGrad.addColorStop(0, "#db2777");
    bgGrad.addColorStop(1, "#3b0764");
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1000, 1000);

  // Decorative concentric rings
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(500, 500, 410, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 6;
  ctx.setLineDash([18, 12]);
  ctx.beginPath();
  ctx.arc(500, 500, 355, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 72px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(isTop ? "STICKER #1" : "STICKER #2", 500, 460);

  ctx.font = "500 40px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(isTop ? "Top Ø 33mm Cutout" : "Bottom Ø 33mm Cutout", 500, 535);
  ctx.font = "400 30px system-ui, -apple-system, sans-serif";
  ctx.fillText("ZP-2030-2C Round ZINK", 500, 600);

  return {
    kind: "image",
    name: isTop ? "Sample-Top-Sticker.png" : "Sample-Bottom-Sticker.png",
    mimeType: "image/png",
    fileSize: 0,
    pdfDoc: null,
    numPages: 1,
    currentPage: 1,
    drawable: canvas,
    width: canvas.width,
    height: canvas.height,
  };
}
