import { fmtMoney, fmtDateTime } from "./format.js";

export function buildSaleWhatsAppText(store, sale = {}, items = []) {
  const lines = [];

  lines.push(`*${store.name || "Royal Spicy Masala"}*`);
  if (store.address) lines.push(store.address);
  if (store.phone) lines.push(`Tel: ${store.phone}`);
  lines.push("");
  lines.push(`*INVOICE ${sale.invoice_no || "—"}*`);
  lines.push(`Date: ${sale.created_at ? fmtDateTime(sale.created_at) : new Date().toLocaleString()}`);
  if (sale.customer && sale.customer !== "Walk-in") {
    lines.push(`Customer: ${sale.customer}`);
  }
  lines.push("");

  lines.push("*Items*");
  items.forEach((it, i) => {
    const qty = Number(it.qty) || 0;
    const price = Number(it.unit_price) || 0;
    const amount = price * qty;
    const mrp = Number(it.market_price) || 0;
    const unit = it.unit_name ? ` ${it.unit_name}` : "";
    const mrpPart = mrp > 0 ? ` (MRP ${fmtMoney(mrp)})` : "";
    lines.push(`${i + 1}. ${it.product_name || "Item"}`);
    lines.push(`   ${qty}${unit} x ${fmtMoney(price)} = ${fmtMoney(amount)}${mrpPart}`);
  });

  lines.push("");

  const total = Number(sale.total) || items.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const paid = Number(sale.paid) || 0;
  const saved = items.reduce(
    (a, it) => a + Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0)) * (Number(it.qty) || 0),
    0
  );

  lines.push(`*Total: ${fmtMoney(total)}*`);
  if (paid > 0) lines.push(`Paid: ${fmtMoney(paid)}`);
  if (sale.payment_method) lines.push(`Payment: ${(sale.payment_method || "cash").toUpperCase()}`);
  if (sale.status && sale.status !== "paid") lines.push(`Status: ${sale.status.toUpperCase()}`);
  if (saved > 0) lines.push(`You saved ${fmtMoney(saved)} vs MRP`);
  lines.push("");
  lines.push(store.footerText || "Thank you for shopping with us!");

  return lines.join("\n");
}

const DEFAULT_COUNTRY_CODE = "91";

export function normalizeWhatsAppNumber(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits;
}

export function sendWhatsApp(text, phone) {
  const digits = normalizeWhatsAppNumber(phone);
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

export function buildQuotationWhatsAppText(store, quote = {}) {
  const lines = [];
  const items = Array.isArray(quote.items) ? quote.items : [];
  const subtotal = items.reduce((a, it) => a + (Number(it.rate) || 0) * (Number(it.qty) || 0), 0);
  const discountPct = Number(quote.discountPct) || 0;
  const taxPct = Number(quote.taxPct) || 0;
  const discountAmt = (subtotal * discountPct) / 100;
  const taxable = subtotal - discountAmt;
  const taxAmt = (taxable * taxPct) / 100;
  const total = taxable + taxAmt;

  lines.push(`*${store.name || "Royal Spicy Masala"}*`);
  if (store.address) lines.push(store.address);
  if (store.phone) lines.push(`Tel: ${store.phone}`);
  lines.push("");
  lines.push(`*QUOTATION ${quote.number || "—"}*`);
  if (quote.date) lines.push(`Date: ${quote.date}`);
  if (quote.validUntil) lines.push(`Valid until: ${quote.validUntil}`);
  if (quote.customerName) {
    lines.push(`Prepared for: ${quote.customerName}`);
    if (quote.customerPhone) lines.push(`Phone: ${quote.customerPhone}`);
  }
  lines.push("");

  lines.push("*Items*");
  items.forEach((it, i) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const unit = it.unit ? ` ${it.unit}` : "";
    lines.push(`${i + 1}. ${it.name || "Item"}`);
    lines.push(`   ${qty}${unit} x ${fmtMoney(rate)} = ${fmtMoney(rate * qty)}`);
  });

  lines.push("");
  lines.push(`Subtotal: ${fmtMoney(subtotal)}`);
  if (discountAmt > 0) lines.push(`Discount (${discountPct}%): - ${fmtMoney(discountAmt)}`);
  if (taxAmt > 0) lines.push(`GST (${taxPct}%): + ${fmtMoney(taxAmt)}`);
  lines.push(`*Total: ${fmtMoney(total)}*`);
  if (quote.notes) lines.push("");
  if (quote.notes) lines.push(`*Terms:* ${quote.notes}`);
  lines.push("");
  lines.push(store.footerText || "Thank you for your business!");

  return lines.join("\n");
}