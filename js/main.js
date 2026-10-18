/**
 * Zoemini 2 / Ivy 2 Web Print Studio — Application Bootstrap
 */

import { ZoeminiPrinter } from "./protocol/printer-client.js";
import { PAPER_MODE_DUAL_ROUND } from "./protocol/constants.js";
import { DebugConsole } from "./ui/debug-console.js";
import { StatusPanel } from "./ui/status-panel.js";
import { PreviewEditor } from "./ui/preview-editor.js";

const APK_BANNER_DISMISSED_KEY = "zoemini2_android_apk_banner_dismissed_v1";

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 280);
  }, 4200);
}

function initAndroidApkBanner() {
  const banner = document.getElementById("android-apk-banner");
  const btnDismiss = document.getElementById("btn-dismiss-apk-banner");
  if (!banner) return;

  // If running inside the native Android WebView bridge, hide the web hint banner
  if (typeof window !== "undefined" && window.AndroidBluetoothSerial) {
    banner.hidden = true;
    return;
  }

  const isAndroid = /Android/i.test(navigator.userAgent || "");
  let isDismissed = false;
  try {
    isDismissed = localStorage.getItem(APK_BANNER_DISMISSED_KEY) === "1";
  } catch (_) {
    // Ignore storage restriction
  }

  if (isAndroid && !isDismissed) {
    banner.hidden = false;
  }

  btnDismiss?.addEventListener("click", () => {
    banner.hidden = true;
    try {
      localStorage.setItem(APK_BANNER_DISMISSED_KEY, "1");
    } catch (_) {
      // Ignore
    }
  });
}

function initNavigation() {
  const viewStudio = document.getElementById("view-studio");
  const viewTelemetry = document.getElementById("view-telemetry");
  const btnOpenTelemetry = document.getElementById("menu-btn-telemetry");
  const btnBackToStudio = document.getElementById("btn-back-to-studio");
  const headerMoreMenu = document.getElementById("header-more-menu");

  function setView(viewName) {
    if (viewName === "telemetry") {
      if (viewStudio) viewStudio.hidden = true;
      if (viewTelemetry) viewTelemetry.hidden = false;
      window.scrollTo({ top: 0, behavior: "instant" });
    } else {
      if (viewStudio) viewStudio.hidden = false;
      if (viewTelemetry) viewTelemetry.hidden = true;
    }
  }

  function handleHash() {
    if (window.location.hash === "#telemetry") {
      setView("telemetry");
    } else {
      setView("studio");
    }
  }

  btnOpenTelemetry?.addEventListener("click", () => {
    if (headerMoreMenu) headerMoreMenu.open = false;
    window.location.hash = "#telemetry";
  });

  btnBackToStudio?.addEventListener("click", () => {
    if (window.location.hash === "#telemetry") {
      window.history.back();
    } else {
      window.location.hash = "";
    }
  });

  window.addEventListener("hashchange", handleHash);
  handleHash();
}

function initMobileStudioTabs() {
  const tabMedia = document.getElementById("tab-btn-media");
  const tabCrop = document.getElementById("tab-btn-crop");
  const colLeft = document.querySelector(".col-left");
  const colRight = document.querySelector(".col-right");

  if (!tabMedia || !tabCrop || !colLeft || !colRight) return;

  function switchTab(activeTab) {
    if (activeTab === "media") {
      tabMedia.classList.add("active");
      tabCrop.classList.remove("active");
      colLeft.classList.remove("mobile-tab-hidden");
      colRight.classList.add("mobile-tab-hidden");
    } else {
      tabCrop.classList.add("active");
      tabMedia.classList.remove("active");
      colRight.classList.remove("mobile-tab-hidden");
      colLeft.classList.add("mobile-tab-hidden");
    }
  }

  tabMedia.addEventListener("click", () => switchTab("media"));
  tabCrop.addEventListener("click", () => switchTab("crop"));

  // Default to media tab on mobile
  switchTab("media");
}

window.addEventListener("DOMContentLoaded", () => {
  initAndroidApkBanner();
  initNavigation();
  initMobileStudioTabs();

  const debugConsole = new DebugConsole();

  let statusPanel = null;
  let previewEditor = null;

  const printer = new ZoeminiPrinter({
    onStateChange: (telemetry) => {
      if (statusPanel) statusPanel.renderTelemetry(telemetry);
      if (previewEditor) previewEditor.updatePrintButtonState();
    },
    onPaperModeDetected: (detectedMode) => {
      if (!previewEditor) return;
      const previousMode = previewEditor.state.paperMode;
      previewEditor.setPaperMode(detectedMode, { fromDevice: true });
      const label =
        detectedMode === PAPER_MODE_DUAL_ROUND
          ? "2× Round Cutouts (ZP-2030-2C)"
          : "2×3\" Full Sheet (ZP-2030)";
      if (previousMode !== detectedMode) {
        showToast(
          `Switched UI layout to match loaded tray paper (${label}).`,
          "info"
        );
      }
    },
    onCoverClosed: () => {
      if (previewEditor) {
        previewEditor.showCoverClosedPrompt();
      }
    },
  });

  statusPanel = new StatusPanel({
    printer,
    debugConsole,
    showToast,
    getUiPaperMode: () => (previewEditor ? previewEditor.state.paperMode : null),
    onConnectionChanged: () => {
      if (previewEditor) previewEditor.updatePrintButtonState();
      if (statusPanel) statusPanel.renderTelemetry(printer.telemetry);
    },
  });

  previewEditor = new PreviewEditor({
    printer,
    showToast,
    onPaperModeChanged: () => {
      if (statusPanel) statusPanel.renderTelemetry(printer.telemetry);
    },
  });

  if (printer.telemetry.paperTypeOverride) {
    previewEditor.setPaperMode(printer.telemetry.paperTypeOverride, { fromDevice: true });
  }
  statusPanel.renderTelemetry(printer.telemetry);

  // Register Service Worker for Android PWA Web Share Target support
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker registration skipped:", err.message);
    });
  }

  // Handle incoming Android Web Share Target redirect (?received_share=true)
  (async () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("received_share") === "true" && "caches" in window) {
      try {
        const cache = await caches.open("shared-media");
        const response1 = await cache.match("/shared-image-temp");
        const response2 = await cache.match("/shared-image-temp-2");

        if (response1) {
          const blob1 = await response1.blob();
          const name1 = decodeURIComponent(
            response1.headers.get("x-file-name") || "Shared-Image.jpg"
          );
          await cache.delete("/shared-image-temp");
          const file1 = new File([blob1], name1, {
            type: blob1.type || response1.headers.get("content-type") || "image/jpeg",
          });

          if (response2) {
            const blob2 = await response2.blob();
            const name2 = decodeURIComponent(
              response2.headers.get("x-file-name") || "Shared-Image-2.jpg"
            );
            await cache.delete("/shared-image-temp-2");
            const file2 = new File([blob2], name2, {
              type: blob2.type || response2.headers.get("content-type") || "image/jpeg",
            });

            // If 2 files were shared at once, switch to Dual Round Stickers and populate both slots
            previewEditor.setPaperMode(PAPER_MODE_DUAL_ROUND);
            await previewEditor.loadFileIntoSlot("slot1", file1);
            await previewEditor.loadFileIntoSlot("slot2", file2);
          } else {
            await previewEditor.loadFileIntoSlot(previewEditor.state.activeSlot, file1);
          }
        }
      } catch (err) {
        showToast(`Failed to load shared image: ${err.message}`, "error");
      } finally {
        // Clean up ?received_share=true from the URL bar
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  })();

  // Listen for native Android share sheet intent events
  window.addEventListener("android-shared-media", async (e) => {
    try {
      const { slot, dataUrl } = e.detail;
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "shared-photo.jpg", { type: blob.type || "image/jpeg" });
      if (previewEditor) {
        if (slot === "slot2") {
          previewEditor.setPaperMode(PAPER_MODE_DUAL_ROUND);
        }
        await previewEditor.loadFileIntoSlot(slot, file);
        showToast(`Loaded shared photo into ${slot === "slot2" ? "Sticker #2" : "editor"}.`, "success");
      }
    } catch (err) {
      console.warn("Failed to process android-shared-media:", err);
    }
  });

  // Expose debug handle on window for console inspection / automated verification
  window.__zoeminiApp = {
    printer,
    statusPanel,
    previewEditor,
    debugConsole,
  };
});


