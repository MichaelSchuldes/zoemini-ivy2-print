/**
 * Interactive 2x3" Full-Sheet & Dual Round Sticker (ZP-2030-2C) Workspace Editor
 * Supports pointer drag-to-pan, wheel zoom, pinch zoom, 90° & fine rotation,
 * crop/contain modes, multi-page PDF navigation, and dual-slot management.
 */

import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PAPER_MODE_FULL,
  PAPER_MODE_DUAL_ROUND,
} from "../protocol/constants.js";
import {
  loadMediaFile,
  changePdfMediaPage,
  createSampleMediaSource,
} from "../media/file-loader.js";
import {
  createSlotTransformState,
  cloneSlotTransformState,
  getDefaultStickerCalibration,
  loadStickerCalibration,
  saveStickerCalibration,
  hitTestSlot,
} from "../media/sticker-layout.js";
import {
  renderInteractivePreview,
  buildZinkPrintJpeg,
} from "../media/image-processor.js";

export class PreviewEditor {
  /**
   * @param {Object} options
   * @param {import('../protocol/printer-client.js').ZoeminiPrinter} options.printer
   * @param {(msg: string, type?: 'info'|'success'|'warn'|'error') => void} options.showToast
   * @param {(mode: string) => void} [options.onPaperModeChanged]
   */
  constructor({ printer, showToast, onPaperModeChanged = null }) {
    this.printer = printer;
    this.showToast = showToast;
    this.onPaperModeChanged = onPaperModeChanged;

    this.state = {
      paperMode: PAPER_MODE_FULL, // 'full-2x3' | 'dual-round-2c'
      activeSlot: "slot1",        // 'slot1' | 'slot2'
      showGuides: true,
      jpegQuality: 0.95,
      calibration: loadStickerCalibration(),
      slots: {
        slot1: {
          media: null,
          transform: createSlotTransformState(),
        },
        slot2: {
          media: null,
          transform: createSlotTransformState(),
        },
      },
    };

    this._dragState = null;
    this._cachedPayloadInfo = null;
    this._payloadDebounceTimer = null;

    this._cacheDom();
    this._bindEvents();
    this._syncUiFromState();
    this.requestRender();
  }

  _cacheDom() {
    this.previewCanvas = document.getElementById("zink-preview-canvas");
    this.canvasCaption = document.getElementById("canvas-mode-caption");
    this.payloadSizeBadge = document.getElementById("payload-size-badge");

    // Paper mode buttons & mismatch warning banner
    this.btnModeFull = document.getElementById("btn-paper-full");
    this.btnModeDualRound = document.getElementById("btn-paper-dual-round");
    this.chkShowGuides = document.getElementById("chk-show-guides");
    this.mismatchBanner = document.getElementById("paper-mismatch-banner");
    this.mismatchText = document.getElementById("paper-mismatch-text");
    this.btnMatchDevicePaper = document.getElementById("btn-match-device-paper");
    this.btnUpdateTrayToUi = document.getElementById("btn-update-tray-to-ui");
    this.coverClosedPrompt = document.getElementById("cover-closed-paper-prompt");
    this.btnConfirmLoadedFull = document.getElementById("btn-confirm-loaded-full");
    this.btnConfirmLoadedRound = document.getElementById("btn-confirm-loaded-round");

    // Slot cards & dual-round toolbar
    this.dualRoundToolbar = document.getElementById("dual-round-actions-bar");
    this.slot2Card = document.getElementById("slot-card-2");
    this.slot1Card = document.getElementById("slot-card-1");
    this.slot1Title = document.getElementById("slot1-card-title");
    this.slot1FileMeta = document.getElementById("slot1-file-meta");
    this.slot2FileMeta = document.getElementById("slot2-file-meta");

    this.fileInputSlot1 = document.getElementById("file-input-slot1");
    this.fileInputSlot2 = document.getElementById("file-input-slot2");
    this.btnSelectSlot1 = document.getElementById("btn-select-slot1");
    this.btnSelectSlot2 = document.getElementById("btn-select-slot2");
    this.btnClearSlot1 = document.getElementById("btn-clear-slot1");
    this.btnClearSlot2 = document.getElementById("btn-clear-slot2");
    this.btnSampleSlot1 = document.getElementById("btn-sample-slot1");
    this.btnSampleSlot2 = document.getElementById("btn-sample-slot2");

    // Image Selection Modal
    this.imageModal = document.getElementById("image-modal");
    this.imageModalTitle = document.getElementById("image-modal-title");
    this.imageModalSubtitle = document.getElementById("image-modal-subtitle");
    this.imageModalFileInput = document.getElementById("image-modal-file-input");
    this.btnImageModalSample = document.getElementById("btn-image-modal-sample");
    this.btnImageModalClear = document.getElementById("btn-image-modal-clear");
    this.imageModalMeta = document.getElementById("image-modal-meta");
    this.btnCloseImageModal = document.getElementById("btn-close-image-modal");
    this.btnCancelImageModal = document.getElementById("btn-cancel-image-modal");

    // Dual-slot helper buttons
    this.btnCopySlot1To2 = document.getElementById("btn-copy-slot1-to-2");
    this.btnSwapSlots = document.getElementById("btn-swap-slots");

    // PDF pagination controls (for active slot)
    this.pdfControlsBox = document.getElementById("pdf-pagination-box");
    this.btnPdfPrev = document.getElementById("btn-pdf-prev");
    this.btnPdfNext = document.getElementById("btn-pdf-next");
    this.inputPdfPage = document.getElementById("input-pdf-page");
    this.labelPdfTotal = document.getElementById("label-pdf-total");

    // Active slot transform controls
    this.activeSlotLabel = document.getElementById("active-slot-editing-badge");
    this.btnScaleCrop = document.getElementById("btn-scale-crop");
    this.btnScaleContain = document.getElementById("btn-scale-contain");
    this.sliderZoom = document.getElementById("slider-zoom");
    this.labelZoomVal = document.getElementById("label-zoom-val");
    this.btnZoomOut = document.getElementById("btn-zoom-out");
    this.btnZoomIn = document.getElementById("btn-zoom-in");
    this.btnZoomReset = document.getElementById("btn-zoom-reset");

    this.btnRotCcw = document.getElementById("btn-rot-ccw");
    this.btnRotCw = document.getElementById("btn-rot-cw");
    this.btnFlipH = document.getElementById("btn-flip-h");
    this.btnFlipV = document.getElementById("btn-flip-v");
    this.chkAutoLandscape = document.getElementById("chk-auto-landscape");
    this.sliderFineRot = document.getElementById("slider-fine-rot");
    this.labelFineRotVal = document.getElementById("label-fine-rot-val");
    this.btnCenterPan = document.getElementById("btn-center-pan");
    this.btnResetTransform = document.getElementById("btn-reset-transform");

    // Color & Quality sliders
    this.sliderBrightness = document.getElementById("slider-brightness");
    this.labelBrightness = document.getElementById("label-brightness");
    this.sliderContrast = document.getElementById("slider-contrast");
    this.labelContrast = document.getElementById("label-contrast");
    this.sliderSaturation = document.getElementById("slider-saturation");
    this.labelSaturation = document.getElementById("label-saturation");
    this.sliderQuality = document.getElementById("slider-jpeg-quality");
    this.labelQuality = document.getElementById("label-jpeg-quality");
    this.btnResetColor = document.getElementById("btn-reset-color");

    // Round Sticker Calibration inputs
    this.calibrationSection = document.getElementById("round-calibration-details");
    this.inputCalDiameter = document.getElementById("cal-diameter-mm");
    this.inputCalBleed = document.getElementById("cal-bleed-mm");
    this.inputCalOffsetX = document.getElementById("cal-offset-x-mm");
    this.inputCalTopY = document.getElementById("cal-top-y-mm");
    this.inputCalBottomY = document.getElementById("cal-bottom-y-mm");
    this.btnResetCalibration = document.getElementById("btn-reset-calibration");

    // Print & Export buttons
    this.btnPrintNow = document.getElementById("btn-print-now");
    this.btnDownloadJpeg = document.getElementById("btn-download-zink-jpeg");
    this.btnDownloadPreview = document.getElementById("btn-download-preview-png");
    this.progressContainer = document.getElementById("print-progress-container");
    this.progressBarFill = document.getElementById("print-progress-fill");
    this.progressStatusText = document.getElementById("print-progress-text");
  }

  _bindEvents() {
    // Paper Mode Switching
    this.btnModeFull?.addEventListener("click", () => this.setPaperMode(PAPER_MODE_FULL));
    this.btnModeDualRound?.addEventListener("click", () =>
      this.setPaperMode(PAPER_MODE_DUAL_ROUND)
    );
    this.btnMatchDevicePaper?.addEventListener("click", () => {
      const detected = this.printer.telemetry.detectedPaperMode;
      if (detected) {
        this.setPaperMode(detected, { fromDevice: true });
        this.showToast(
          `Switched UI layout to match loaded printer paper (${this._formatPaperLabel(detected)}).`,
          "success"
        );
      }
    });
    this.btnUpdateTrayToUi?.addEventListener("click", () => {
      const mode = this.state.paperMode;
      this.printer.setPaperTypeOverride(mode);
      if (this.coverClosedPrompt) this.coverClosedPrompt.hidden = true;
      this.showToast(
        `Updated loaded printer tray paper to ${this._formatPaperLabel(mode)}.`,
        "success"
      );
    });
    this.btnConfirmLoadedFull?.addEventListener("click", () => {
      if (this.coverClosedPrompt) this.coverClosedPrompt.hidden = true;
      this.printer.setPaperTypeOverride(PAPER_MODE_FULL);
      this.setPaperMode(PAPER_MODE_FULL, { fromDevice: true });
      this.showToast("Set loaded tray paper to 2×3\" Full Sheet (ZP-2030).", "success");
    });
    this.btnConfirmLoadedRound?.addEventListener("click", () => {
      if (this.coverClosedPrompt) this.coverClosedPrompt.hidden = true;
      this.printer.setPaperTypeOverride(PAPER_MODE_DUAL_ROUND);
      this.setPaperMode(PAPER_MODE_DUAL_ROUND, { fromDevice: true });
      this.showToast("Set loaded tray paper to 2× Round Cutouts (ZP-2030-2C).", "success");
    });
    this.chkShowGuides?.addEventListener("change", (e) => {
      this.state.showGuides = e.target.checked;
      this.requestRender();
    });

    // Slot selection by clicking slot card
    this.slot1Card?.addEventListener("click", (e) => {
      if (e.target.closest("button, label, input")) return;
      this.setActiveSlot("slot1");
    });
    this.slot2Card?.addEventListener("click", (e) => {
      if (e.target.closest("button, label, input")) return;
      this.setActiveSlot("slot2");
    });

    // File upload inputs
    this.fileInputSlot1?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) await this.loadFileIntoSlot("slot1", file);
      e.target.value = "";
    });
    this.fileInputSlot2?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) await this.loadFileIntoSlot("slot2", file);
      e.target.value = "";
    });

    // Drag and drop on Slot Cards and Preview Canvas
    this._setupDropZone(this.slot1Card, "slot1");
    this._setupDropZone(this.slot2Card, "slot2");
    this._setupDropZone(this.previewCanvas, null);

    // Global clipboard paste into active slot (supports Image/SVG/PDF files and raw <svg> markup)
    window.addEventListener("paste", async (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        return;
      }
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              await this.loadFileIntoSlot(this.state.activeSlot, file);
              return;
            }
          }
        }
      }
      const pastedText = e.clipboardData?.getData("text/plain")?.trim();
      if (pastedText && /<svg[\s>]/i.test(pastedText) && /<\/svg>/i.test(pastedText)) {
        const svgFile = new File([pastedText], "Pasted-Vector.svg", {
          type: "image/svg+xml",
        });
        await this.loadFileIntoSlot(this.state.activeSlot, svgFile);
      }
    });

    // Clear & Sample buttons
    this.btnClearSlot1?.addEventListener("click", () => {
      this.state.slots.slot1.media = null;
      this._syncUiFromState();
      this.requestRender();
    });
    this.btnClearSlot2?.addEventListener("click", () => {
      this.state.slots.slot2.media = null;
      this._syncUiFromState();
      this.requestRender();
    });
    this.btnSampleSlot1?.addEventListener("click", () => {
      const preset =
        this.state.paperMode === PAPER_MODE_DUAL_ROUND ? "badge-top" : "photo-card";
      this.state.slots.slot1.media = createSampleMediaSource(preset);
      this.state.slots.slot1.transform = createSlotTransformState();
      this.setActiveSlot("slot1");
      this.requestRender();
    });
    this.btnSampleSlot2?.addEventListener("click", () => {
      this.state.slots.slot2.media = createSampleMediaSource("badge-bottom");
      this.state.slots.slot2.transform = createSlotTransformState();
      this.setActiveSlot("slot2");
      this.requestRender();
    });

    // Image Selection Modal bindings
    this.btnSelectSlot1?.addEventListener("click", () => this.openImageModal("slot1"));
    this.btnSelectSlot2?.addEventListener("click", () => this.openImageModal("slot2"));
    this.btnCloseImageModal?.addEventListener("click", () => this.closeImageModal());
    this.btnCancelImageModal?.addEventListener("click", () => this.closeImageModal());
    let modalBackdropPointerDown = false;
    this.imageModal?.addEventListener("pointerdown", (e) => {
      modalBackdropPointerDown = (e.target === this.imageModal);
    });
    this.imageModal?.addEventListener("click", (e) => {
      if (e.target === this.imageModal && modalBackdropPointerDown) {
        if (Date.now() - (this._modalOpenedTime || 0) > 300) {
          this.closeImageModal();
        }
      }
      modalBackdropPointerDown = false;
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.imageModal && !this.imageModal.hidden) {
        this.closeImageModal();
      }
    });

    this.imageModalFileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      const slot = this.modalTargetSlot || this.state.activeSlot;
      if (file) {
        await this.loadFileIntoSlot(slot, file);
        this.closeImageModal();
      }
      e.target.value = "";
    });

    this.btnImageModalSample?.addEventListener("click", () => {
      const slot = this.modalTargetSlot || this.state.activeSlot;
      const preset =
        this.state.paperMode === PAPER_MODE_DUAL_ROUND
          ? (slot === "slot2" ? "badge-bottom" : "badge-top")
          : "photo-card";
      this.state.slots[slot].media = createSampleMediaSource(preset);
      this.state.slots[slot].transform = createSlotTransformState();
      this.setActiveSlot(slot);
      this.requestRender();
      this.closeImageModal();
      this.showToast(`Loaded sample test image into ${slot === "slot1" ? "Slot #1" : "Slot #2"}.`, "info");
    });

    this.btnImageModalClear?.addEventListener("click", () => {
      const slot = this.modalTargetSlot || this.state.activeSlot;
      this.state.slots[slot].media = null;
      this._syncUiFromState();
      this.requestRender();
      this.closeImageModal();
      this.showToast(`Cleared ${slot === "slot1" ? "Slot #1" : "Slot #2"}.`, "info");
    });

    // Dual-slot helpers
    this.btnCopySlot1To2?.addEventListener("click", () => {
      this.state.slots.slot2.media = this.state.slots.slot1.media;
      this.state.slots.slot2.transform = cloneSlotTransformState(
        this.state.slots.slot1.transform
      );
      this._syncUiFromState();
      this.requestRender();
      this.showToast("Copied Top Circle (#1) image and crop settings to Bottom Circle (#2).", "info");
    });

    this.btnSwapSlots?.addEventListener("click", () => {
      const tempMedia = this.state.slots.slot1.media;
      const tempTransform = this.state.slots.slot1.transform;
      this.state.slots.slot1.media = this.state.slots.slot2.media;
      this.state.slots.slot1.transform = this.state.slots.slot2.transform;
      this.state.slots.slot2.media = tempMedia;
      this.state.slots.slot2.transform = tempTransform;
      this._syncUiFromState();
      this.requestRender();
      this.showToast("Swapped Top (#1) and Bottom (#2) sticker slots.", "info");
    });

    // PDF pagination controls
    this.btnPdfPrev?.addEventListener("click", () => this._stepPdfPage(-1));
    this.btnPdfNext?.addEventListener("click", () => this._stepPdfPage(1));
    this.inputPdfPage?.addEventListener("change", (e) => {
      const targetPage = Number(e.target.value);
      if (Number.isFinite(targetPage)) {
        this._setPdfPage(targetPage);
      }
    });

    // Interactive Canvas Pointer Pan & Wheel Zoom
    this._bindCanvasInteractions();

    // Transform Controls for Active Slot
    this.btnScaleCrop?.addEventListener("click", () => {
      this._activeTransform().scaleMode = "crop";
      this._syncUiFromState();
      this.requestRender();
    });
    this.btnScaleContain?.addEventListener("click", () => {
      this._activeTransform().scaleMode = "contain";
      this._syncUiFromState();
      this.requestRender();
    });

    this.sliderZoom?.addEventListener("input", (e) => {
      const zoomPct = Number(e.target.value);
      this._activeTransform().zoom = zoomPct / 100;
      this.labelZoomVal.textContent = `${zoomPct}%`;
      this.requestRender();
    });
    this.btnZoomOut?.addEventListener("click", () => this._adjustZoom(-0.15));
    this.btnZoomIn?.addEventListener("click", () => this._adjustZoom(0.15));
    this.btnZoomReset?.addEventListener("click", () => {
      this._activeTransform().zoom = 1.0;
      this._syncUiFromState();
      this.requestRender();
    });

    this.btnRotCcw?.addEventListener("click", () => {
      const t = this._activeTransform();
      t.rotation90 = (t.rotation90 + 270) % 360;
      this._syncUiFromState();
      this.requestRender();
    });
    this.btnRotCw?.addEventListener("click", () => {
      const t = this._activeTransform();
      t.rotation90 = (t.rotation90 + 90) % 360;
      this._syncUiFromState();
      this.requestRender();
    });
    this.btnFlipH?.addEventListener("click", () => {
      const t = this._activeTransform();
      t.flipX = !t.flipX;
      this._syncUiFromState();
      this.requestRender();
    });
    this.btnFlipV?.addEventListener("click", () => {
      const t = this._activeTransform();
      t.flipY = !t.flipY;
      this._syncUiFromState();
      this.requestRender();
    });
    this.chkAutoLandscape?.addEventListener("change", (e) => {
      this._activeTransform().autoRotateLandscape = e.target.checked;
      this.requestRender();
    });
    this.sliderFineRot?.addEventListener("input", (e) => {
      const deg = Number(e.target.value);
      this._activeTransform().fineRotation = deg;
      this.labelFineRotVal.textContent = `${deg > 0 ? "+" : ""}${deg.toFixed(1)}°`;
      this.requestRender();
    });

    this.btnCenterPan?.addEventListener("click", () => {
      const t = this._activeTransform();
      t.panX = 0;
      t.panY = 0;
      this.requestRender();
    });

    this.btnResetTransform?.addEventListener("click", () => {
      const slotObj = this.state.slots[this.state.activeSlot];
      const defaultScaleMode = slotObj.media?.kind === "pdf" ? "contain" : "crop";
      slotObj.transform = createSlotTransformState({ scaleMode: defaultScaleMode });
      this._syncUiFromState();
      this.requestRender();
    });

    // Color & JPEG Quality sliders
    this.sliderBrightness?.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      this._activeTransform().brightness = v;
      this.labelBrightness.textContent = `${v}%`;
      this.requestRender();
    });
    this.sliderContrast?.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      this._activeTransform().contrast = v;
      this.labelContrast.textContent = `${v}%`;
      this.requestRender();
    });
    this.sliderSaturation?.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      this._activeTransform().saturation = v;
      this.labelSaturation.textContent = `${v}%`;
      this.requestRender();
    });
    this.sliderQuality?.addEventListener("input", (e) => {
      const qPct = Number(e.target.value);
      this.state.jpegQuality = qPct / 100;
      this.labelQuality.textContent = `${qPct}%`;
      this._schedulePayloadCalculation();
    });
    this.btnResetColor?.addEventListener("click", () => {
      const t = this._activeTransform();
      t.brightness = 100;
      t.contrast = 100;
      t.saturation = 100;
      this.state.jpegQuality = 0.95;
      this._syncUiFromState();
      this.requestRender();
    });

    // Calibration inputs
    const onCalChange = () => {
      this.state.calibration = {
        diameterMm: Number(this.inputCalDiameter.value) || 33.0,
        bleedMm: Number(this.inputCalBleed.value) || 0,
        offsetXMm: Number(this.inputCalOffsetX.value) || 0,
        topOffsetYMm: Number(this.inputCalTopY.value) || 0,
        bottomOffsetYMm: Number(this.inputCalBottomY.value) || 0,
      };
      saveStickerCalibration(this.state.calibration);
      this.requestRender();
    };
    this.inputCalDiameter?.addEventListener("input", onCalChange);
    this.inputCalBleed?.addEventListener("input", onCalChange);
    this.inputCalOffsetX?.addEventListener("input", onCalChange);
    this.inputCalTopY?.addEventListener("input", onCalChange);
    this.inputCalBottomY?.addEventListener("input", onCalChange);
    this.btnResetCalibration?.addEventListener("click", () => {
      this.state.calibration = getDefaultStickerCalibration();
      saveStickerCalibration(this.state.calibration);
      this._syncUiFromState();
      this.requestRender();
      this.showToast("Round sticker calibration reset to factory defaults (Ø 33mm, +2mm bleed).", "info");
    });

    // Print & Download actions
    this.btnPrintNow?.addEventListener("click", () => this.executePrint());
    this.btnDownloadJpeg?.addEventListener("click", () => this.downloadZinkJpeg());
    this.btnDownloadPreview?.addEventListener("click", () => this.downloadPreviewPng());
  }

  _setupDropZone(element, targetSlotId = null) {
    if (!element) return;
    element.addEventListener("dragover", (e) => {
      e.preventDefault();
      element.classList.add("drag-over");
    });
    element.addEventListener("dragleave", () => {
      element.classList.remove("drag-over");
    });
    element.addEventListener("drop", async (e) => {
      e.preventDefault();
      element.classList.remove("drag-over");
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;

      // If dropped onto the canvas directly, determine which slot was targeted
      let slotId = targetSlotId;
      if (!slotId && element === this.previewCanvas) {
        const coords = this._clientToCanvasCoords(e.clientX, e.clientY);
        slotId = hitTestSlot(coords.x, coords.y, this.state.paperMode, this.state.calibration);
      }
      slotId = slotId || this.state.activeSlot;

      await this.loadFileIntoSlot(slotId, files[0]);
      // If user dropped 2 files at once in Dual Round mode, load the second file into the other slot!
      if (files.length >= 2 && this.state.paperMode === PAPER_MODE_DUAL_ROUND) {
        const otherSlot = slotId === "slot1" ? "slot2" : "slot1";
        await this.loadFileIntoSlot(otherSlot, files[1]);
      }
    });
  }

  _clientToCanvasCoords(clientX, clientY) {
    const rect = this.previewCanvas.getBoundingClientRect();
    const scaleX = PREVIEW_WIDTH / Math.max(1, rect.width);
    const scaleY = PREVIEW_HEIGHT / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      scaleX,
      scaleY,
    };
  }

  _bindCanvasInteractions() {
    if (!this.previewCanvas) return;

    this._activePointers = new Map();
    this._gestureState = null;

    const initGestureBaseline = () => {
      const pointers = Array.from(this._activePointers.values());
      const rect = this.previewCanvas.getBoundingClientRect();
      const scaleX = PREVIEW_WIDTH / Math.max(1, rect.width);
      const scaleY = PREVIEW_HEIGHT / Math.max(1, rect.height);
      const t = this._activeTransform();

      if (pointers.length === 1) {
        this._gestureState = {
          mode: "pan",
          startX: pointers[0].clientX,
          startY: pointers[0].clientY,
          initialPanX: t.panX,
          initialPanY: t.panY,
          scaleX,
          scaleY,
        };
      } else if (pointers.length >= 2) {
        const [p1, p2] = pointers;
        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;
        const dist = Math.max(10, Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY));
        this._gestureState = {
          mode: "pinch",
          startMidX: midX,
          startMidY: midY,
          startDist: dist,
          initialZoom: t.zoom,
          initialPanX: t.panX,
          initialPanY: t.panY,
          scaleX,
          scaleY,
        };
      } else {
        this._gestureState = null;
      }
    };

    let tapStartX = 0;
    let tapStartY = 0;
    let tapStartTime = 0;
    let tapMoved = false;

    this.previewCanvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const coords = this._clientToCanvasCoords(e.clientX, e.clientY);

      tapStartX = e.clientX;
      tapStartY = e.clientY;
      tapStartTime = Date.now();
      tapMoved = false;

      if (this._activePointers.size === 0) {
        const clickedSlot = hitTestSlot(
          coords.x,
          coords.y,
          this.state.paperMode,
          this.state.calibration
        );
        if (clickedSlot !== this.state.activeSlot) {
          this.setActiveSlot(clickedSlot);
        }
      }

      this._activePointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (this._activePointers.size > 1) {
        tapMoved = true;
      }

      try {
        this.previewCanvas.setPointerCapture(e.pointerId);
      } catch (_) {
        // Ignore pointer capture errors on synthetic events
      }
      this.previewCanvas.classList.add("is-dragging");
      initGestureBaseline();
    });

    this.previewCanvas.addEventListener("pointermove", (e) => {
      if (!this._activePointers.has(e.pointerId)) return;
      this._activePointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (!tapMoved) {
        const dist = Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY);
        if (dist > 12) {
          tapMoved = true;
        }
      }

      if (!this._gestureState) return;
      const t = this._activeTransform();
      const pointers = Array.from(this._activePointers.values());

      if (this._gestureState.mode === "pinch" && pointers.length >= 2) {
        const [p1, p2] = pointers;
        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;
        const dist = Math.max(10, Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY));

        const zoomRatio = dist / this._gestureState.startDist;
        t.zoom = Math.max(
          0.25,
          Math.min(5.0, Number((this._gestureState.initialZoom * zoomRatio).toFixed(2)))
        );

        const dx = (midX - this._gestureState.startMidX) * this._gestureState.scaleX;
        const dy = (midY - this._gestureState.startMidY) * this._gestureState.scaleY;
        t.panX = Math.round(this._gestureState.initialPanX + dx);
        t.panY = Math.round(this._gestureState.initialPanY + dy);

        this._syncUiFromState();
        this.requestRender();
      } else if (this._gestureState.mode === "pan" && pointers.length === 1) {
        const dx = (e.clientX - this._gestureState.startX) * this._gestureState.scaleX;
        const dy = (e.clientY - this._gestureState.startY) * this._gestureState.scaleY;

        t.panX = Math.round(this._gestureState.initialPanX + dx);
        t.panY = Math.round(this._gestureState.initialPanY + dy);
        this.requestRender();
      }
    });

    const endPointer = (e) => {
      if (!this._activePointers.has(e.pointerId)) return;
      this._activePointers.delete(e.pointerId);
      try {
        this.previewCanvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        // Ignore
      }

      const isSingleTap = !tapMoved && (Date.now() - tapStartTime < 500);

      if (this._activePointers.size === 0) {
        this.previewCanvas.classList.remove("is-dragging");
        this._gestureState = null;
      } else {
        tapMoved = true;
        initGestureBaseline();
      }

      if (isSingleTap) {
        const coords = this._clientToCanvasCoords(tapStartX, tapStartY);
        const clickedSlot = hitTestSlot(
          coords.x,
          coords.y,
          this.state.paperMode,
          this.state.calibration
        );
        this.openImageModal(clickedSlot);
      }
    };

    const cancelPointer = (e) => {
      tapMoved = true;
      endPointer(e);
    };

    this.previewCanvas.addEventListener("pointerup", endPointer);
    this.previewCanvas.addEventListener("pointercancel", cancelPointer);

    // Wheel zoom on preview canvas
    this.previewCanvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const coords = this._clientToCanvasCoords(e.clientX, e.clientY);
        const hoveredSlot = hitTestSlot(
          coords.x,
          coords.y,
          this.state.paperMode,
          this.state.calibration
        );
        if (hoveredSlot !== this.state.activeSlot) {
          this.setActiveSlot(hoveredSlot);
        }
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        this._adjustZoom(delta);
      },
      { passive: false }
    );
  }

  _activeTransform() {
    return this.state.slots[this.state.activeSlot].transform;
  }

  _adjustZoom(delta) {
    const t = this._activeTransform();
    t.zoom = Math.max(0.25, Math.min(5.0, Number((t.zoom + delta).toFixed(2))));
    this._syncUiFromState();
    this.requestRender();
  }

  _formatPaperLabel(mode) {
    return mode === PAPER_MODE_DUAL_ROUND
      ? "2× Round Cutouts (ZP-2030-2C)"
      : "2×3\" Full Sheet (ZP-2030)";
  }

  setPaperMode(mode, { fromDevice = false } = {}) {
    if (this.state.paperMode === mode) {
      this.updatePrintButtonState();
      if (this.onPaperModeChanged) this.onPaperModeChanged(mode);
      return;
    }
    this.state.paperMode = mode;

    if (mode === PAPER_MODE_FULL) {
      this.state.activeSlot = "slot1";
    } else if (
      this.state.slots.slot1.media?.name === "Sample-2x3-Calibration.png"
    ) {
      // Switch default sample card to the round top sticker badge when entering Dual Round mode
      this.state.slots.slot1.media = createSampleMediaSource("badge-top");
      this.state.slots.slot1.transform = createSlotTransformState();
    }

    this._syncUiFromState();
    this.requestRender();

    if (this.onPaperModeChanged) {
      this.onPaperModeChanged(mode);
    }

    if (!fromDevice && this.printer.isConnected()) {
      const detected = this.printer.telemetry.detectedPaperMode;
      if (detected && detected !== mode) {
        this.showToast(
          `Warning: UI layout (${this._formatPaperLabel(mode)}) does not match the paper loaded in the printer (${this._formatPaperLabel(detected)})!`,
          "warn"
        );
      }
    }
  }

  setActiveSlot(slotId) {
    if (this.state.paperMode === PAPER_MODE_FULL) {
      slotId = "slot1";
    }
    this.state.activeSlot = slotId;
    this._syncUiFromState();
    this.requestRender();
  }

  openImageModal(slotId) {
    if (this.state.paperMode === PAPER_MODE_FULL) {
      slotId = "slot1";
    }
    this.modalTargetSlot = slotId;
    this.setActiveSlot(slotId);

    if (this.imageModalTitle) {
      if (this.state.paperMode === PAPER_MODE_DUAL_ROUND) {
        this.imageModalTitle.textContent =
          slotId === "slot1"
            ? "Select Image — Top Sticker (#1)"
            : "Select Image — Bottom Sticker (#2)";
      } else {
        this.imageModalTitle.textContent = "Select Image — 2×3\" Full Sheet";
      }
    }

    if (this.imageModalSubtitle) {
      if (this.state.paperMode === PAPER_MODE_DUAL_ROUND) {
        this.imageModalSubtitle.textContent =
          slotId === "slot1"
            ? "Choose an image, vector or PDF for the top circular sticker (Ø 33mm):"
            : "Choose an image, vector or PDF for the bottom circular sticker (Ø 33mm):";
      } else {
        this.imageModalSubtitle.textContent =
          "Choose an image, vector or PDF for the 2×3\" photo print:";
      }
    }

    const currentMedia = this.state.slots[slotId]?.media;
    if (this.imageModalMeta) {
      this.imageModalMeta.textContent = this._formatSlotMeta(currentMedia);
    }

    if (this.btnImageModalClear) {
      this.btnImageModalClear.disabled = !currentMedia;
    }

    this._modalOpenedTime = Date.now();
    setTimeout(() => {
      if (this.imageModal && this.modalTargetSlot) {
        this.imageModal.hidden = false;
        this._modalOpenedTime = Date.now();
      }
    }, 20);
  }

  closeImageModal() {
    if (this.imageModal) {
      this.imageModal.hidden = true;
    }
    this.modalTargetSlot = null;
    this._modalOpenedTime = 0;
  }

  async loadFileIntoSlot(slotId, file) {
    try {
      const media = await loadMediaFile(file, 1);
      const defaultScaleMode =
        media.kind === "pdf" || media.kind === "svg" ? "contain" : "crop";
      this.state.slots[slotId] = {
        media,
        transform: createSlotTransformState({ scaleMode: defaultScaleMode }),
      };
      this.setActiveSlot(slotId);
      this.requestRender();
      const extraInfo =
        media.kind === "pdf"
          ? `, ${media.numPages} pages`
          : media.kind === "svg"
            ? `, SVG Vector ${media.intrinsicWidth}×${media.intrinsicHeight} → ${media.width}×${media.height}px`
            : "";
      this.showToast(
        `Loaded "${media.name}" (${media.width}×${media.height}${extraInfo}) into ${slotId === "slot1" ? "Slot #1" : "Slot #2"}.`,
        "success"
      );
    } catch (err) {
      this.showToast(err.message || "Failed to load file.", "error");
    }
  }

  async _stepPdfPage(delta) {
    const slotObj = this.state.slots[this.state.activeSlot];
    if (!slotObj.media || slotObj.media.kind !== "pdf") return;
    const nextPage = slotObj.media.currentPage + delta;
    await this._setPdfPage(nextPage);
  }

  async _setPdfPage(pageNumber) {
    const slotObj = this.state.slots[this.state.activeSlot];
    if (!slotObj.media || slotObj.media.kind !== "pdf") return;
    try {
      slotObj.media = await changePdfMediaPage(slotObj.media, pageNumber);
      this._syncUiFromState();
      this.requestRender();
    } catch (err) {
      this.showToast(err.message, "error");
    }
  }

  _formatSlotMeta(media) {
    if (!media) return "No image selected";
    if (media.kind === "pdf") {
      return `${media.name} (${media.width}×${media.height} • Page ${media.currentPage}/${media.numPages})`;
    }
    if (media.kind === "svg") {
      return `${media.name} (SVG Vector ${media.intrinsicWidth}×${media.intrinsicHeight} • ${media.width}×${media.height}px)`;
    }
    return `${media.name} (${media.width}×${media.height})`;
  }

  _syncUiFromState() {
    const isDualRound = this.state.paperMode === PAPER_MODE_DUAL_ROUND;

    this.btnModeFull?.classList.toggle("active", !isDualRound);
    this.btnModeDualRound?.classList.toggle("active", isDualRound);

    if (this.dualRoundToolbar) this.dualRoundToolbar.hidden = !isDualRound;
    if (this.slot2Card) this.slot2Card.hidden = !isDualRound;

    if (this.slot1Title) {
      this.slot1Title.textContent = isDualRound
        ? "Sticker #1 — Top Circle (Ø 33mm)"
        : "Full 2×3\" Sheet Media (50 × 76 mm)";
    }

    if (this.canvasCaption) {
      this.canvasCaption.textContent = isDualRound
        ? "ZP-2030-2C Dual Round Stickers (Tap circle to select image • Drag to pan • Pinch/scroll to zoom)"
        : "ZP-2030 Full 2×3\" Sheet (Tap preview to select image • Drag to pan • Pinch/scroll to zoom)";
    }

    // Highlight active slot card
    this.slot1Card?.classList.toggle("slot-active", this.state.activeSlot === "slot1");
    this.slot2Card?.classList.toggle(
      "slot-active",
      isDualRound && this.state.activeSlot === "slot2"
    );

    // File metadata labels
    const m1 = this.state.slots.slot1.media;
    const m2 = this.state.slots.slot2.media;
    if (this.slot1FileMeta) {
      this.slot1FileMeta.textContent = this._formatSlotMeta(m1);
    }
    if (this.slot2FileMeta) {
      this.slot2FileMeta.textContent = this._formatSlotMeta(m2);
    }

    // Active slot transform badge & controls
    const activeMedia = this.state.slots[this.state.activeSlot].media;
    const t = this._activeTransform();

    if (this.activeSlotLabel) {
      if (!isDualRound) {
        this.activeSlotLabel.textContent = "Full Sheet";
        this.activeSlotLabel.classList.add("slot-badge-full");
      } else {
        this.activeSlotLabel.textContent =
          this.state.activeSlot === "slot1"
            ? "Sticker #1 (Top)"
            : "Sticker #2 (Bottom)";
        this.activeSlotLabel.classList.remove("slot-badge-full");
      }
    }

    // PDF pagination bar visibility
    if (this.pdfControlsBox) {
      const isPdf = activeMedia && activeMedia.kind === "pdf";
      this.pdfControlsBox.hidden = !isPdf;
      if (isPdf) {
        this.inputPdfPage.value = String(activeMedia.currentPage);
        this.inputPdfPage.max = String(activeMedia.numPages);
        this.labelPdfTotal.textContent = `of ${activeMedia.numPages}`;
        this.btnPdfPrev.disabled = activeMedia.currentPage <= 1;
        this.btnPdfNext.disabled = activeMedia.currentPage >= activeMedia.numPages;
      }
    }

    // Crop vs Contain buttons
    this.btnScaleCrop?.classList.toggle("active", t.scaleMode === "crop");
    this.btnScaleContain?.classList.toggle("active", t.scaleMode === "contain");

    // Zoom slider
    const zoomPct = Math.round(t.zoom * 100);
    if (this.sliderZoom) this.sliderZoom.value = String(zoomPct);
    if (this.labelZoomVal) this.labelZoomVal.textContent = `${zoomPct}%`;

    // Rotation & Flip
    this.btnFlipH?.classList.toggle("active", Boolean(t.flipX));
    this.btnFlipV?.classList.toggle("active", Boolean(t.flipY));
    if (this.chkAutoLandscape) this.chkAutoLandscape.checked = Boolean(t.autoRotateLandscape);
    if (this.sliderFineRot) this.sliderFineRot.value = String(t.fineRotation);
    if (this.labelFineRotVal) {
      this.labelFineRotVal.textContent = `${t.fineRotation > 0 ? "+" : ""}${Number(t.fineRotation).toFixed(1)}°`;
    }

    // Color & Quality
    if (this.sliderBrightness) this.sliderBrightness.value = String(t.brightness);
    if (this.labelBrightness) this.labelBrightness.textContent = `${t.brightness}%`;
    if (this.sliderContrast) this.sliderContrast.value = String(t.contrast);
    if (this.labelContrast) this.labelContrast.textContent = `${t.contrast}%`;
    if (this.sliderSaturation) this.sliderSaturation.value = String(t.saturation);
    if (this.labelSaturation) this.labelSaturation.textContent = `${t.saturation}%`;

    const qPct = Math.round(this.state.jpegQuality * 100);
    if (this.sliderQuality) this.sliderQuality.value = String(qPct);
    if (this.labelQuality) this.labelQuality.textContent = `${qPct}%`;

    // Calibration inputs
    const cal = this.state.calibration;
    if (this.inputCalDiameter) this.inputCalDiameter.value = String(cal.diameterMm);
    if (this.inputCalBleed) this.inputCalBleed.value = String(cal.bleedMm);
    if (this.inputCalOffsetX) this.inputCalOffsetX.value = String(cal.offsetXMm);
    if (this.inputCalTopY) this.inputCalTopY.value = String(cal.topOffsetYMm);
    if (this.inputCalBottomY) this.inputCalBottomY.value = String(cal.bottomOffsetYMm);

    this.updatePrintButtonState();
  }

  showCoverClosedPrompt() {
    if (this.coverClosedPrompt) {
      this.coverClosedPrompt.hidden = false;
    }
    this.showToast(
      "Printer Top Cover closed — select which ZINK paper pack is now in the tray.",
      "info"
    );
  }

  updatePrintButtonState() {
    const isConn = this.printer.isConnected();
    if (!isConn && this.coverClosedPrompt) {
      this.coverClosedPrompt.hidden = true;
    }
    const detected = isConn ? this.printer.telemetry.detectedPaperMode : null;
    const isMismatch = Boolean(
      isConn && !this.printer.telemetry.isNoPaper && detected && detected !== this.state.paperMode
    );

    if (this.mismatchBanner) {
      this.mismatchBanner.hidden = !isMismatch;
      if (isMismatch) {
        const devLabel = this._formatPaperLabel(detected);
        const uiLabel = this._formatPaperLabel(this.state.paperMode);
        if (this.mismatchText) {
          this.mismatchText.textContent = `Loaded tray paper is set to ${devLabel}, but the editor is set to ${uiLabel}. If you just swapped the paper in the printer, click "I Loaded This Paper in Printer" below.`;
        }
        if (this.btnMatchDevicePaper) {
          this.btnMatchDevicePaper.textContent = `Switch UI to ${devLabel}`;
        }
      }
    }

    if (!this.btnPrintNow) return;
    this.btnPrintNow.disabled = !isConn;
    this.btnPrintNow.classList.toggle("btn-warn", isMismatch);
    this.btnPrintNow.classList.toggle("btn-primary", !isMismatch);

    if (!isConn) {
      this.btnPrintNow.textContent = "Connect Printer to Print";
    } else if (isMismatch) {
      const devShort =
        detected === PAPER_MODE_DUAL_ROUND ? "2× Circles Loaded" : "2×3\" Sheet Loaded";
      this.btnPrintNow.textContent = `⚠ Print Anyway — Paper Mismatch (${devShort})`;
    } else if (this.printer.telemetry.isSimulator) {
      this.btnPrintNow.textContent =
        this.state.paperMode === PAPER_MODE_DUAL_ROUND
          ? "Simulate Print (Dual Round Stickers)"
          : "Simulate Print (2×3\" Sheet)";
    } else {
      this.btnPrintNow.textContent =
        this.state.paperMode === PAPER_MODE_DUAL_ROUND
          ? "Print Dual Round Stickers Now"
          : "Print 2×3\" Photo Now";
    }
  }

  requestRender() {
    if (!this.previewCanvas) return;
    renderInteractivePreview(this.previewCanvas, this.state);
    this._schedulePayloadCalculation();
  }

  _schedulePayloadCalculation() {
    if (this._payloadDebounceTimer) {
      clearTimeout(this._payloadDebounceTimer);
    }
    this._payloadDebounceTimer = setTimeout(async () => {
      try {
        const res = await buildZinkPrintJpeg(this.state, this.state.jpegQuality);
        this._cachedPayloadInfo = res;
        if (this.payloadSizeBadge) {
          const kb = (res.jpegBytes.length / 1024).toFixed(1);
          const chunks = Math.ceil(res.jpegBytes.length / 990);
          this.payloadSizeBadge.textContent = `640×1616 • ${kb} KB`;
          this.payloadSizeBadge.title = `ZINK Output: 640×1616 (180°) • ${kb} KB in ${chunks} RFCOMM chunks`;
        }
      } catch (_) {
        // Ignore transient encoding errors
      }
    }, 120);
  }

  async executePrint() {
    if (!this.printer.isConnected()) {
      this.showToast("Please connect to the Zoemini 2 / Ivy 2 or Simulator first.", "warn");
      return;
    }

    const detected = this.printer.telemetry.detectedPaperMode;
    if (detected && !this.printer.telemetry.isNoPaper && detected !== this.state.paperMode) {
      const devLabel = this._formatPaperLabel(detected);
      const uiLabel = this._formatPaperLabel(this.state.paperMode);
      const proceed = window.confirm(
        `Paper Type Mismatch Warning:\n\n` +
          `• Loaded in Printer: ${devLabel}\n` +
          `• Selected in UI: ${uiLabel}\n\n` +
          `Press OK to print anyway with the mismatched layout, or Cancel to switch the UI layout first.`
      );
      if (!proceed) {
        return;
      }
    }

    this.btnPrintNow.disabled = true;
    if (this.progressContainer) this.progressContainer.hidden = false;

    try {
      const { jpegBytes } = await buildZinkPrintJpeg(this.state, this.state.jpegQuality);

      await this.printer.print(jpegBytes, ({ phase, percent }) => {
        if (this.progressBarFill) {
          this.progressBarFill.style.width = `${percent}%`;
        }
        if (this.progressStatusText) {
          this.progressStatusText.textContent = `${phase} (${percent}%)`;
        }
      });

      this.showToast("Print job completed!", "success");
    } catch (err) {
      this.showToast(err.message || "Print failed.", "error");
      if (this.progressStatusText) {
        this.progressStatusText.textContent = `Error: ${err.message}`;
      }
    } finally {
      this.updatePrintButtonState();
      setTimeout(() => {
        if (this.progressContainer) this.progressContainer.hidden = true;
      }, 3500);
    }
  }

  async downloadZinkJpeg() {
    try {
      const { jpegBlob } = await buildZinkPrintJpeg(this.state, this.state.jpegQuality);
      const url = URL.createObjectURL(jpegBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zoemini2-640x1616-${this.state.paperMode}-${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast("Downloaded 640×1616 (180° rotated) ZINK hardware JPEG.", "info");
    } catch (err) {
      this.showToast(err.message, "error");
    }
  }

  async downloadPreviewPng() {
    try {
      const { compositionCanvas } = await buildZinkPrintJpeg(this.state, this.state.jpegQuality);
      compositionCanvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `zoemini2-preview-1280x1920-${this.state.paperMode}-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch (err) {
      this.showToast(err.message, "error");
    }
  }
}
