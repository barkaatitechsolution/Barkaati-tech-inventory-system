import JsBarcode from "jsbarcode";

class XmlNode {
  constructor(nodeName) {
    this.nodeName = nodeName;
    this.nodeType = 1;
    this.childNodes = [];
    this.attributes = Object.create(null);
    this.parentNode = null;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
}

class XmlText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentNode = null;
  }
}

const xmlDocument = {
  createElementNS: (_namespace, name) => new XmlNode(name),
  createTextNode: (text) => new XmlText(text)
};

const escapeHTML = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const serialize = (node) => {
  if (node.nodeType === 3) return escapeHTML(node.textContent);
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeHTML(value)}"`)
    .join("");
  const children = node.childNodes.map(serialize).join("");
  return `<${node.nodeName}${attributes}>${children}</${node.nodeName}>`;
};

export function barcodeSvg(value, options = {}) {
  const code = String(value || "").trim();
  if (!code) return "";
  const { stretch = false, ...barcodeOptions } = options;
  const svg = new XmlNode("svg");
  try {
    JsBarcode(svg, code, {
      format: "CODE128",
      width: 1.6,
      height: 44,
      displayValue: true,
      fontSize: 12,
      textMargin: 1,
      margin: 0,
      xmlDocument,
      ...barcodeOptions
    });
  } catch {
    return "";
  }
  // Stretch lets a label fill its full width/height without distorting the
  // bar widths (the horizontal scale stays uniform).
  if (stretch) svg.setAttribute("preserveAspectRatio", "none");
  return serialize(svg);
}

const money = (value) => `Rs ${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

export function barcodeLabelsHTML(store = {}, products = [], options = {}) {
  const copies = Math.max(1, Math.min(50, Number(options.copies) || 1));
  const name = store.name || "Store";

  const labels = [];
  products.forEach((product) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) return;
    const code = String(product.barcode || product.sku || "").trim();
    const svg = code ? barcodeSvg(code, { height: 40, width: 1.5, fontSize: 11 }) : "";
    const price = Number(product.selling_price) > 0 ? money(product.selling_price) : "";
    for (let i = 0; i < copies; i += 1) {
      labels.push(`
        <div class="label">
          <div class="store">${escapeHTML(name)}</div>
          <div class="name">${escapeHTML(product.name || "—")}</div>
          <div class="barcode">${svg || `<span class="missing">No barcode</span>`}</div>
          <div class="meta">
            <span class="code">${escapeHTML(code)}</span>
            ${price ? `<span class="price">${escapeHTML(price)}</span>` : ""}
          </div>
        </div>`);
    }
  });

  const body = labels
    .map((label, index) => `${label}${index < labels.length - 1 ? '<div class="cut">- - - - - - cut here - - - - - -</div>' : ""}`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode Labels — ${escapeHTML(name)}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: 'Courier New', Courier, monospace;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .labels {
    width: 48mm;
    margin: 0 auto;
  }
  .label {
    width: 48mm;
    padding: 3mm 1.5mm 2mm;
    text-align: center;
    page-break-inside: avoid;
    break-inside: avoid;
    overflow: hidden;
  }
  .store {
    font-size: 8px;
    font-weight: bold;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    margin-top: 1.5mm;
    font-size: 11px;
    font-weight: bold;
    line-height: 1.2;
    max-height: 2.4em;
    overflow: hidden;
  }
  .barcode {
    margin: 2mm 0 1mm;
    height: 14mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .barcode svg {
    width: 100%;
    height: 14mm;
  }
  .missing {
    font-size: 8px;
  }
  .meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1mm;
    font-size: 8px;
    line-height: 1;
  }
  .code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .price {
    font-weight: bold;
    white-space: nowrap;
  }
  .cut {
    width: 48mm;
    margin: 1mm auto 2mm;
    padding-top: 1mm;
    border-top: 1px dashed #000;
    text-align: center;
    font-size: 7px;
    letter-spacing: 0.5px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
</style>
</head>
<body>
  <div class="labels">${body}</div>
</body>
</html>`;
}

export function customerLabelsHTML(store = {}, customers = [], options = {}) {
  const copies = Math.max(1, Math.min(50, Number(options.copies) || 1));
  const name = store.name || "Store";

  const labels = [];
  customers.forEach((customer) => {
    if (!customer || typeof customer !== "object" || Array.isArray(customer)) return;
    const code = String(customer.barcode || "").trim();
    const cardNo = String(customer.card_no || "").trim();
    const svg = code
      ? barcodeSvg(code, {
          height: 60,
          width: 2,
          displayValue: false,
          margin: 0,
          stretch: true
        })
      : "";
    for (let i = 0; i < copies; i += 1) {
      labels.push(`
        <div class="label">
          <div class="store">${escapeHTML(name)}</div>
          <div class="card-title">Membership Card</div>
          <div class="name">${escapeHTML(customer.name || "—")}</div>
          ${customer.phone ? `<div class="phone">${escapeHTML(customer.phone)}</div>` : ""}
          ${cardNo ? `<div class="cardno">Card No. ${escapeHTML(cardNo)}</div>` : ""}
          <div class="barcode">${svg || `<span class="missing">No barcode</span>`}</div>
          ${code ? `<div class="code">${escapeHTML(code)}</div>` : ""}
        </div>`);
    }
  });

  const body = labels
    .map((label, index) => `${label}${index < labels.length - 1 ? '<div class="cut">- - - - - - cut here - - - - - -</div>' : ""}`)
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Customer Cards — ${escapeHTML(name)}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: 'Courier New', Courier, monospace;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .labels {
    width: 50mm;
    margin: 0 auto;
  }
  .label {
    width: 50mm;
    padding: 1.8mm;
    text-align: center;
    border: 0.4mm solid #000;
    border-radius: 1.5mm;
    page-break-inside: avoid;
    break-inside: avoid;
    overflow: hidden;
  }
  .store {
    font-size: 7.5px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-title {
    margin-top: 0.5mm;
    font-size: 6.5px;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
  .name {
    margin-top: 1mm;
    font-size: 11.5px;
    font-weight: bold;
    line-height: 1.15;
    max-height: 2.3em;
    overflow: hidden;
  }
  .phone {
    margin-top: 0.4mm;
    font-size: 8.5px;
    line-height: 1.2;
  }
  .cardno {
    margin-top: 0.8mm;
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 1.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .barcode {
    margin: 1.8mm 0 0.8mm;
    padding: 0 3mm;
    height: 12mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .barcode svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .missing {
    font-size: 8px;
  }
  .code {
    font-size: 9px;
    font-weight: bold;
    letter-spacing: 0.6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cut {
    width: 50mm;
    margin: 1mm auto 2mm;
    padding-top: 1mm;
    border-top: 1px dashed #000;
    text-align: center;
    font-size: 7px;
    letter-spacing: 0.5px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
</style>
</head>
<body>
  <div class="labels">${body}</div>
</body>
</html>`;
}
