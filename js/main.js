/**
 * Zoemini 2 / Ivy 2 Web Print Studio — Application Bootstrap
 */

import { ZoeminiPrinter } from "./protocol/printer-client.js";
import { PAPER_MODE_DUAL_ROUND } from "./protocol/constants.js";
import { DebugConsole } from "./ui/debug-console.js";
import { StatusPanel } from "./ui/status-panel.js";
import { PreviewEditor } from "./ui/preview-editor.js";

const PWA_BANNER_DISMISSED_KEY = "zoemini2_android_pwa_banner_dismissed_v1";

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

function initAndroidPwaBanner() {
  const banner = document.getElementById("android-pwa-banner");
  const btnInstall = document.getElementById("btn-install-pwa");
  const btnDismiss = document.getElementById("btn-dismiss-pwa-banner");
  if (!banner) return;

  const isAndroid = /Android/i.test(navigator.userAgent || "");
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;

  let isDismissed = false;
  try {
    isDismissed = localStorage.getItem(PWA_BANNER_DISMISSED_KEY) === "1";
  } catch (_) {
    // Ignore storage restriction
  }

  let deferredInstallPrompt = null;

  if (isAndroid && !isStandalone && !isDismissed) {
    banner.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstall) {
      btnInstall.hidden = false;
    }
    if (isAndroid && !isStandalone && !isDismissed) {
      banner.hidden = false;
    }
  });

  btnInstall?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (btnInstall) btnInstall.hidden = true;
    if (outcome === "accepted") {
      banner.hidden = true;
      try {
        localStorage.setItem(PWA_BANNER_DISMISSED_KEY, "1");
      } catch (_) {
        // Ignore
      }
    }
  });

  btnDismiss?.addEventListener("click", () => {
    banner.hidden = true;
    try {
      localStorage.setItem(PWA_BANNER_DISMISSED_KEY, "1");
    } catch (_) {
      // Ignore
    }
  });

  window.addEventListener("appinstalled", () => {
    banner.hidden = true;
    try {
      localStorage.setItem(PWA_BANNER_DISMISSED_KEY, "1");
    } catch (_) {
      // Ignore
    }
    showToast("App installed! You can now share photos directly from your Android Gallery.", "success");
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initAndroidPwaBanner();

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

  // Expose debug handle on window for console inspection / automated verification
  window.__zoeminiApp = {
    printer,
    statusPanel,
    previewEditor,
    debugConsole,
  };
});


