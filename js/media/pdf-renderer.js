/**
 * Client-Side PDF Parsing & High-DPI Rasterizer using Mozilla PDF.js
 * Lazily imports PDF.js from CDN when a PDF document is loaded.
 */

const PDFJS_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

let pdfjsLibPromise = null;

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(PDFJS_CDN_URL).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    });
  }
  return pdfjsLibPromise;
}

/**
 * Loads a PDF File/Blob and returns a handle with page count and page rendering helper.
 * @param {File|Blob|ArrayBuffer} fileOrBuffer
 */
export async function loadPdfDocument(fileOrBuffer) {
  const pdfjsLib = await getPdfJs();
  const arrayBuffer =
    fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();

  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return {
    pdfDoc,
    numPages: pdfDoc.numPages,
  };
}

/**
 * Renders a 1-indexed page from a loaded PDF document onto an offscreen canvas at high DPI.
 * @param {Object} pdfDoc - PDFDocumentProxy from PDF.js
 * @param {number} pageNumber - 1-indexed page number
 * @param {number} [scale=3.0] - Rasterization scale (~216-300 DPI)
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPdfPageToCanvas(pdfDoc, pageNumber = 1, scale = 3.0) {
  const clampedPage = Math.max(1, Math.min(pageNumber, pdfDoc.numPages));
  const page = await pdfDoc.getPage(clampedPage);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const ctx = canvas.getContext("2d");
  // Fill white background for transparent PDF pages
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  return canvas;
}
