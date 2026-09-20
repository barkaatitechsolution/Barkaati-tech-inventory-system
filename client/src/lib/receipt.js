import { fmtMoney, fmtDateTime } from "./format.js";

export function printReceipt(sale, items, storeInfo = {}) {
  const store = {
    name: storeInfo.name || "Royal Spicy Masala",
    address: storeInfo.address || "",
    phone: storeInfo.phone || "",
    ...storeInfo
  };

  const html = buildReceiptHTML(store, sale, items);
  const printWindow = window.open("", "_blank", "width=400,height=600");
  if (!printWindow) {
    alert("Please allow popups to print receipts");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 300);
}

function buildReceiptHTML(store, sale, items) {
  const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const outstanding = total - paid;
  const date = sale.created_at ? fmtDateTime(sale.created_at) : new Date().toLocaleString();

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

  .store-name {
    font-size: 20px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 2px;
    letter-spacing: 1px;
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
  <div class="store-name">${escapeHTML(store.name)}</div>
  <div class="store-details">
    ${store.address ? escapeHTML(store.address) + "<br>" : ""}
    ${store.phone ? escapeHTML(store.phone) : ""}
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
  </div>

  ${sale.note ? `<div class="note">Note: ${escapeHTML(sale.note)}</div>` : ""}

  <div class="divider"></div>

  <!-- Footer -->
  <div class="footer">
    <div class="thank-you">THANK YOU!</div>
    <div>For queries, please contact us</div>
    <div>${store.phone ? escapeHTML(store.phone) : ""}</div>
  </div>
</div>
</body>
</html>`;
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}