import { fmtMoney, fmtDateTime } from "./format.js";

export function printReceipt(sale, items, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };

  const html = buildReceiptHTML(store, sale, items);
  printHTML(html);
}

export function printInvoiceA4(sale, items, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };

  const html = buildInvoiceA4HTML(store, sale, items);
  printHTML(html);
}

function printHTML(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    setTimeout(() => iframe.remove(), 400);
  };
  win.onafterprint = cleanup;
  win.onbeforeunload = cleanup;
  setTimeout(cleanup, 30000);

  let tries = 0;
  const readyTimer = setInterval(() => {
    tries += 1;
    const imagesReady = Array.from(doc.querySelectorAll("img")).every((im) => im.complete);
    const ready = doc.readyState === "complete" && imagesReady;
    if (ready || tries > 160) {
      clearInterval(readyTimer);
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch (e) {
          /* print dialog interrupted — iframe is cleaned up automatically */
        }
      }, 220);
    }
  }, 50);
}

function buildReceiptHTML(store, sale, items) {
  const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
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
      const lineTotal = price * qty;
      return `
        <tr>
          <td class="item-name">${escapeHTML(name)}</td>
          <td class="item-qty">${qty}</td>
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

  /* ===== THERMAL 58mm ===== */
  @media print and (max-width: 80mm) {
    body {
      width: 48mm;
      font-size: 10px;
    }
    .receipt {
      width: 48mm;
      padding: 2mm;
    }
    .store-name {
      font-size: 14px;
      letter-spacing: 0.5px;
    }
    .store-logo img {
      max-height: 40px;
    }
    .payment-qr img {
      width: 70px;
      height: 70px;
    }
    .store-details {
      font-size: 9px;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 2mm 0;
    }
    .item-name { max-width: 22mm; }
    .item-qty, .item-price, .item-total {
      text-align: right;
    }
    table {
      width: 100%;
      font-size: 9px;
    }
    th, td {
      padding: 0.5mm 0;
    }
    .totals {
      font-size: 10px;
    }
    .footer {
      font-size: 8px;
    }
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

  thead th:nth-child(2),
  thead th:nth-child(3),
  thead th:nth-child(4) {
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

  .totals .row.paid .value {
    color: #16a34a;
  }

  .totals .row.outstanding .value {
    color: #dc2626;
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
        <th>Qty</th>
        <th>Price</th>
        <th>Total</th>
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
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const outstanding = total - paid;
  const date = sale.created_at ? fmtDateTime(sale.created_at) : new Date().toLocaleString();
  const bankLines = storeBankText(store);

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
      const tax = Number(it.tax) || 0;
      const amount = price * qty;
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="item">${escapeHTML(name)}</td>
          <td class="hsn">${escapeHTML(it.hsn_code || "—")}</td>
          <td class="qty">${qty}${it.unit_name ? ` <span class="unit">${escapeHTML(it.unit_name)}</span>` : ""}</td>
          <td class="price">${fmtMoney(price)}</td>
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
    margin: 11mm 14mm;
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
    margin-bottom: 18px;
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
    font-size: 26px;
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

  .inv-no {
    display: inline-block;
    font-size: 19px;
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

  .meta-line strong {
    color: #0f172a;
    font-weight: 600;
  }

  .billto {
    margin-top: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 16px;
    page-break-inside: avoid;
  }

  .billto .label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #4f46e5;
    margin-bottom: 3px;
  }

  .billto .cname {
    font-size: 15px;
    font-weight: 700;
  }

  .billto .sub {
    font-size: 12px;
    color: #64748b;
    line-height: 1.5;
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
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    text-align: right;
    padding: 7px 8px;
    border-bottom: 2px solid #3730a3;
  }

  table.items th:first-child {
    border-radius: 8px 0 0 0;
  }

  table.items th:last-child {
    border-radius: 0 8px 0 0;
  }

  table.items td {
    padding: 6px 8px;
    border-bottom: 1px solid #eef2f7;
    font-size: 12px;
    text-align: right;
    page-break-inside: avoid;
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
    width: 24px;
    color: #94a3b8;
  }

  table.items th.item,
  table.items td.item {
    text-align: left;
    font-weight: 650;
    word-wrap: break-word;
  }

  table.items th.hsn,
  table.items td.hsn {
    text-align: center;
    width: 58px;
    color: #475569;
    font-size: 11px;
  }

  table.items th.qty,
  table.items td.qty {
    width: 76px;
  }

  table.items th.price,
  table.items td.price {
    width: 88px;
  }

  table.items th.tax,
  table.items td.tax {
    width: 46px;
    color: #475569;
  }

  table.items th.amnt,
  table.items td.amnt {
    width: 96px;
    font-weight: 700;
  }

  .unit {
    color: #94a3b8;
    font-weight: 400;
    font-size: 10.5px;
  }

  .totals-box {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }

  table.totals {
    border-collapse: separate;
    border-spacing: 0;
    width: 44%;
    font-size: 11.5px;
  }

  table.totals td {
    padding: 4px 10px;
  }

  table.totals td:last-child {
    text-align: right;
    font-weight: 600;
  }

  table.totals tr.grand td {
    background: #4f46e5;
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    padding-top: 6px;
    padding-bottom: 6px;
  }

  table.totals tr.grand td:first-child {
    border-radius: 8px 0 0 8px;
  }

  table.totals tr.grand td:last-child {
    border-radius: 0 8px 8px 0;
    font-size: 14.5px;
  }

  table.totals tr.paid td:last-child {
    color: #059669;
    font-weight: 700;
  }

  table.totals tr.due td:last-child {
    color: #e11d48;
    font-weight: 700;
  }

  .foot {
    margin-top: 18px;
    border-top: 1px solid #e2e8f0;
    padding-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 14px;
    page-break-inside: avoid;
  }

  .foot .label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #4f46e5;
    margin-bottom: 4px;
  }

  .bank-line {
    font-size: 12px;
    line-height: 1.7;
    color: #334155;
  }

  .qr {
    text-align: center;
  }

  .qr img {
    width: 80px;
    height: 80px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 3px;
    background: #fff;
  }

  .scan-label {
    font-size: 10px;
    color: #64748b;
    margin-top: 3px;
    letter-spacing: 0.4px;
  }

  .sign-row {
    margin-top: 34px;
    display: flex;
    justify-content: flex-end;
    page-break-inside: avoid;
  }

  .sign-box {
    width: 220px;
    text-align: center;
    font-size: 12px;
    color: #64748b;
  }

  .sign-box .line {
    border-top: 1.5px solid #0f172a;
    padding-top: 5px;
    margin-bottom: 3px;
  }

  .footer-note {
    margin-top: 24px;
    text-align: center;
    font-size: 11px;
    color: #64748b;
    line-height: 1.7;
    border-top: 1px dashed #e2e8f0;
    padding-top: 10px;
    page-break-inside: avoid;
  }

  .footer-note .thanks {
    font-size: 15px;
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
        <div class="doctype">Invoice</div>
        <div><span class="inv-no">${escapeHTML(sale.invoice_no || "—")}</span></div>
        <div class="meta-line">
          <strong>${escapeHTML(date)}</strong>
          ${sale.payment_method ? `&nbsp;&middot;&nbsp;<strong>${escapeHTML((sale.payment_method || "cash").toUpperCase())}</strong>` : ""}
          ${sale.status ? `<span class="muted">&nbsp;&middot;&nbsp;${escapeHTML((sale.status || "paid").toUpperCase())}</span>` : ""}
        </div>
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
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th class="item">Item</th>
        <th class="hsn">HSN</th>
        <th class="qty">Qty</th>
        <th class="price">Price</th>
        <th class="tax">Tax</th>
        <th class="amnt">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-box">
    <table class="totals">
      <tr><td>Subtotal</td><td>${fmtMoney(subtotal)}</td></tr>
      ${taxTotal ? `<tr><td>Tax (included)</td><td>${fmtMoney(taxTotal)}</td></tr>` : ""}
      <tr class="grand"><td>Grand Total</td><td>${fmtMoney(total)}</td></tr>
      <tr class="paid"><td>Paid</td><td>${fmtMoney(paid)}</td></tr>
      ${outstanding > 0 ? `<tr class="due"><td>Balance Due</td><td>${fmtMoney(outstanding)}</td></tr>` : ""}
    </table>
  </div>

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
      <div class="line">For ${escapeHTML(store.name || "the store")}</div>
      Authorized signatory
    </div>
  </div>

  <div class="footer-note">
    <div class="thanks">${escapeHTML(store.footerText || "Thank you for your business!")}</div>
    <div>Printed ${new Date().toLocaleString()}</div>
  </div>
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