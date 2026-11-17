import { barcodeSvg } from "./barcode.js";
import { printHTML } from "./receipt.js";

export const GLOBAL_SCAN_COMMANDS = [
  {
    id: "sale",
    code: "CMD:SALE",
    aliases: [],
    label: "New Sale",
    hint: "Open a fresh sale bill in a new tab from anywhere"
  }
];

export const SALES_COMMANDS = [
  {
    id: "create",
    code: "CMD:NEW",
    aliases: ["CMD:CREATE_BILL"],
    label: "Create Bill",
    hint: "Submit the bill open in New Sale"
  },
  {
    id: "print",
    code: "CMD:PRT",
    aliases: ["CMD:PRINT"],
    label: "Print Receipt",
    hint: "Reprint the last created or selected bill (58mm)"
  },
  {
    id: "paid",
    code: "CMD:PAY",
    aliases: ["CMD:PAID"],
    label: "Paid",
    hint: "Create the open bill with status Paid"
  }
];

export const SCAN_COMMANDS = [...GLOBAL_SCAN_COMMANDS, ...SALES_COMMANDS];

const COMMANDS_BY_CODE = new Map(
  SALES_COMMANDS.flatMap((command) => [command.code, ...(command.aliases || [])].map((code) => [code, command]))
);

const GLOBAL_COMMANDS_BY_CODE = new Map(
  GLOBAL_SCAN_COMMANDS.flatMap((command) =>
    [command.code, ...(command.aliases || [])].map((code) => [code, command])
  )
);

const normalizeCommand = (value) =>
  String(value ?? "")
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .replace(/^\][A-Z]\d/i, "")
    .toUpperCase();

export function matchSalesCommand(value) {
  return COMMANDS_BY_CODE.get(normalizeCommand(value)) || null;
}

export function matchGlobalScanCommand(value) {
  return GLOBAL_COMMANDS_BY_CODE.get(normalizeCommand(value)) || null;
}

const escapeHTML = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function printSalesCommandCard(store = {}) {
  const storeName = escapeHTML(store.name || "Store");
  const cards = SCAN_COMMANDS.map(
    (command) => `
      <section class="cmd">
        <p class="cmd-label">${escapeHTML(command.label)}</p>
        <p class="cmd-hint">${escapeHTML(command.hint)}</p>
        <div class="cmd-barcode">${barcodeSvg(command.code, {
          height: 80,
          width: 2,
          displayValue: false,
          margin: 0
        })}</div>
        <p class="cmd-code">${escapeHTML(command.code)}</p>
      </section>`
  ).join("");

  printHTML(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Scan Commands — ${storeName}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #0f172a;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: 190mm;
    margin: 0 auto;
  }
  .title {
    margin: 0 0 2mm;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }
  .store {
    margin: 0 0 8mm;
    font-size: 12px;
    color: #64748b;
  }
  .grid {
    display: grid;
    gap: 6mm;
  }
  .cmd {
    padding: 7mm 8mm 6mm;
    border: 1.5px solid #0f172a;
    border-radius: 4mm;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .cmd-label {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .cmd-hint {
    margin: 1.5mm 0 4mm;
    font-size: 10px;
    color: #475569;
  }
  .cmd-barcode {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 24mm;
  }
  .cmd-barcode svg {
    width: 100%;
    height: 24mm;
  }
  .cmd-code {
    margin: 2mm 0 0;
    font-family: "Courier New", Courier, monospace;
    font-size: 11px;
    letter-spacing: 1px;
    color: #475569;
  }
  .notes {
    margin-top: 8mm;
    padding-top: 4mm;
    border-top: 1px dashed #94a3b8;
    font-size: 10px;
    line-height: 1.6;
    color: #475569;
  }
  .notes strong { color: #0f172a; }
</style>
</head>
<body>
  <main class="sheet">
    <h1 class="title">Scan Commands</h1>
    <p class="store">${storeName}</p>
    <div class="grid">${cards}</div>
    <div class="notes">
      <p><strong>New Sale</strong> opens a fresh bill in a new tab from anywhere.</p>
      <p><strong>Create Bill</strong> submits the bill currently open in New Sale.</p>
      <p><strong>Paid</strong> sets the open bill to Paid and submits it.</p>
      <p><strong>Print Receipt</strong> reprints the last created or selected bill on the 58mm printer.</p>
      <p>Customer and product barcodes can be scanned anywhere in the New Sale form.</p>
    </div>
  </main>
</body>
</html>`);
}
