import { BarcodeFormat, BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";

const FORMATS = [
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Code93,
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.Itf,
  BarcodeFormat.QrCode,
  BarcodeFormat.DataMatrix,
  BarcodeFormat.Pdf417
];

function mountOverlay(onCancel) {
  const el = document.createElement("div");
  el.className = "scan-overlay";
  el.innerHTML = `
    <div class="scan-top">
      <p>Point the camera at a barcode</p>
      <button type="button" data-cancel>Cancel</button>
    </div>
    <div class="scan-frame"></div>
    <div class="scan-hint">Barcodes are read on this device — no internet needed.</div>
  `;
  el.querySelector("[data-cancel]").addEventListener("click", onCancel);
  document.body.appendChild(el);
  document.documentElement.classList.add("scanning");
  document.body.classList.add("scanning");
  return el;
}

function unmountOverlay(el) {
  document.documentElement.classList.remove("scanning");
  document.body.classList.remove("scanning");
  el?.remove();
}

/**
 * Scan a barcode with an in-app camera preview. Uses the bundled ML Kit model,
 * so it works without Google Play Services or a network connection.
 */
export async function scanBarcode() {
  const { supported } = await BarcodeScanner.isSupported();
  if (!supported) throw new Error("Camera barcode scanning is not supported on this device.");
  const permission = await BarcodeScanner.requestPermissions();
  if (permission.camera !== "granted" && permission.camera !== "limited") {
    throw new Error("Camera permission is needed to scan barcodes.");
  }

  return new Promise((resolve, reject) => {
    let overlay;
    let listener;
    let finished = false;

    const cleanup = async () => {
      window.__barkaatiScanning = false;
      window.removeEventListener("barkaati-scan-cancel", cancel);
      unmountOverlay(overlay);
      try {
        await listener?.remove();
      } catch {
        /* ignore */
      }
      try {
        await BarcodeScanner.stopScan();
      } catch {
        /* ignore */
      }
    };

    const finish = async (value, error) => {
      if (finished) return;
      finished = true;
      await cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const cancel = () => finish("", new Error("Scan cancelled."));

    (async () => {
      try {
        window.__barkaatiScanning = true;
        window.addEventListener("barkaati-scan-cancel", cancel);
        listener = await BarcodeScanner.addListener("barcodesScanned", (event) => {
          const barcode = event.barcodes?.[0];
          const value = barcode?.rawValue || barcode?.displayValue || "";
          if (value) finish(value);
        });
        overlay = mountOverlay(cancel);
        await BarcodeScanner.startScan({ formats: FORMATS });
      } catch (e) {
        finish("", e instanceof Error ? e : new Error("Could not start the camera."));
      }
    })();
  });
}
