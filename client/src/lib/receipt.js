import { fmtMoney, fmtDateTime, fmtDate } from "./format.js";

export function printReceipt(sale, items, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };

  const html = buildReceiptHTML(store, sale, items);
  printHTML(html.replace("</body>", `${voucherBillHTML(sale.voucher)}</body>`), PRINT_SIZES.a4);
}

export function printInvoiceA4(sale, items, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };

  const html = buildInvoiceA4HTML(store, sale, items);
  printHTML(html.replace("</body>", `${voucherBillHTML(sale.voucher)}</body>`), PRINT_SIZES.a4);
}

// 58mm thermal roll printer (the common 2-inch shop printer).
// The old "thermal" output reused the A4 receipt and switched layout with
// `@media print and (max-width: 80mm)`. Page width is decided by @page, not by
// a media query, so that branch silently never matched and the receipt came
// out A4-shaped. This is a dedicated document with an unconditional
// `@page { size: 58mm auto }` so the driver is handed the right paper.
export function printReceipt58(sale, items, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };

  printHTML(buildReceipt58HTML(store, sale, items), PRINT_SIZES.thermal58);
}

function voucherBillHTML(v) {
  if (!v) return "";
  const valueLabel = v.discount_type === "percent" ? `${Number(v.discount_value) || 0}% OFF` : `Rs ${Number(v.discount_value) || 0} OFF`;
  const till = v.valid_through ? fmtDate(v.valid_through) : "";
  const minTotal = Number(v.min_total) || 0;
  const used = v.status === "used" || v.status === "redeemed";
  return `
    <div class="vchr">
      <style>
        .vchr { margin: 12px 0 4px; padding: 10px; border: 2px dashed #111; text-align: center; font-family: 'Courier New', Courier, monospace; page-break-inside: avoid; break-inside: avoid; }
        .vchr .vchr-title { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; font-weight: bold; }
        .vchr .vchr-value { font-size: 22px; font-weight: bold; margin: 4px 0 2px; }
        .vchr .vchr-code { font-size: 15px; font-weight: bold; letter-spacing: 4px; margin: 6px 0 2px; }
        .vchr .vchr-line { font-size: 11px; text-transform: uppercase; }
        .vchr .vchr-note { font-size: 10px; margin-top: 6px; opacity: 0.85; }
        @media print and (max-width: 80mm) {
          .vchr { margin: 10px 0 2px; padding: 8px; font-size: 9px; }
          .vchr .vchr-title { font-size: 9px; letter-spacing: 2px; }
          .vchr .vchr-value { font-size: 24px; letter-spacing: 1px; }
          .vchr .vchr-code { font-size: 20px; letter-spacing: 7px; border: 1px dashed #000; border-radius: 3px; padding: 3px 2px; margin: 6px 0 4px; }
          .vchr .vchr-line { font-size: 9px; }
          .vchr .vchr-note { font-size: 8px; margin-top: 5px; line-height: 1.5; }
        }
      </style>
      ${used ? `<div class="vchr-title">Voucher used ✓</div>` : `<div class="vchr-title">Congratulations — Discount Voucher</div>`}
      <div class="vchr-value">${valueLabel}</div>
      <div class="vchr-line">${esc(v.campaign_name || "Offer")}</div>
      ${v.code ? `<div class="vchr-code">${esc(v.code)}</div>` : ""}
      ${minTotal > 0 ? `<div class="vchr-line">Min shopping ${fmtMoney(minTotal)}</div>` : ""}
      ${till ? `<div class="vchr-line">Valid till ${esc(till)}</div>` : ""}
      <div class="vchr-line">Use once every month · ${Number(v.months) || 0} times</div>
      <div class="vchr-note">Show this 4-digit code at billing to get the discount.</div>
    </div>`;
}

function esc(v) {
  return escapeHTML(v);
}

export function printVoucherCards(store = {}, entries = []) {
  const info = {
    name: store.name || "Royal Spicy Masala",
    address: store.address || "",
    phone: store.phone || "",
    ...store
  };
  printHTML(buildVoucherCardsHTML(info, Array.isArray(entries) ? entries : []));
}

function buildVoucherCardsHTML(store, entries) {
  const taglineParts = [
    store.address ? esc(store.address) : "",
    store.phone ? `Ph: ${esc(store.phone)}` : ""
  ].filter(Boolean).join("&nbsp;&middot;&nbsp;");

  const coupons = entries
    .map((e, i) => {
      const valueLabel =
        e.discount_type === "percent" ? `${Number(e.discount_value) || 0}% OFF` : `Rs ${Number(e.discount_value) || 0} OFF`;
      const till = e.valid_through ? fmtDate(e.valid_through) : "";
      const minTotal = Number(e.min_total) || 0;
      const months = Number(e.months) || 0;
      const usesLeft = e.uses_left != null ? Number(e.uses_left) : months;
      const used = e.status === "used" || e.status === "redeemed";
      return `
        <div class="vcard${used ? " used" : ""}">
          <div class="vcard-head">
            <div class="vcard-store">${esc(store.name)}</div>
            <div class="vcard-title">Discount Voucher</div>
          </div>
          <div class="vcard-value">${esc(valueLabel)}</div>
          <div class="vcard-campaign">${esc(e.campaign_name || "Offer")}</div>
          <div class="vcard-code">${esc(e.code || "____")}</div>
          <div class="vcard-meta">
            ${used ? `<div class="used-mark">✗ Used</div>` : ""}
            ${minTotal > 0 ? `<div>Minimum shopping: <b>${fmtMoney(minTotal)}</b></div>` : ""}
            ${e.customer_name ? `<div>For: <b>${esc(e.customer_name)}</b></div>` : ""}
            ${months > 0 ? `<div>Use once every month · <b>${months}</b> ${months > 1 ? "times" : "time"}</div>` : ""}
            ${usesLeft >= 0 && months > 0 ? `<div>Uses left: <b>${esc(String(usesLeft))}</b></div>` : ""}
            ${till ? `<div>Valid till: <b>${esc(till)}</b></div>` : ""}
          </div>
          <div class="vcard-foot">
            <div class="n1">Show this code at billing to get the offer</div>
            ${taglineParts ? `<div class="n2">${taglineParts}</div>` : ""}
          </div>
          <div class="vcard-fill">${i + 1} / ${entries.length}</div>
          <div class="tear">- - - - - - TEAR HERE - - - - - -</div>
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Discount Vouchers</title>
<style>
  @page { margin: 8mm 10mm; size: auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', -apple-system, Arial, sans-serif;
    font-size: 12px; color: #0f172a; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 190mm; }
  .vcard {
    position: relative; border: 2px dashed #b45309; border-radius: 14px; padding: 14px 16px;
    background: #fffdf6; page-break-inside: avoid; text-align: center;
  }
  .vcard.used { filter: grayscale(1); opacity: 0.75; }
  .vcard-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .vcard-store { font-size: 12px; font-weight: 800; letter-spacing: 0.3px; }
  .vcard-title { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #b45309; }
  .vcard-value { margin-top: 10px; font-size: 30px; font-weight: 800; color: #b45309; }
  .vcard-campaign { margin-top: 2px; font-size: 13px; font-weight: 700; color: #334155; }
  .vcard-code { margin-top: 10px; font-size: 22px; font-weight: 800; letter-spacing: 6px; color: #0f172a; }
  .vcard-meta { margin-top: 8px; font-size: 11px; color: #475569; line-height: 1.7; }
  .used-mark { font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #dc2626; text-transform: uppercase; }
  .vcard-foot { margin-top: 10px; border-top: 1px dashed #d88a2a; padding-top: 8px; font-size: 10px; color: #78350f; line-height: 1.6; }
  .vcard-foot .n2 { color: #64748b; }
  .vcard-fill { display: none; font-size: 9px; color: #94a3b8; margin-top: 6px; }
  .tear { display: none; }

  /* ===== THERMAL 58mm =====
     Printable width ≈ 48mm, fed as a continuous roll. Pure black + dashes
     so it prints cleanly on monochrome thermal heads. Each voucher ends in a
     perforation line — tear to hand out as a coupon.
     The page is sized 58mm with zero margins and the 48mm content is centered
     with auto margins, so the paper gets equal gaps on the left and right. */
  @media print and (max-width: 80mm) {
    @page {
      size: 58mm auto;
      margin: 0;
    }
    html { margin: 0; padding: 0; }
    body {
      width: 48mm;
      margin: 0 auto;
      padding: 0;
      font-size: 10px; line-height: 1.45;
      font-family: 'Courier New', Courier, monospace; color: #000;
    }
    .sheet { grid-template-columns: 1fr; gap: 0; max-width: none; margin: 0 auto; }
    .vcard {
      width: 48mm; margin: 0 auto; padding: 5mm 2mm 1mm; border: none; border-radius: 0;
      background: #fff; text-align: center; page-break-inside: avoid;
    }
    .vcard-head { flex-direction: column; gap: 1px; }
    .vcard-store { font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #000; }
    .vcard-title {
      font-size: 8px; font-weight: bold; letter-spacing: 4px; text-transform: uppercase; color: #000;
      border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 0; margin-top: 4px;
    }
    .vcard-value { margin-top: 7px; font-size: 30px; font-weight: bold; color: #000; }
    .vcard-campaign { font-size: 11px; font-weight: bold; color: #111; margin-top: 2px; }
    .vcard-code {
      margin: 6px auto 0; width: fit-content; min-width: 30mm;
      border: 1.5px dashed #000; border-radius: 4px; padding: 5px 6px;
      font-size: 24px; font-weight: bold; letter-spacing: 9px; color: #000;
    }
    .vcard-meta { margin-top: 7px; font-size: 10px; color: #222; line-height: 1.7; }
    .used-mark { font-size: 10px; letter-spacing: 2px; color: #000; }
    .vcard-foot { margin-top: 8px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 0; font-size: 9px; color: #333; line-height: 1.6; }
    .vcard-fill {
      display: block; margin-top: 4px; font-size: 9px; letter-spacing: 1px; color: #666;
    }
    .tear {
      display: block; margin-top: 2mm; font-size: 9px; letter-spacing: 3px; color: #111;
    }
    .tear:before { content: ""; display: block; border-top: 1px dashed #111; margin-bottom: 1mm; }
  }
</style>
</head>
<body>
<div class="sheet">
${coupons || `<div class="vcard"><div class="vcard-title">No vouchers</div></div>`}
</div>
</body>
</html>`;
}

// Printing happens inside an off-screen iframe, and that frame MUST have a real
// size. The old version used `width:0;height:0;visibility:hidden`, which makes
// Chrome lay the document out against a zero-width viewport: the print
// pagination then collapses and output is truncated after the first block —
// printing stopped right after the invoice header, and any embedded base64
// logo/QR forced the printer to rasterise a full-size bitmap into a 0px box,
// which is what made it look like it had hung on "raw data".
//
// The frame is now a realistic paper-width box parked off-screen. Off-screen
// rather than hidden, because some engines skip `visibility:hidden` subtrees
// when printing.
const PRINT_SIZES = {
  a4: { width: 794, height: 1123 }, // 96dpi
  a5: { width: 559, height: 794 },
  // 58mm roll printers are continuous feed: the driver cuts the paper to the
  // job length. `autoHeight` measures the rendered receipt and rewrites the
  // @page height so the whole receipt lands on one unbroken roll.
  thermal58: { width: 219, height: 1123, paperWidthMm: 58, autoHeight: true }
};

const PX_PER_MM = 96 / 25.4;

// Chrome silently ignores `auto` in `@page { size }` and falls back to US
// Letter, which is why a 58mm receipt used to come out Letter-sized. The only
// forms it honours are one or two concrete lengths, so the height is measured
// and written in as a real millimetre value.
function applyAutoPageHeight(doc, paperWidthMm) {
  try {
    const heightPx = doc.documentElement.scrollHeight || doc.body.scrollHeight || 0;
    if (!heightPx) return;
    const heightMm = Math.max(30, Math.ceil((heightPx + 8) / PX_PER_MM));
    let style = doc.getElementById("__print-page-size");
    if (!style) {
      style = doc.createElement("style");
      style.id = "__print-page-size";
      doc.head.appendChild(style);
    }
    // Appended last so it wins over the template's own @page rule.
    style.textContent = `@page { size: ${paperWidthMm}mm ${heightMm}mm; margin: 0; }`;
  } catch {
    /* keep the template's own @page size if measurement fails */
  }
}

function printHTML(html, size = PRINT_SIZES.a4) {
  const { width, height } = size;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;` +
    "border:0;margin:0;padding:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  let cleaned = false;
  let readyTimer = null;
  let failsafe = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (readyTimer) clearInterval(readyTimer);
    if (failsafe) clearTimeout(failsafe);
    setTimeout(() => iframe.remove(), 1000);
  };
  win.onafterprint = cleanup;
  win.onbeforeunload = cleanup;
  failsafe = setTimeout(cleanup, 60000);

  let tries = 0;
  readyTimer = setInterval(() => {
    tries += 1;
    // Wait for layout, images AND webfonts, otherwise a late-arriving logo can
    // be dropped from the printed page.
    const imagesReady = Array.from(doc.querySelectorAll("img")).every((im) => im.complete);
    const fontsReady = doc.fonts ? doc.fonts.status === "loaded" : true;
    if ((doc.readyState === "complete" && imagesReady && fontsReady) || tries > 200) {
      if (readyTimer) clearInterval(readyTimer);
      if (failsafe) clearTimeout(failsafe);
      if (size.autoHeight && doc.readyState === "complete") {
        applyAutoPageHeight(doc, size.paperWidthMm || 58);
      }
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          // Print dialog dismissed or interrupted.
          cleanup();
        }
      }, 150);
    }
  }, 50);
}

// ===== 58mm thermal receipt =====
// Single 58mm column, monospace so the number columns line up, pure black on
// white (thermal heads have no greyscale ramp to dither into). Page height is
// `auto` so a long receipt simply runs onto a second roll of paper.
function buildReceipt58HTML(store, sale, items) {
  const list = Array.isArray(items) ? items : [];
  const subtotal = list.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const savedTotal = list.reduce(
    (a, it) => a + Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0)) * (Number(it.qty) || 0),
    0
  );
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const discount = Math.max(0, subtotal - total);
  const outstanding = Math.max(0, total - paid);
  const date = sale.created_at ? fmtDateTime(sale.created_at) : new Date().toLocaleString();
  const invoiceNo = sale.invoice_no || (sale.id ? `#${sale.id}` : "");
  const rule = `<div class="rule"></div>`;

  const rows = list
    .map((it) => {
      const name = it.product_name || "Item";
      const qty = Number(it.qty) || 0;
      const price = Number(it.unit_price) || 0;
      const amount = price * qty;
      const unit = it.unit_name ? ` ${it.unit_name}` : "";
      return `<div class="item">
        <div class="i-name">${escapeHTML(name)}</div>
        <div class="i-line">
          <span>${qty}${escapeHTML(unit)} x ${price.toFixed(2)}</span>
          <span>${amount.toFixed(2)}</span>
        </div>
      </div>`;
    })
    .join("");

  const totalRow = (label, value, cls = "") =>
    `<div class="trow ${cls}"><span>${label}</span><span>${value}</span></div>`;

  const voucher = sale.voucher;
  const voucherLine = voucher
    ? `<div class="trow"><span>Voucher</span><span>${
        voucher.discount_type === "percent"
          ? `${Number(voucher.discount_value) || 0}% off`
          : `${Number(voucher.discount_value) || 0} off`
      }</span></div>`
    : "";

  const bank = storeBankText(store);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipt ${escapeHTML(invoiceNo)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: 58mm;
    margin: 0;
    padding: 0;
    background: #fff;
  }

  body {
    /* Monospace keeps the money columns aligned on a narrow roll. */
    font-family: "Courier New", "Consolas", Courier, monospace;
    font-size: 10px;
    line-height: 1.4;
    font-weight: 700;
    color: #000;
    padding: 2mm 2mm 10mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .c { text-align: center; }
  .r { text-align: right; }

  .shop {
    font-size: 14px;
    font-weight: 900;
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    word-break: break-word;
  }
  .meta { font-size: 9px; font-weight: 600; line-height: 1.45; }
  .doc { font-size: 11px; font-weight: 900; letter-spacing: 2px; }

  .rule {
    border-top: 1px dashed #000;
    margin: 1.6mm 0;
  }
  .rule.solid { border-top-style: solid; }

  .kv { display: flex; justify-content: space-between; gap: 1mm; font-size: 9.5px; }
  .kv span:first-child { flex: 0 0 auto; }
  .kv span:last-child { text-align: right; word-break: break-word; }

  .thead {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .item { margin-bottom: 1.4mm; }
  .i-name { font-size: 10px; font-weight: 700; line-height: 1.3; word-break: break-word; }
  .i-line {
    display: flex;
    justify-content: space-between;
    font-size: 9.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .trow {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .trow.grand {
    font-size: 12px;
    font-weight: 900;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    padding: 1.2mm 0;
    margin: 1mm 0;
  }
  .trow.due { font-weight: 900; }

  .foot { font-size: 9px; font-weight: 600; line-height: 1.5; word-break: break-word; }
  .thanks { font-size: 10px; font-weight: 900; letter-spacing: 0.5px; }

  /* Thermal heads are dithered bitmaps: keep the QR small, square and hard. */
  .qr { text-align: center; margin: 1.5mm 0; }
  .qr img {
    width: 22mm;
    height: 22mm;
    image-rendering: pixelated;
    filter: grayscale(1) contrast(1.5);
  }

  /* Keep every line of the roll intact. */
  .item, .trow, .kv, .qr, .foot { page-break-inside: avoid; }
  .thead { display: table-header-group; }
</style>
</head>
<body>
  <div class="c shop">${escapeHTML(store.name || "Store")}</div>
  ${store.address ? `<div class="c meta">${escapeHTML(store.address)}</div>` : ""}
  ${store.phone ? `<div class="c meta">Ph: ${escapeHTML(store.phone)}</div>` : ""}
  ${store.taxNo ? `<div class="c meta">GSTIN: ${escapeHTML(store.taxNo)}</div>` : ""}

  ${rule}
  <div class="c doc">SALE RECEIPT</div>
  ${rule}

  <div class="kv"><span>Inv</span><span>${escapeHTML(invoiceNo)}</span></div>
  <div class="kv"><span>Date</span><span>${escapeHTML(date)}</span></div>
  ${sale.customer_name ? `<div class="kv"><span>Cust</span><span>${escapeHTML(sale.customer_name)}</span></div>` : ""}
  ${sale.payment_mode ? `<div class="kv"><span>Pay</span><span>${escapeHTML(sale.payment_mode)}</span></div>` : ""}

  ${rule}
  <div class="thead"><span>Item</span><span>Qty / Rate</span><span>Amount</span></div>
  ${rule}

  ${rows || '<div class="foot">No items</div>'}

  ${rule}
  ${totalRow("Subtotal", subtotal.toFixed(2))}
  ${voucherLine}
  ${discount > 0 ? totalRow("Discount", `-${discount.toFixed(2)}`) : ""}
  ${totalRow("TOTAL", total.toFixed(2), "grand")}
  ${totalRow("Paid", paid.toFixed(2))}
  ${outstanding > 0 ? totalRow("Balance", outstanding.toFixed(2), "due") : ""}
  ${savedTotal > 0 ? `<div class="trow"><span>Saved</span><span>${savedTotal.toFixed(2)}</span></div>` : ""}

  ${rule}
  ${bank.map((b) => `<div class="foot">${escapeHTML(b)}</div>`).join("")}

  ${store.qrCode ? `<div class="qr"><img src="${store.qrCode}" alt="payment QR" /></div>` : ""}

  ${rule}
  <div class="c thanks">THANK YOU!</div>
  ${store.footerText ? `<div class="c foot">${escapeHTML(store.footerText)}</div>` : ""}
  <div class="c foot">Please keep this receipt</div>
  ${rule}
</body>
</html>`;
}

function buildReceiptHTML(store, sale, items) {
  const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const savedTotal = items.reduce((a, it) => a + Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0)) * (Number(it.qty) || 0), 0);
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const outstanding = total - paid;
  const date = sale.created_at ? fmtDateTime(sale.created_at) : new Date().toLocaleString();

  const bankInfo = storeBankText(store).join("<br>");

const itemLines = items
    .map((it) => {
      const name = it.product_name || "Item";
      const qty = Number(it.qty) || 0;
      const price = Number(it.unit_price) || 0;
      const mrp = Number(it.market_price) || 0;
      const lineTotal = price * qty;
      return `
        <tr>
          <td class="item-name">${escapeHTML(name)}</td>
          <td class="item-qty">${qty}</td>
          <td class="item-mrp">${mrp > 0 ? fmtMoney(mrp) : "—"}</td>
          <td class="item-price">${fmtMoney(price)}</td>
          <td class="item-total">${fmtMoney(lineTotal)}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${escapeHTML(sale.invoice_no || "")}</title>
<style>
  @page {
    margin: 5mm;
    size: auto;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #000;
    background: #fff;
    font-weight: bold;
  }

  /* ===== REGULAR PRINTER ===== */
  .receipt {
    max-width: 300px;
    margin: 0 auto;
    padding: 15px;
  }

  .store-logo {
    text-align: center;
    margin-bottom: 4px;
  }

  .store-logo img {
    max-width: 100%;
    max-height: 60px;
  }

  .store-name {
    font-size: 20px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 2px;
    letter-spacing: 1px;
  }

  .payment-qr {
    text-align: center;
    margin: 8px 0;
  }

  .payment-qr img {
    width: 90px;
    height: 90px;
    image-rendering: pixelated;
  }

  .payment-qr .scan-label {
    font-size: 10px;
    margin-top: 2px;
  }

  .bank-info {
    text-align: center;
    font-size: 10px;
    margin-top: 4px;
    line-height: 1.5;
  }

  .store-details {
    text-align: center;
    font-size: 11px;
    color: #000;
    margin-bottom: 8px;
  }

  .divider {
    border-top: 2px dashed #000;
    margin: 10px 0;
  }

  .divider-thin {
    border-top: 1px dashed #000;
    margin: 8px 0;
  }

  .invoice-header {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    margin-bottom: 6px;
  }

  .invoice-header .label {
    color: #000;
  }

  .invoice-header .value {
    font-weight: bold;
  }

  .customer-info {
    font-size: 11px;
    margin-bottom: 6px;
  }

  .customer-info .label {
    color: #000;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
  }

  thead th {
    text-align: left;
    font-size: 10px;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 0;
    border-bottom: 1px solid #000;
  }

  thead th:first-child {
    text-align: left;
  }

  thead th.num {
    text-align: right;
  }

  tbody td {
    padding: 3px 0;
    font-size: 11px;
  }

  .item-name {
    max-width: 150px;
    word-wrap: break-word;
  }

  .item-mrp {
    text-align: right;
    width: 60px;
    font-size: 10px;
    font-weight: normal;
    color: #000;
  }

  .item-qty {
    text-align: center;
    width: 40px;
  }

  .item-price {
    text-align: right;
    width: 70px;
  }

  .item-total {
    text-align: right;
    width: 70px;
    font-weight: bold;
  }

  .totals {
    margin-top: 8px;
    border-top: 1px solid #000;
    padding-top: 6px;
  }

  .totals .row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    padding: 2px 0;
  }

  .totals .row .label {
    color: #000;
  }

  .totals .row.total {
    font-size: 14px;
    font-weight: bold;
    border-top: 2px solid #000;
    padding-top: 4px;
    margin-top: 4px;
  }

  .totals .row.paid .value,
  .totals .row.saved .value,
  .totals .row.outstanding .value {
    color: #000;
  }

  .payment-info {
    text-align: center;
    font-size: 11px;
    margin: 8px 0;
    padding: 4px;
    border: 1px dashed #000;
  }

  .footer {
    text-align: center;
    font-size: 10px;
    color: #000;
    margin-top: 12px;
    line-height: 1.5;
  }

  .footer .thank-you {
    font-size: 12px;
    font-weight: bold;
    color: #000;
    margin-bottom: 4px;
  }

  .note {
    font-size: 10px;
    color: #000;
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed #000;
  }

  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<div class="receipt">
  <!-- Store Header -->
  ${store.logo ? `<div class="store-logo"><img src="${store.logo}" alt="logo" /></div>` : ""}
  <div class="store-name">${escapeHTML(store.name)}</div>
  <div class="store-details">
    ${store.address ? escapeHTML(store.address) + "<br>" : ""}
    ${store.phone ? escapeHTML(store.phone) + "<br>" : ""}
    ${store.taxNo ? `Tax No: ${escapeHTML(store.taxNo)}` : ""}
  </div>

  <div class="divider"></div>

  <!-- Invoice Info -->
  <div class="invoice-header">
    <span><span class="label">Invoice:</span> <span class="value">${escapeHTML(sale.invoice_no || "—")}</span></span>
    <span class="label">${date}</span>
  </div>

  ${sale.customer && sale.customer !== "Walk-in" ? `
  <div class="customer-info">
    <span class="label">Customer:</span> ${escapeHTML(sale.customer)}
    ${sale.customer_phone ? `<br><span class="label">Phone:</span> ${escapeHTML(sale.customer_phone)}` : ""}
  </div>
  ` : ""}

  <div class="divider-thin"></div>

  <!-- Items Table -->
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="num item-qty">Qty</th>
        <th class="num">MRP</th>
        <th class="num">Price</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemLines}
    </tbody>
  </table>

  <div class="divider-thin"></div>

  <!-- Totals -->
  <div class="totals">
    <div class="row">
      <span class="label">Subtotal</span>
      <span>${fmtMoney(subtotal)}</span>
    </div>
    ${savedTotal > 0 ? `
    <div class="row saved">
      <span class="label">You Saved vs MRP</span>
      <span class="value">${fmtMoney(savedTotal)}</span>
    </div>
    ` : ""}
    <div class="row total">
      <span>TOTAL</span>
      <span>${fmtMoney(total)}</span>
    </div>
    <div class="row paid">
      <span class="label">Paid</span>
      <span class="value">${fmtMoney(paid)}</span>
    </div>
    ${outstanding > 0 ? `
    <div class="row outstanding">
      <span class="label">Balance Due</span>
      <span class="value">${fmtMoney(outstanding)}</span>
    </div>
    ` : ""}
  </div>

  <!-- Payment Method -->
  <div class="payment-info">
    Payment: ${escapeHTML((sale.payment_method || "cash").toUpperCase())}
    ${sale.status ? ` | Status: ${escapeHTML(sale.status.toUpperCase())}` : ""}
    ${bankInfo ? `<div class="bank-info">${bankInfo}</div>` : ""}
  </div>

  ${store.qrCode ? `
  <div class="payment-qr">
    <img src="${store.qrCode}" alt="payment QR" />
    <div class="scan-label">Scan to pay</div>
  </div>
  ` : ""}

  ${sale.note ? `<div class="note">Note: ${escapeHTML(sale.note)}</div>` : ""}

  <div class="divider"></div>

  <!-- Footer -->
  <div class="footer">
    <div class="thank-you">${escapeHTML(store.footerText || "THANK YOU!")}</div>
    ${store.footerText ? "" : "<div>For queries, please contact us</div>"}
    ${store.phone ? `<div>${escapeHTML(store.phone)}</div>` : ""}
  </div>
</div>
</body>
</html>`;
}

function buildInvoiceA4HTML(store, sale, items) {
  const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const taxTotal = items.reduce((a, it) => a + (Number(it.tax_amt) || 0), 0);
  const savedTotal = items.reduce((a, it) => a + Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0)) * (Number(it.qty) || 0), 0);
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const outstanding = total - paid;
  const date = sale.created_at ? fmtDateTime(sale.created_at) : new Date().toLocaleString();
  const bankLines = storeBankText(store);
  // Bank details flow onto a single long line (like the tagline) instead of a
  // boxed stack, so the header stays short and more product rows fit the page.
  const bankInline = bankLines.join("&nbsp;&middot;&nbsp;");

  const taglineParts = [
    store.address ? escapeHTML(store.address) : "",
    store.phone ? `Ph: ${escapeHTML(store.phone)}` : "",
    store.taxNo ? `Tax No: ${escapeHTML(store.taxNo)}` : ""
  ].filter(Boolean).join("&nbsp;&middot;&nbsp;");

  const itemRows = items
    .map((it, i) => {
      const name = it.product_name || "Item";
      const qty = Number(it.qty) || 0;
      const price = Number(it.unit_price) || 0;
      const mrp = Number(it.market_price) || 0;
      const tax = Number(it.tax) || 0;
      const amount = price * qty;
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="item">${escapeHTML(name)}</td>
          <td class="hsn">${escapeHTML(it.hsn_code || "—")}</td>
          <td class="qty">${qty}${it.unit_name ? ` <span class="unit">${escapeHTML(it.unit_name)}</span>` : ""}</td>
          <td class="price">${fmtMoney(price)}</td>
          <td class="mrp">${mrp > 0 ? fmtMoney(mrp) : "—"}</td>
          <td class="tax">${tax ? `${tax}%` : "—"}</td>
          <td class="amnt">${fmtMoney(amount)}</td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${escapeHTML(sale.invoice_no || "")}</title>
<style>
  @page {
    size: A4;
    margin: 11mm 12mm;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    color: #0f172a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .accent {
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(90deg, #4f46e5, #7c3aed, #06b6d4);
    margin-bottom: 20px;
  }

  .muted {
    color: #64748b;
  }

  table.head {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }

  table.head td {
    vertical-align: middle;
  }

  td.brand {
    width: 54%;
    vertical-align: top;
  }

  .brand-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .brand-row img.logo {
    max-height: 78px;
    max-width: 100px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 5px;
    background: #fff;
  }

  .brand-name {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.2px;
    color: #0f172a;
  }

  .tagline {
    font-size: 13.5px;
    color: #64748b;
    line-height: 1.6;
    margin-top: 4px;
  }

  .bank-inline {
    font-size: 12.5px;
    color: #475569;
    line-height: 1.6;
    margin-top: 4px;
  }

  td.meta {
    text-align: right;
  }

  .doctype {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #4f46e5;
    margin-bottom: 8px;
  }

  .inv-no {
    display: inline-block;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 8px;
    padding: 7px 16px;
    margin-bottom: 8px;
  }

  .meta-line {
    font-size: 13.5px;
    color: #475569;
    line-height: 1.55;
  }

  .meta-line strong {
    color: #0f172a;
    font-weight: 600;
  }

  .billto {
    margin-top: 18px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 18px;
    page-break-inside: avoid;
  }

  .billto .label {
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #4f46e5;
    margin-bottom: 4px;
  }

  .billto .cname {
    font-size: 17px;
    font-weight: 700;
  }

  .billto .sub {
    font-size: 13.5px;
    color: #64748b;
    line-height: 1.5;
    margin-bottom: 9px;
  }

  .bill-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-top: 1px dashed #e2e8f0;
    padding-top: 9px;
  }

  .bill-meta .chip {
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12.5px;
    color: #3730a3;
    white-space: nowrap;
  }

  .bill-meta .chip b {
    color: #0f172a;
    font-weight: 700;
  }

  .bill-meta .chip .lbl {
    color: #64748b;
    font-weight: 600;
  }

  table.items {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    margin-top: 12px;
  }

  table.items thead {
    display: table-header-group;
  }

  table.items th {
    background: #4f46e5;
    color: #fff;
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    text-align: right;
    padding: 8px 7px;
    border-bottom: 2px solid #3730a3;
  }

  table.items th:first-child {
    border-radius: 8px 0 0 0;
  }

  table.items th:last-child {
    border-radius: 0 8px 0 0;
  }

  table.items td {
    padding: 7px 7px;
    border-bottom: 1px solid #eef2f7;
    font-size: 14px;
    text-align: right;
    page-break-inside: avoid;
  }

  table.items tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  table.items tbody tr:last-child td {
    border-bottom: 1px solid #4f46e5;
  }

  /* Column budget for the 182mm (688px) A4 text column.
     With table-layout:fixed a width is the BORDER box, so every column also
     has to pay for its own horizontal padding. These used to be sized too
     tight: HSN (avail 42px vs 47px needed) spilled into the item column on
     every single row, and the "#" column (avail 8px) collided with the item
     name from row 10 onwards. Sized as (widest realistic value + padding),
     which hands the leftover width to the item column - the one that matters.
     The body font is 14px, so each width below is (widest realistic value +
     padding) at that size - e.g. an amount like "Rs 123,456" needs ~72px at
     14px plus 14px of padding. The 12px-era values were scaled by 14/12 and
     then trimmed back down, because the item column is the one that suffers
     when over-generous. Re-scale these together with the font - bumping
     fonts alone re-opens the HSN/"#" overflow this budget exists to prevent. */
  table.items th.num,
  table.items td.num {
    text-align: center;
    width: 35px;
    padding-left: 6px;
    padding-right: 6px;
    color: #94a3b8;
  }

  table.items th.item,
  table.items td.item {
    text-align: left;
    font-weight: 600;
    overflow-wrap: break-word;
  }

  table.items th.hsn,
  table.items td.hsn {
    text-align: center;
    width: 74px;
    padding-left: 6px;
    padding-right: 6px;
    color: #475569;
    font-size: 12.5px;
    /* Long HSN/SAC codes are a single unbreakable token: without this they
       spill into the item column instead of wrapping. */
    overflow-wrap: anywhere;
  }

  table.items th.qty,
  table.items td.qty {
    width: 60px;
    padding-left: 7px;
    padding-right: 7px;
  }

  table.items th.price,
  table.items td.price {
    width: 90px;
    padding-left: 7px;
    padding-right: 7px;
  }

  table.items th.mrp,
  table.items td.mrp {
    width: 80px;
    padding-left: 7px;
    padding-right: 7px;
    color: #475569;
    font-size: 12.5px;
  }

  table.items th.tax,
  table.items td.tax {
    width: 40px;
    padding-left: 6px;
    padding-right: 6px;
    color: #475569;
  }

  table.items th.amnt,
  table.items td.amnt {
    width: 94px;
    padding-left: 7px;
    padding-right: 7px;
    font-weight: 700;
  }

  .unit {
    color: #94a3b8;
    font-weight: 400;
    font-size: 12px;
  }

  .totals-box {
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 18px;
    /* Never let totals or the signature be cut in half by a page edge. */
    page-break-inside: avoid;
    break-inside: avoid;
  }

  table.totals {
    border-collapse: separate;
    border-spacing: 0;
    width: 46%;
    font-size: 13.5px;
  }

  table.totals tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  table.totals td {
    padding: 5px 12px;
  }

  table.totals td:last-child {
    text-align: right;
    font-weight: 600;
  }

  table.totals tr.grand td {
    background: #4f46e5;
    color: #fff;
    font-size: 15px;
    font-weight: 800;
    padding-top: 8px;
    padding-bottom: 8px;
  }

  table.totals tr.grand td:first-child {
    border-radius: 8px 0 0 8px;
  }

  table.totals tr.grand td:last-child {
    border-radius: 0 8px 8px 0;
    font-size: 17px;
  }

  table.totals tr.paid td:last-child {
    color: #059669;
    font-weight: 700;
  }

  table.totals tr.saved td:last-child {
    color: #059669;
    font-weight: 700;
  }

  table.totals tr.due td:last-child {
    color: #e11d48;
    font-weight: 700;
  }

  .qr {
    text-align: center;
  }

  .qr img {
    width: 92px;
    height: 92px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 3px;
    background: #fff;
  }

  .head-qr {
    display: inline-block;
  }

  .head-qr img {
    width: 110px;
    height: 110px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 4px;
    background: #fff;
  }

  .scan-label {
    font-size: 11px;
    color: #64748b;
    margin-top: 3px;
    letter-spacing: 0.4px;
  }

  .totals-box .sign-box {
    width: 240px;
    text-align: center;
    font-size: 13.5px;
    color: #64748b;
  }

  .totals-box .sign-box .line {
    border-top: 1.5px solid #0f172a;
    padding-top: 6px;
    margin-bottom: 3px;
  }

  .footer-note {
    margin-top: 26px;
    text-align: center;
    font-size: 12.5px;
    color: #64748b;
    line-height: 1.7;
    border-top: 1px dashed #e2e8f0;
    padding-top: 12px;
    page-break-inside: avoid;
  }

  .footer-note .thanks {
    font-size: 17px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 3px;
  }
</style>
</head>
<body>
<div class="page">
  <div class="accent"></div>

  <table class="head">
    <tr>
      <td class="brand">
        <div class="brand-row">
          ${store.logo ? `<img class="logo" src="${store.logo}" alt="logo" />` : ""}
          <div>
            <div class="brand-name">${escapeHTML(store.name)}</div>
            ${taglineParts ? `<div class="tagline">${taglineParts}</div>` : ""}
            ${bankInline ? `<div class="bank-inline">${bankInline}</div>` : ""}
          </div>
        </div>
      </td>
      <td class="meta">
        <div class="doctype">Invoice</div>
        ${store.qrCode ? `
        <div class="qr head-qr">
          <img src="${store.qrCode}" alt="payment QR" />
          <div class="scan-label">SCAN TO PAY</div>
        </div>
        ` : `
        <div><span class="inv-no">${escapeHTML(sale.invoice_no || "—")}</span></div>
        <div class="meta-line">
          <strong>${escapeHTML(date)}</strong>
          ${sale.payment_method ? `&nbsp;&middot;&nbsp;<strong>${escapeHTML((sale.payment_method || "cash").toUpperCase())}</strong>` : ""}
          ${sale.status ? `<span class="muted">&nbsp;&middot;&nbsp;${escapeHTML((sale.status || "paid").toUpperCase())}</span>` : ""}
        </div>
        `}
      </td>
    </tr>
  </table>

  <div class="billto">
    <div class="label">Billed To</div>
    <div class="cname">${escapeHTML(sale.customer || "Walk-in")}</div>
    <div class="sub">
      ${sale.customer_phone ? `Ph: ${escapeHTML(sale.customer_phone)}&nbsp;&middot;&nbsp;` : ""}
      ${sale.note ? `Note: ${escapeHTML(sale.note)}` : ""}
    </div>
    <div class="bill-meta">
      <span class="chip"><span class="lbl">Invoice&nbsp;No.</span>&nbsp;<b>${escapeHTML(sale.invoice_no || "—")}</b></span>
      <span class="chip"><span class="lbl">Date</span>&nbsp;<b>${escapeHTML(date)}</b></span>
      ${sale.payment_method ? `<span class="chip"><span class="lbl">Payment</span>&nbsp;<b>${escapeHTML((sale.payment_method || "cash").toUpperCase())}</b></span>` : ""}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th class="item">Item</th>
        <th class="hsn">HSN</th>
        <th class="qty">Qty</th>
        <th class="price">Price</th>
        <th class="mrp">MRP</th>
        <th class="tax">Tax</th>
        <th class="amnt">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-box">
    <div class="sign-box">
      <div class="line">For ${escapeHTML(store.name || "the store")}</div>
      Authorized signatory
    </div>
    <table class="totals">
      <tr><td>Subtotal</td><td>${fmtMoney(subtotal)}</td></tr>
      ${taxTotal ? `<tr><td>Tax (included)</td><td>${fmtMoney(taxTotal)}</td></tr>` : ""}
      ${savedTotal > 0 ? `<tr class="saved"><td>You Saved vs MRP</td><td>${fmtMoney(savedTotal)}</td></tr>` : ""}
      <tr class="grand"><td>Grand Total</td><td>${fmtMoney(total)}</td></tr>
      <tr class="paid"><td>Paid</td><td>${fmtMoney(paid)}</td></tr>
      ${outstanding > 0 ? `<tr class="due"><td>Balance Due</td><td>${fmtMoney(outstanding)}</td></tr>` : ""}
    </table>
  </div>

  <div class="footer-note">
    <div class="thanks">${escapeHTML(store.footerText || "Thank you for your business!")}</div>
    <div>Printed ${new Date().toLocaleString()}</div>
  </div>
</div>
</body>
</html>`;
}

export function printProductCatalogue(store, products = []) {
  const info = {
    name: store.name || "Royal Spicy Masala",
    address: store.address || "",
    phone: store.phone || "",
    ...store
  };

  const html = buildCatalogueHTML(info, products);
  printHTML(html);
}

function buildCatalogueHTML(store, products) {
  const groups = [];
  products.forEach((p) => {
    const key = p.category || "Uncategorized";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, subcategory: p.subcategory || "", items: [] };
      groups.push(g);
    }
    g.items.push(p);
  });

  const totalCount = products.length;
  const date = new Date().toLocaleDateString();

  const taglineParts = [
    store.address ? escapeHTML(store.address) : "",
    store.phone ? `Ph: ${escapeHTML(store.phone)}` : "",
    store.taxNo ? `Tax No: ${escapeHTML(store.taxNo)}` : ""
  ].filter(Boolean).join("&nbsp;&middot;&nbsp;");

  const sections = groups
    .map((g) => {
      const rows = g.items
        .map((p, i) => {
          const selling = Number(p.selling_price) || 0;
          const market = Number(p.market_price) || 0;
          const stock = Number(p.stock) || 0;
          const unit = escapeHTML(p.unit || "pcs");
          return `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="item">
            ${escapeHTML(p.name || "—")}
            ${p.sku ? `<div class="sku">${escapeHTML(p.sku)}</div>` : ""}
          </td>
          <td class="unit">${unit}</td>
          <td class="hsn">${escapeHTML(p.hsn_code || "—")}</td>
          <td class="mrp">${market > 0 ? fmtMoney(market) : "—"}</td>
          <td class="price">${selling > 0 ? fmtMoney(selling) : "—"}</td>
          <td class="stock">${stock} ${unit}</td>
        </tr>`;
        })
        .join("");
      const heading = g.subcategory ? `<span class="sub"> · ${escapeHTML(g.subcategory)}</span>` : "";
      return `
    <div class="section">
      <div class="section-head">
        <span class="name">${escapeHTML(g.key)}</span>${heading}
        <span class="count">${g.items.length} item${g.items.length === 1 ? "" : "s"}</span>
      </div>
      <table class="items">
        <thead>
          <tr>
            <th class="num">#</th>
            <th class="item">Product</th>
            <th class="unit">Unit</th>
            <th class="hsn">HSN</th>
            <th class="mrp">MRP</th>
            <th class="price">Selling</th>
            <th class="stock">Stock</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Product Catalogue — ${escapeHTML(store.name)}</title>
<style>
  @page {
    size: A4;
    margin: 16mm 18mm;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    color: #0f172a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .accent {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, #4f46e5, #7c3aed, #06b6d4);
    margin-bottom: 16px;
  }

  table.head {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }

  table.head td {
    vertical-align: middle;
  }

  td.brand {
    width: 62%;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-row img.logo {
    max-height: 64px;
    max-width: 80px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 4px;
    background: #fff;
  }

  .brand-name {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.2px;
    color: #0f172a;
  }

  .tagline {
    font-size: 12px;
    color: #64748b;
    line-height: 1.6;
    margin-top: 3px;
  }

  td.meta {
    text-align: right;
  }

  .doctype {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #4f46e5;
    margin-bottom: 6px;
  }

  .doc-badge {
    display: inline-block;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 8px;
    padding: 5px 14px;
    margin-bottom: 6px;
  }

  .meta-line {
    font-size: 12px;
    color: #475569;
  }

  .section {
    margin-top: 14px;
    page-break-inside: auto;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    background: #eef2ff;
    border-left: 4px solid #4f46e5;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 700;
    color: #1e1b4b;
    letter-spacing: 0.3px;
    page-break-inside: avoid;
  }

  .section-head .name {
    text-transform: uppercase;
  }

  .section-head .sub {
    font-weight: 600;
    color: #64748b;
    font-size: 12px;
  }

  .section-head .count {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    color: #4f46e5;
  }

  .section, table.items {
    page-break-inside: auto;
  }

  table.items {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    margin-top: 4px;
  }

  table.items thead {
    display: table-header-group;
  }

  table.items th {
    background: #4f46e5;
    color: #fff;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    text-align: right;
    padding: 6px 8px;
    border-bottom: 2px solid #3730a3;
  }

  table.items th:first-child {
    border-radius: 8px 0 0 0;
  }

  table.items th:last-child {
    border-radius: 0 8px 0 0;
  }

  table.items td {
    padding: 5px 8px;
    border-bottom: 1px solid #eef2f7;
    font-size: 11.5px;
    text-align: right;
  }

  table.items tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  table.items tbody tr:last-child td {
    border-bottom: 1px solid #4f46e5;
  }

  table.items th.num,
  table.items td.num {
    text-align: center;
    width: 26px;
    color: #94a3b8;
  }

  table.items th.item,
  table.items td.item {
    text-align: left;
    font-weight: 650;
    word-wrap: break-word;
  }

  table.items .sku {
    font-weight: 400;
    font-size: 10px;
    color: #94a3b8;
  }

  table.items th.unit,
  table.items td.unit {
    width: 54px;
    color: #475569;
  }

  table.items th.hsn,
  table.items td.hsn {
    width: 52px;
    color: #475569;
    font-size: 10.5px;
  }

  table.items th.mrp,
  table.items td.mrp {
    width: 60px;
    color: #475569;
    font-size: 11px;
  }

  table.items th.price,
  table.items td.price {
    width: 78px;
    font-weight: 700;
  }

  table.items th.stock,
  table.items td.stock {
    width: 62px;
    color: #64748b;
    font-size: 10.5px;
  }

  .summary {
    margin-top: 16px;
    border-top: 2px solid #4f46e5;
    padding-top: 8px;
    text-align: right;
    font-size: 12px;
    font-weight: 600;
    color: #1e1b4b;
  }

  .footer-note {
    margin-top: 26px;
    text-align: center;
    font-size: 11px;
    color: #64748b;
    line-height: 1.7;
    border-top: 1px dashed #e2e8f0;
    padding-top: 10px;
  }

  .footer-note .thanks {
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 2px;
  }
</style>
</head>
<body>
<div class="page">
  <div class="accent"></div>

  <table class="head">
    <tr>
      <td class="brand">
        <div class="brand-row">
          ${store.logo ? `<img class="logo" src="${store.logo}" alt="logo" />` : ""}
          <div>
            <div class="brand-name">${escapeHTML(store.name)}</div>
            ${taglineParts ? `<div class="tagline">${taglineParts}</div>` : ""}
          </div>
        </div>
      </td>
      <td class="meta">
        <div class="doctype">Catalogue</div>
        <div><span class="doc-badge">Product Catalogue</span></div>
        <div class="meta-line">
          <strong>${escapeHTML(date)}</strong>
          &nbsp;&middot;&nbsp;<strong>${totalCount} item${totalCount === 1 ? "" : "s"}</strong>
        </div>
      </td>
    </tr>
  </table>

  ${sections}

  <div class="summary">
    Total products: ${totalCount} · Prices in ₹
  </div>

  <div class="footer-note">
    <div class="thanks">${escapeHTML(store.footerText || "Thank you for your business!")}</div>
    <div>All prices are subject to change without notice.</div>
    <div>Printed ${new Date().toLocaleString()}</div>
  </div>
</div>
</body>
</html>`;
}

export function printSupplierPurchaseBills(store, purchases = [], range = {}) {
  const info = {
    name: store.name || "Royal Spicy Masala",
    address: store.address || "",
    phone: store.phone || "",
    ...store
  };

  const html = buildPurchasesBillsHTML(info, purchases, range);
  printHTML(html);
}

function buildPurchasesBillsHTML(store, purchases, range) {
  const date = new Date().toLocaleString();
  const rangeLabel = [range.from || "", range.to || ""].filter(Boolean).join(" to ");
  const rangeText = rangeLabel ? ` · Range: ${escapeHTML(rangeLabel)}` : "";

  const taglineParts = [
    store.address ? escapeHTML(store.address) : "",
    store.phone ? `Ph: ${escapeHTML(store.phone)}` : "",
    store.taxNo ? `Tax No: ${escapeHTML(store.taxNo)}` : ""
  ].filter(Boolean).join("&nbsp;&middot;&nbsp;");

  const billPages = purchases
    .map((p, idx) => {
      const items = (p.items || []).map((it) => {
        const packSize = Number(it.pack_size) || 1;
        const qty = Number(it.quantity) || 1;
        const totalQty = qty * packSize;
        const sub = (Number(it.purchase_price) || 0) * totalQty;
        const taxAmt = (sub * (Number(it.tax) || 0)) / 100;
        const amount = sub + taxAmt - (Number(it.discount) || 0);
        return { ...it, packSize, qty, totalQty, amount };
      });
      const itemsTotal = items.reduce((a, it) => a + it.amount, 0);
      const charges = Number(p.additional_charges) || 0;
      const grandTotal = itemsTotal + charges || Number(p.grand_total) || 0;

      const itemRows = items
        .map(
          (it) => `
        <tr>
          <td class="num">${idx + 1}</td>
          <td class="item">
            ${escapeHTML(it.item_name || "—")}
            ${it.hsn_code ? `<div class="sku">HSN: ${escapeHTML(it.hsn_code)}</div>` : ""}
          </td>
          <td class="unit">${escapeHTML(it.pack_sub_unit || "")}</td>
          <td class="num">${it.qty}</td>
          <td class="num">${it.packSize}</td>
          <td class="num">${it.totalQty}</td>
          <td class="price">${fmtMoney(it.purchase_price)}</td>
          <td class="price">${fmtMoney(it.amount)}</td>
        </tr>`
        )
        .join("");

      const billImage = p.bill_image
        ? `<div class="bill-shot">
        <img class="bill-img" src="${p.bill_image}" alt="Bill image" />
      </div>`
        : `<div class="no-bill">
        <p class="no-bill-title">No bill image uploaded for this purchase</p>
        <table class="items">
          <thead>
            <tr>
              <th class="num">#</th>
              <th class="item">Item</th>
              <th class="unit">Unit</th>
              <th class="num">Packs</th>
              <th class="num">Size</th>
              <th class="num">Qty</th>
              <th class="price">Rate</th>
              <th class="price">Amount</th>
            </tr>
          </thead>
          <tbody>${itemRows || `<tr><td class="num" colspan="8">No items</td></tr>`}</tbody>
        </table>
        ${charges > 0 ? `<div class="charges">Additional charges: ${fmtMoney(charges)}</div>` : ""}
        <div class="grand">Grand Total: ${fmtMoney(grandTotal)}</div>
      </div>`;

      return `
  <div class="bill-page${idx === 0 ? " first" : ""}">
    <div class="bill-head">
      <div>
        <p class="bill-name">${escapeHTML(p.supplier_name || "Unknown supplier")}</p>
        ${p.supplier_company ? `<p class="bill-company">${escapeHTML(p.supplier_company)}</p>` : ""}
      </div>
      <div class="bill-meta">
        <div class="meta-line"><strong>Date:</strong> ${escapeHTML(fmtDateTime(p.purchased_at))}</div>
        <div class="meta-line"><strong>Items:</strong> ${items.length}</div>
        <div class="meta-line"><strong>Total:</strong> ${fmtMoney(grandTotal)}</div>
      </div>
    </div>
    ${billImage}
    <div class="bill-foot">Bill #${p.id}${p.additional_charges ? ` &nbsp;&middot;&nbsp; Charges: ${fmtMoney(p.additional_charges)}` : ""}</div>
  </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Purchase Bills — ${escapeHTML(store.name)}</title>
<style>
  @page {
    size: A4;
    margin: 14mm 16mm;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    color: #0f172a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .accent {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, #4f46e5, #7c3aed, #06b6d4);
    margin-bottom: 14px;
  }

  table.head {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    margin-bottom: 8px;
  }

  table.head td {
    vertical-align: middle;
  }

  td.brand {
    width: 62%;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-row img.logo {
    max-height: 60px;
    max-width: 76px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 4px;
    background: #fff;
  }

  .brand-name {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.2px;
    color: #0f172a;
  }

  .tagline {
    font-size: 12px;
    color: #64748b;
    line-height: 1.6;
    margin-top: 3px;
  }

  td.meta {
    text-align: right;
  }

  .doctype {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #4f46e5;
    margin-bottom: 4px;
  }

  .doc-badge {
    display: inline-block;
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 8px;
    padding: 5px 14px;
    margin-bottom: 5px;
  }

  .meta-line {
    font-size: 12px;
    color: #475569;
  }

  .bill-page {
    page-break-inside: avoid;
    margin-top: 16px;
  }

  .bill-page + .bill-page {
    page-break-before: always;
  }

  .bill-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    background: #eef2ff;
    border-left: 4px solid #4f46e5;
    border-radius: 8px;
    padding: 10px 14px;
    page-break-inside: avoid;
  }

  .bill-name {
    font-size: 15px;
    font-weight: 800;
    color: #1e1b4b;
  }

  .bill-company {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
  }

  .bill-meta {
    text-align: right;
  }

  .bill-shot {
    margin-top: 10px;
    text-align: center;
    page-break-inside: avoid;
  }

  .bill-img {
    max-width: 100%;
    max-height: 215mm;
    object-fit: contain;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 4px;
    background: #fff;
  }

  .no-bill {
    margin-top: 10px;
  }

  .no-bill-title {
    font-size: 12px;
    font-weight: 700;
    color: #94a3b8;
    margin-bottom: 8px;
  }

  table.items {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }

  table.items thead {
    display: table-header-group;
  }

  table.items th {
    background: #4f46e5;
    color: #fff;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    text-align: right;
    padding: 6px 8px;
    border-bottom: 2px solid #3730a3;
  }

  table.items th:first-child {
    border-radius: 8px 0 0 0;
  }

  table.items th:last-child {
    border-radius: 0 8px 0 0;
  }

  table.items td {
    padding: 5px 8px;
    border-bottom: 1px solid #eef2f7;
    font-size: 11.5px;
    text-align: right;
  }

  table.items tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  table.items tbody tr:last-child td {
    border-bottom: 1px solid #4f46e5;
  }

  table.items th.num,
  table.items td.num {
    text-align: center;
    width: 30px;
    color: #94a3b8;
  }

  table.items th.item,
  table.items td.item {
    text-align: left;
    font-weight: 650;
    word-wrap: break-word;
  }

  table.items .sku {
    font-weight: 400;
    font-size: 10px;
    color: #94a3b8;
  }

  table.items th.unit,
  table.items td.unit {
    width: 48px;
    color: #475569;
  }

  table.items th.price,
  table.items td.price {
    width: 82px;
    font-weight: 700;
  }

  .charges {
    margin-top: 8px;
    text-align: right;
    font-size: 11.5px;
    color: #475569;
  }

  .grand {
    margin-top: 6px;
    border-top: 2px solid #4f46e5;
    padding-top: 7px;
    text-align: right;
    font-size: 13px;
    font-weight: 800;
    color: #1e1b4b;
  }

  .bill-foot {
    margin-top: 8px;
    font-size: 10.5px;
    color: #94a3b8;
    text-align: right;
  }

  .footer-note {
    margin-top: 22px;
    text-align: center;
    font-size: 11px;
    color: #64748b;
    line-height: 1.7;
    border-top: 1px dashed #e2e8f0;
    padding-top: 10px;
  }

  .footer-note .thanks {
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 2px;
  }
</style>
</head>
<body>
<div class="accent"></div>

<table class="head">
  <tr>
    <td class="brand">
      <div class="brand-row">
        ${store.logo ? `<img class="logo" src="${store.logo}" alt="logo" />` : ""}
        <div>
          <div class="brand-name">${escapeHTML(store.name)}</div>
          ${taglineParts ? `<div class="tagline">${taglineParts}</div>` : ""}
        </div>
      </div>
    </td>
    <td class="meta">
      <div class="doctype">Purchase Bills</div>
      <div><span class="doc-badge">Supplier Purchase Bills</span></div>
      <div class="meta-line">
        <strong>${escapeHTML(date)}</strong>
        &nbsp;&middot;&nbsp;<strong>${purchases.length} bill${purchases.length === 1 ? "" : "s"}</strong>${rangeText}
      </div>
    </td>
  </tr>
</table>

${billPages}

<div class="footer-note">
  <div class="thanks">${escapeHTML(store.footerText || "Thank you for your business!")}</div>
  <div>Bill images shown as uploaded. Generated ${escapeHTML(date)}</div>
</div>
</body>
</html>`;
}

function storeBankText(store) {
  return [
    store.bankHolder ? `Acct Holder: ${escapeHTML(store.bankHolder)}` : "",
    store.bankName ? `Bank: ${escapeHTML(store.bankName)}` : "",
    store.bankAccountNo ? `Acct: ${escapeHTML(store.bankAccountNo)}` : "",
    store.ifsc ? `IFSC: ${escapeHTML(store.ifsc)}` : ""
  ].filter(Boolean);
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printVoucherSlip(store = {}, vouchers = [], meta = {}) {
  const info = {
    name: store.name || "Royal Spicy Masala",
    address: store.address || "",
    phone: store.phone || "",
    ...store
  };
  const html = buildVoucherSlipHTML(info, vouchers, meta);
  printHTML(html);
}

function buildVoucherSlipHTML(store, vouchers, meta) {
  const list = Array.isArray(vouchers) ? vouchers : [];
  const campaign = (meta.campaign || "Offer").toString().trim() || "Offer";
  const ongoing = Number(meta.ongoing_discount) || 0;
  const customerName = meta.customerName || "";

  const taglineParts = [
    store.address ? escapeHTML(store.address) : "",
    store.phone ? `Ph: ${escapeHTML(store.phone)}` : ""
  ].filter(Boolean).join("&nbsp;&middot;&nbsp;");

  const couponCards = list
    .map((v, i) => {
      const amount = Number(v.amount) || 0;
      const validTxt = v.month_label
        ? `Valid month: <strong>${escapeHTML(v.month_label)}</strong>`
        : v.valid_to
          ? `Valid till <strong>${escapeHTML(String(v.valid_to).slice(0, 10))}</strong>`
          : "";
      return `
        <div class="coupon">
          <div class="coupon-top">
            <div class="amount">Rs ${amount || 0}</div>
            <div class="off">OFF</div>
          </div>
          <div class="coupon-code">${escapeHTML(v.code || "—")}</div>
          <div class="coupon-meta">
            <div>${escapeHTML(v.customer_name || customerName || "Valued Customer")}</div>
            ${validTxt ? `<div>${validTxt}</div>` : ""}
          </div>
          <div class="cutout left"></div>
          <div class="cutout right"></div>
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Discount Vouchers — ${escapeHTML(campaign)}</title>
<style>
  @page { size: A4; margin: 11mm 14mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px; color: #0f172a; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .accent { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #d97706, #f59e0b, #4f46e5); margin-bottom: 16px; }

  table.head { width: 100%; table-layout: fixed; border-collapse: collapse; }
  table.head td { vertical-align: middle; }
  td.brand { width: 62%; }
  .brand-row { display: flex; align-items: center; gap: 12px; }
  .brand-row img.logo { max-height: 60px; max-width: 80px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; background: #fff; }
  .brand-name { font-size: 24px; font-weight: 800; color: #0f172a; }
  .tagline { font-size: 12px; color: #64748b; line-height: 1.6; margin-top: 3px; }
  td.meta { text-align: right; }
  .doctype { font-size: 13px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #b45309; margin-bottom: 5px; }
  .campaign-name { display: inline-block; font-size: 18px; font-weight: 800; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 4px 12px; }

  .intro { margin-top: 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 10px 14px; font-size: 12px; line-height: 1.7; color: #78350f; }
  .intro strong { color: #92400e; }

  .grid { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .coupon { position: relative; border: 1.5px dashed #d97706; border-radius: 14px; padding: 14px 16px; background: #fffdf5; page-break-inside: avoid; }
  .coupon-top { display: flex; align-items: baseline; gap: 8px; }
  .amount { font-size: 30px; font-weight: 800; color: #b45309; }
  .off { font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #d97706; }
  .coupon-code { margin-top: 8px; font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #0f172a; }
  .coupon-meta { margin-top: 8px; font-size: 11.5px; color: #475569; line-height: 1.6; }
  .coupon-meta strong { color: #0f172a; }
  .cutout { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 1.5px solid #d97706; }
  .cutout.left { left: -9px; transform: translateY(-50%); }
  .cutout.right { right: -9px; transform: translateY(-50%); }

  .foot { margin-top: 22px; border-top: 1px solid #e2e8f0; padding-top: 12px; display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; page-break-inside: avoid; }
  .foot .label { font-size: 11px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: #b45309; margin-bottom: 4px; }
  .bank-line { font-size: 12px; line-height: 1.7; color: #334155; }

  .footer-note { margin-top: 20px; text-align: center; font-size: 11px; color: #64748b; line-height: 1.7; border-top: 1px dashed #e2e8f0; padding-top: 10px; page-break-inside: avoid; }
  .footer-note .thanks { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
</style>
</head>
<body>
<div class="page">
  <div class="accent"></div>

  <table class="head">
    <tr>
      <td class="brand">
        <div class="brand-row">
          ${store.logo ? `<img class="logo" src="${store.logo}" alt="logo" />` : ""}
          <div>
            <div class="brand-name">${escapeHTML(store.name)}</div>
            ${taglineParts ? `<div class="tagline">${taglineParts}</div>` : ""}
          </div>
        </div>
      </td>
      <td class="meta">
        <div class="doctype">Discount Vouchers</div>
        <div><span class="campaign-name">${escapeHTML(campaign)}</span></div>
      </td>
    </tr>
  </table>

  ${customerName ? `<div class="intro">Gift vouchers for <strong>${escapeHTML(customerName)}</strong> — redeem one voucher in each of the next months.</div>` : `<div class="intro">Gift vouchers for our valued customers.<strong> Don't miss out!</strong></div>`}

  <div class="grid">${couponCards || `<div class="coupon"><div>No vouchers on this slip.</div></div>`}</div>

  ${ongoing > 0 ? `
  <div class="foot">
    <div>
      <div class="label">Plus ongoing discount</div>
      <div class="bank-line">Enjoy an <strong>extra ${ongoing}% off</strong> on every purchase on top of the voucher discount. No minimum order.</div>
    </div>
  </div>
  ` : ""}

  <div class="footer-note">
    <div class="thanks">${escapeHTML(store.footerText || "Thank you for your business!")}</div>
    <div>Vouchers are valid only for the month shown on each coupon and cannot be exchanged for cash.</div>
    <div>Printed ${new Date().toLocaleString()}</div>
  </div>
</div>
</body>
</html>`;
}

export function printQuotationA4(quote = {}, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };
  const html = buildQuotationHTML(store, quote);
  printHTML(html);
}

function buildQuotationHTML(store, quote) {
  const items = Array.isArray(quote.items) ? quote.items : [];
  const subtotal = items.reduce((a, it) => a + (Number(it.rate) || 0) * (Number(it.qty) || 0), 0);
  const discountPct = Number(quote.discountPct) || 0;
  const taxPct = Number(quote.taxPct) || 0;
  const discountAmt = (subtotal * discountPct) / 100;
  const taxable = subtotal - discountAmt;
  const taxAmt = (taxable * taxPct) / 100;
  const total = taxable + taxAmt;

  const taglineParts = [
    store.address ? escapeHTML(store.address) : "",
    store.phone ? `Ph: ${escapeHTML(store.phone)}` : "",
    store.taxNo ? `Tax No: ${escapeHTML(store.taxNo)}` : ""
  ].filter(Boolean).join("&nbsp;&middot;&nbsp;");

  const itemRows = items
    .map((it, i) => {
      const qty = Number(it.qty) || 0;
      const rate = Number(it.rate) || 0;
      const amount = rate * qty;
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="item">${escapeHTML(it.name || "Item")}<div class="item-sub">${escapeHTML(it.note || "")}</div></td>
          <td class="hsn">${escapeHTML(it.hsn || "—")}</td>
          <td class="qty">${qty}${it.unit ? ` <span class="unit">${escapeHTML(it.unit)}</span>` : ""}</td>
          <td class="rate">${fmtMoney(rate)}</td>
          <td class="amnt">${fmtMoney(amount)}</td>
        </tr>`;
    })
    .join("");

  const dateLine = quote.date ? escapeHTML(quote.date) : new Date().toLocaleDateString();
  const validLine = quote.validUntil ? `Valid until <strong>${escapeHTML(quote.validUntil)}</strong>` : "";
  const customerName = quote.customerName || "Walk-in client";
  const customerSubs = [quote.customerPhone, quote.customerAddress]
    .filter(Boolean)
    .map((s) => escapeHTML(s));

  const bankLines = storeBankText(store);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Quotation ${escapeHTML(quote.number || "")}</title>
<style>
  @page { size: A4; margin: 11mm 14mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px; color: #0f172a; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .accent { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #4f46e5, #7c3aed, #06b6d4); margin-bottom: 18px; }
  .muted { color: #64748b; }

  table.head { width: 100%; table-layout: fixed; border-collapse: collapse; }
  table.head td { vertical-align: middle; }
  td.brand { width: 62%; }
  .brand-row { display: flex; align-items: center; gap: 12px; }
  .brand-row img.logo { max-height: 64px; max-width: 80px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; background: #fff; }
  .brand-name { font-size: 26px; font-weight: 800; letter-spacing: 0.2px; color: #0f172a; }
  .tagline { font-size: 12px; color: #64748b; line-height: 1.6; margin-top: 3px; }
  td.meta { text-align: right; }
  .doctype { font-size: 13px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #4f46e5; margin-bottom: 6px; }
  .inv-no { display: inline-block; font-size: 19px; font-weight: 800; letter-spacing: 0.5px; color: #0f172a; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 5px 14px; margin-bottom: 6px; }
  .meta-line { font-size: 12px; color: #475569; }
  .meta-line strong { color: #0f172a; font-weight: 600; }

  .billto { margin-top: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; page-break-inside: avoid; }
  .billto .label { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #4f46e5; margin-bottom: 3px; }
  .billto .cname { font-size: 15px; font-weight: 700; }
  .billto .sub { font-size: 12px; color: #64748b; line-height: 1.5; }

  table.items { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; margin-top: 12px; }
  table.items thead {
    display: table-header-group;
  }

  /* Repeats the column headings on every page of a long invoice. */
  table.items tbody tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  table.items th { background: #4f46e5; color: #fff; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; text-align: right; padding: 7px 8px; border-bottom: 2px solid #3730a3; }
  table.items th:first-child { border-radius: 8px 0 0 0; }
  table.items th:last-child { border-radius: 0 8px 0 0; }
  table.items td { padding: 6px 8px; border-bottom: 1px solid #eef2f7; font-size: 12px; text-align: right; page-break-inside: avoid; }
  table.items tbody tr:nth-child(even) { background: #f8fafc; }
  table.items tbody tr:last-child td { border-bottom: 1px solid #4f46e5; }
  table.items th.num, table.items td.num { text-align: center; width: 24px; color: #94a3b8; }
  table.items th.item, table.items td.item { text-align: left; font-weight: 650; word-wrap: break-word; }
  table.items td.item .item-sub { font-size: 10px; color: #94a3b8; font-weight: 400; }
  table.items th.hsn, table.items td.hsn { text-align: center; width: 58px; color: #475569; font-size: 11px; }
  table.items th.qty, table.items td.qty { width: 76px; }
  table.items th.rate, table.items td.rate { width: 92px; }
  table.items th.amnt, table.items td.amnt { width: 100px; }

  .totals-box { margin-top: 10px; display: flex; justify-content: flex-end; }
  table.totals { border-collapse: separate; border-spacing: 0; width: 44%; font-size: 11.5px; }
  table.totals td { padding: 4px 10px; }
  table.totals td:last-child { text-align: right; font-weight: 600; }
  table.totals tr.grand td { background: #4f46e5; color: #fff; font-size: 13px; font-weight: 800; padding-top: 6px; padding-bottom: 6px; }
  table.totals tr.grand td:first-child { border-radius: 8px 0 0 8px; }
  table.totals tr.grand td:last-child { border-radius: 0 8px 8px 0; font-size: 14.5px; }
  table.totals tr.disc td:last-child { color: #e11d48; font-weight: 700; }
  table.totals tr.tax td:last-child { color: #4f46e5; font-weight: 700; }

  .terms { margin-top: 18px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 10px 14px; font-size: 11.5px; line-height: 1.7; color: #78350f; page-break-inside: avoid; }
  .terms .label { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #b45309; margin-bottom: 3px; }

  .foot { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 14px; display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; page-break-inside: avoid; }
  .foot .label { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #4f46e5; margin-bottom: 4px; }
  .bank-line { font-size: 12px; line-height: 1.7; color: #334155; }
  .qr { text-align: center; }
  .qr img { width: 80px; height: 80px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px; background: #fff; }
  .scan-label { font-size: 10px; color: #64748b; margin-top: 3px; letter-spacing: 0.4px; }

  .sign-row { margin-top: 34px; display: flex; justify-content: space-between; page-break-inside: avoid; }
  .sign-box { width: 220px; text-align: center; font-size: 12px; color: #64748b; }
  .sign-box .line { border-top: 1.5px solid #0f172a; padding-top: 5px; margin-bottom: 3px; }

  .footer-note { margin-top: 24px; text-align: center; font-size: 11px; color: #64748b; line-height: 1.7; border-top: 1px dashed #e2e8f0; padding-top: 10px; page-break-inside: avoid; }
  .footer-note .thanks { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
</style>
</head>
<body>
<div class="page">
  <div class="accent"></div>

  <table class="head">
    <tr>
      <td class="brand">
        <div class="brand-row">
          ${store.logo ? `<img class="logo" src="${store.logo}" alt="logo" />` : ""}
          <div>
            <div class="brand-name">${escapeHTML(store.name)}</div>
            ${taglineParts ? `<div class="tagline">${taglineParts}</div>` : ""}
          </div>
        </div>
      </td>
      <td class="meta">
        <div class="doctype">Quotation</div>
        <div><span class="inv-no">${escapeHTML(quote.number || "—")}</span></div>
        <div class="meta-line">
          <strong>${dateLine}</strong>
          ${validLine ? `&nbsp;&middot;&nbsp;${validLine}` : ""}
        </div>
      </td>
    </tr>
  </table>

  <div class="billto">
    <div class="label">Prepared For</div>
    <div class="cname">${escapeHTML(customerName)}</div>
    ${customerSubs.length ? `<div class="sub">${customerSubs.map((s) => s).join("<br>")}</div>` : ""}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th class="item">Item</th>
        <th class="hsn">HSN</th>
        <th class="qty">Qty</th>
        <th class="rate">Rate</th>
        <th class="amnt">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows || `<tr><td class="item muted" colspan="6">No items yet.</td></tr>`}</tbody>
  </table>

  <div class="totals-box">
    <table class="totals">
      <tr><td>Subtotal</td><td>${fmtMoney(subtotal)}</td></tr>
      ${discountAmt > 0 ? `<tr class="disc"><td>Discount (${discountPct}%)</td><td>− ${fmtMoney(discountAmt)}</td></tr>` : ""}
      ${taxAmt > 0 ? `<tr class="tax"><td>GST (${taxPct}%)</td><td>+ ${fmtMoney(taxAmt)}</td></tr>` : ""}
      <tr class="grand"><td>Quotation Total</td><td>${fmtMoney(total)}</td></tr>
    </table>
  </div>

  ${quote.notes ? `
  <div class="terms">
    <div class="label">Terms &amp; Notes</div>
    ${escapeHTML(quote.notes)}
  </div>
  ` : ""}

  ${store.qrCode || bankLines.length ? `
  <div class="foot">
    ${bankLines.length ? `
    <div>
      <div class="label">Payment / Bank Details</div>
      ${bankLines.map((l) => `<div class="bank-line">${l}</div>`).join("")}
    </div>
    ` : ""}
    ${store.qrCode ? `
    <div class="qr">
      <img src="${store.qrCode}" alt="payment QR" />
      <div class="scan-label">SCAN TO PAY</div>
    </div>
    ` : ""}
  </div>
  ` : ""}

  <div class="sign-row">
    <div class="sign-box">
      <div class="line">Customer signature</div>
    </div>
    <div class="sign-box">
      <div class="line">For ${escapeHTML(store.name || "the store")}</div>
      Authorized signatory
    </div>
  </div>

  <div class="footer-note">
    <div class="thanks">${escapeHTML(store.footerText || "Thank you for your business!")}</div>
    ${validLine ? `<div>${escapeHTML(validLine.replace(/<[^>]*>/g, ""))} · Prices are subject to change.</div>` : ""}
    <div>Printed ${new Date().toLocaleString()}</div>
  </div>
</div>
</body>
</html>`;
}
