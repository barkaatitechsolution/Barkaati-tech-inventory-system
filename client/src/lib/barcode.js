import JsBarcode from "jsbarcode";
import { printHTML } from "./receipt.js";
import { fmtMoney } from "./format.js";

const escapeHTML = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Build a Code128 SVG in the browser. The SVG is then embedded in the print
// document, so the label sheet needs no scripts of its own when printed.
export function barcodeSvg(value, options = {}) {
  const { stretch = false, ...barcodeOptions } = options;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, String(value || ""), {
    format: "CODE128",
    width: 1.6,
    height: 44,
    displayValue: true,
    fontSize: 12,
    textMargin: 1,
    margin: 0,
    ...barcodeOptions
  });
  svg.setAttribute("preserveAspectRatio", stretch ? "none" : "xMidYMid meet");
  return svg.outerHTML;
}

export function printBarcodeLabels(store = {}, products = [], options = {}) {
  const copies = Math.max(1, Number(options.copies) || 1);
  const info = {
    name: store.name || "Store",
    ...store
  };

  const labels = [];
  products.forEach((p) => {
    const code = String(p.barcode || p.sku || "").trim();
    const svg = code ? barcodeSvg(code, { height: 40, width: 1.5, fontSize: 11 }) : "";
    const price = Number(p.selling_price) > 0 ? fmtMoney(p.selling_price) : "";
    for (let i = 0; i < copies; i += 1) {
      labels.push(`
        <div class="label">
          <div class="store">${escapeHTML(info.name)}</div>
          <div class="name">${escapeHTML(p.name || "—")}</div>
          <div class="barcode">${svg || `<span class="missing">No barcode</span>`}</div>
          <div class="meta">
            <span class="code">${escapeHTML(code)}</span>
            ${price ? `<span class="price">${escapeHTML(price)}</span>` : ""}
          </div>
        </div>`);
    }
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode Labels — ${escapeHTML(info.name)}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    color: #0f172a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .labels {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3mm;
  }
  .label {
    height: 33mm;
    padding: 2mm 2.5mm;
    border: 1px dashed #cbd5e1;
    border-radius: 2mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    break-inside: avoid;
    page-break-inside: avoid;
    overflow: hidden;
  }
  .store {
    font-size: 7px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    font-size: 10px;
    font-weight: 700;
    line-height: 1.15;
    max-height: 2.3em;
    overflow: hidden;
  }
  .barcode {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .barcode svg {
    width: 100%;
    height: 13mm;
  }
  .missing {
    font-size: 8px;
    color: #94a3b8;
  }
  .meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 2mm;
    font-size: 8px;
    line-height: 1;
  }
  .code {
    font-family: "SFMono-Regular", Consolas, monospace;
    color: #475569;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .price { font-weight: 700; color: #0f172a; white-space: nowrap; }
</style>
</head>
<body>
  <div class="labels">${labels.join("")}</div>
</body>
</html>`;

  printHTML(html);
}
