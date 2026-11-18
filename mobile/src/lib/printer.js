import { fmtDateTime, fmtMoney } from "./format.js";

const ESC = 0x1b;
const GS = 0x1d;

class Bytes {
  constructor() {
    this.parts = [];
  }
  raw(...values) {
    this.parts.push(Uint8Array.from(values));
    return this;
  }
  bytes(arr) {
    this.parts.push(arr instanceof Uint8Array ? arr : Uint8Array.from(arr));
    return this;
  }
  text(value) {
    const s = String(value ?? "");
    const arr = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) {
      const code = s.charCodeAt(i);
      arr[i] = code < 256 ? code : 63; // '?'
    }
    this.parts.push(arr);
    return this;
  }
  line(value = "") {
    return this.text(value).raw(0x0a);
  }
  align(mode) {
    return this.raw(ESC, 0x61, mode === "center" ? 1 : mode === "right" ? 2 : 0);
  }
  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  size(big) {
    return this.raw(GS, 0x21, big ? 0x11 : 0x00);
  }
  feed(n = 1) {
    return this.raw(ESC, 0x64, n);
  }
  cut() {
    return this.raw(GS, 0x56, 0x00);
  }
  barcode(value) {
    const data = String(value || "");
    this.raw(GS, 0x6b, 0x49, data.length);
    this.text(data);
    this.raw(0x00);
    return this;
  }
  toUint8Array() {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}

const WIDTH = 32;
const divider = (ch = "-") => ch.repeat(WIDTH);
const pair = (left, right) => {
  const l = String(left ?? "");
  const r = String(right ?? "");
  const gap = Math.max(1, WIDTH - l.length - r.length);
  return `${l}${" ".repeat(gap)}${r}`;
};
const wrap = (text, width = WIDTH) => {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
};

export function buildReceiptBytes(sale, items = [], store = {}) {
  const b = new Bytes();
  b.raw(ESC, 0x40);
  b.align("center");
  b.bold(true).size(true).line(store.name || "Barkaati");
  b.size(false).bold(false);
  if (store.address) for (const l of wrap(store.address)) b.line(l);
  if (store.phone) b.line(`Ph: ${store.phone}`);
  if (store.taxNo) b.line(`GST: ${store.taxNo}`);
  b.line(divider("="));
  b.align("left");
  b.line(pair("Invoice", sale.invoice_no || ""));
  b.line(pair("Date", fmtDateTime(sale.created_at)));
  if (sale.customer_name) b.line(pair("Customer", sale.customer_name));
  if (sale.customer_phone) b.line(pair("Phone", sale.customer_phone));
  b.line(divider());
  b.bold(true).line(pair("Item", "Amount")).bold(false);
  b.line(divider());
  for (const it of items) {
    const name = String(it.product_name || it.name || "Item");
    for (const l of wrap(name)) b.line(l);
    b.line(pair(`  ${Number(it.qty) || 0} x ${fmtMoney(it.unit_price)}`, fmtMoney(it.line_total)));
  }
  b.line(divider());
  b.line(pair("Subtotal", fmtMoney(sale.subtotal)));
  if (Number(sale.discount)) b.line(pair("Discount", `-${fmtMoney(sale.discount)}`));
  if (Number(sale.tax)) b.line(pair("Tax", fmtMoney(sale.tax)));
  b.bold(true).line(pair("TOTAL", fmtMoney(sale.total))).bold(false);
  b.line(pair("Paid", fmtMoney(sale.paid)));
  if (Number(sale.total) - Number(sale.paid) > 0.009) {
    b.line(pair("Balance", fmtMoney(Number(sale.total) - Number(sale.paid))));
  }
  b.line(pair("Payment", String(sale.payment_method || "cash").toUpperCase()));
  b.line(divider("="));
  b.align("center");
  if (store.footerText) for (const l of wrap(store.footerText)) b.line(l);
  if (store.upiId) b.line(`UPI: ${store.upiId}`);
  b.line("Thank you!");
  b.feed(3);
  b.cut();
  return b.toUint8Array();
}

export function buildWeightLabelBytes(labels = []) {
  const b = new Bytes();
  for (const row of labels) {
    const copies = Math.min(100, Math.max(1, Math.trunc(Number(row?.copies) || 1)));
    for (let i = 0; i < copies; i += 1) {
      b.raw(ESC, 0x40);
      b.align("center");
      b.bold(true).size(true).line(row.weight_label || row.name || "");
      b.size(false).bold(false);
      b.barcode(row.barcode);
      b.line(row.barcode);
      b.feed(2);
      b.cut();
    }
  }
  return b.toUint8Array();
}

function classicTransport() {
  return (
    (typeof window !== "undefined" && (window.bluetoothSerial || window.Capacitor?.Plugins?.BluetoothSerial)) ||
    null
  );
}

function callBt(bt, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      bt[method](
        ...args,
        (ok) => resolve(ok),
        (err) => reject(new Error(err || `${method} failed`))
      );
    } catch (e) {
      reject(e);
    }
  });
}

async function sendClassic(bytes, address) {
  const bt = classicTransport();
  if (!bt) return false;
  let connected = false;
  try {
    connected = await callBt(bt, "isConnected");
  } catch {
    connected = false;
  }
  if (!connected) {
    if (!address) throw new Error("Choose a paired printer in Settings first.");
    await callBt(bt, "connect", address);
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await callBt(bt, "write", buffer);
  return true;
}

const BLE_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const BLE_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

async function sendBle(bytes) {
  if (typeof navigator === "undefined" || !navigator.bluetooth) return false;
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [BLE_SERVICE] }],
    optionalServices: [BLE_SERVICE]
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE);
  const characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC);
  const chunk = 120;
  for (let i = 0; i < bytes.length; i += chunk) {
    await characteristic.writeValueWithoutResponse(bytes.subarray(i, i + chunk));
  }
  try {
    device.gatt.disconnect();
  } catch {
    /* ignore */
  }
  return true;
}

async function sendBytes(bytes, store = {}) {
  if (await sendClassic(bytes, store.printerAddress || store.printer_address)) return "bluetooth";
  if (await sendBle(bytes)) return "ble";
  throw new Error(
    "No printer transport found. Install the Bluetooth Classic bridge (see BUILD.md) or pair a BLE printer."
  );
}

/** Print a receipt. Uses Classic SPP if available, then BLE, then throws. */
export async function printReceipt(sale, items, store = {}) {
  return sendBytes(buildReceiptBytes(sale, items, store), store);
}

/** Print generic weight labels with Code 128 barcodes. */
export async function printWeightLabels(labels, store = {}) {
  return sendBytes(buildWeightLabelBytes(labels), store);
}

export async function listPrinters() {
  const bt = classicTransport();
  if (!bt) return [];
  try {
    const devices = await callBt(bt, "list");
    return (devices || []).map((d) => ({
      address: d.address || d.id,
      name: d.name || d.address || d.id
    }));
  } catch {
    return [];
  }
}

export async function testPrinter(store = {}) {
  const demo = {
    invoice_no: "TEST-0001",
    created_at: new Date().toISOString(),
    customer_name: "Test customer",
    subtotal: 100,
    discount: 0,
    tax: 0,
    total: 100,
    paid: 100,
    payment_method: "cash"
  };
  const items = [{ product_name: "Printer test", qty: 1, unit_price: 100, line_total: 100 }];
  return printReceipt(demo, items, store);
}
