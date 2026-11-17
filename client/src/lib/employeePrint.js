import { fmtDate, fmtMoney, fmtMonth } from "./format.js";

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function printDocument(html, { width = 900, height = 1200 } = {}) {
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
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    setTimeout(() => iframe.remove(), 1000);
  };
  win.onafterprint = cleanup;
  win.onbeforeunload = cleanup;
  setTimeout(cleanup, 60000);
  win.focus();
  setTimeout(() => win.print(), 350);
}

const PAGE_CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #0f172a; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
  .sheet { max-width: 100%; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
  .store-name { font-size: 22px; font-weight: 800; margin: 0; }
  .muted { color: #64748b; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: 1px; text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
  .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
  .box h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #64748b; }
  .line { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
  .line strong { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 7px 6px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-size: 10px; letter-spacing: .6px; text-transform: uppercase; color: #475569; }
  .right { text-align: right; }
  .center { text-align: center; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .net { margin-top: 18px; margin-left: auto; width: 320px; border: 2px solid #0f172a; border-radius: 8px; padding: 12px; }
  .net .line { font-size: 15px; font-weight: 800; }
  .sign { display: flex; justify-content: space-between; gap: 60px; margin-top: 54px; }
  .sign div { flex: 1; border-top: 1px solid #94a3b8; padding-top: 7px; text-align: center; color: #64748b; }
  .footer { margin-top: 18px; font-size: 10px; color: #64748b; text-align: center; }
  .status { display: inline-block; border: 1px solid #0f172a; border-radius: 999px; padding: 2px 9px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
`;

function storeHead(store) {
  return `
    <div class="head">
      <div>
        <h2 class="store-name">${esc(store.name || "Store")}</h2>
        ${store.address ? `<div class="muted">${esc(store.address)}</div>` : ""}
        ${store.phone ? `<div class="muted">Tel: ${esc(store.phone)}</div>` : ""}
      </div>
      <div class="doc-title">
        <h1>Payslip</h1>
        <div class="muted">${esc(fmtMonth(store.month || ""))}</div>
      </div>
    </div>
  `;
}

export function printPayslip(store = {}, employee = {}, payroll = {}, month = "") {
  const earned = Number(payroll.accrual) || 0;
  const pf = Number(payroll.pf_employee ?? payroll.pf?.employee) || 0;
  const paidBefore = Number(payroll.paid_before ?? payroll.paid?.total) || 0;
  const net = Number(payroll.net_payable ?? payroll.balance) || 0;
  const status = String(payroll.payroll_status || payroll.status || "draft");
  const paidDate = payroll.paid_at ? fmtDate(payroll.paid_at) : "";
  const bank = [employee.bank_name, employee.bank_account_no, employee.bank_ifsc]
    .filter(Boolean)
    .join(" · ");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payslip</title>
  <style>${PAGE_CSS}</style></head><body><div class="sheet">
    ${storeHead({ ...store, month })}
    <div class="grid">
      <div class="box">
        <h3>Employee</h3>
        <div class="line"><span>Name</span><strong>${esc(employee.name || "")}</strong></div>
        <div class="line"><span>Designation</span><strong>${esc(employee.designation || "—")}</strong></div>
        <div class="line"><span>Phone</span><strong>${esc(employee.phone || "—")}</strong></div>
        <div class="line"><span>Employment</span><strong>${esc(employee.status || "active")}</strong></div>
      </div>
      <div class="box">
        <h3>Pay period</h3>
        <div class="line"><span>Month</span><strong>${esc(fmtMonth(month))}</strong></div>
        <div class="line"><span>Pay basis</span><strong>${esc(employee.salary_type || "")}</strong></div>
        <div class="line"><span>Rate</span><strong>${fmtMoney(employee.salary_rate)}</strong></div>
        <div class="line"><span>Status</span><strong class="status">${esc(status)}</strong></div>
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
      <tbody>
        <tr><td>Salary earned from attendance</td><td class="right">${fmtMoney(earned)}</td></tr>
        <tr><td>Provident fund (employee share)</td><td class="right">-${fmtMoney(pf)}</td></tr>
        <tr><td>Payments already recorded this month</td><td class="right">-${fmtMoney(paidBefore)}</td></tr>
      </tbody>
      <tfoot><tr><td>Net payable</td><td class="right">${fmtMoney(net)}</td></tr></tfoot>
    </table>
    <div class="net">
      <div class="line"><span>Amount to pay</span><span>${fmtMoney(net)}</span></div>
      ${paidDate ? `<div class="line" style="font-size:11px;font-weight:400"><span>Marked paid on</span><span>${esc(paidDate)}</span></div>` : ""}
      ${bank ? `<div class="line" style="font-size:10px;font-weight:400"><span>Bank</span><span>${esc(bank)}</span></div>` : ""}
      ${employee.upi_id ? `<div class="line" style="font-size:10px;font-weight:400"><span>UPI</span><span>${esc(employee.upi_id)}</span></div>` : ""}
    </div>
    <div class="sign"><div>Employee signature</div><div>For ${esc(store.name || "Store")}</div></div>
    <div class="footer">This payslip was generated from the attendance and payments recorded in the Employees section.</div>
  </div></body></html>`;
  printDocument(html);
}

export function printEmployeeReport(
  store = {},
  title = "Employee report",
  subtitle = "",
  columns = [],
  rows = [],
  totals = null
) {
  const head = columns
    .map((c) => `<th class="${c.align === "right" ? "right" : c.align === "center" ? "center" : ""}">${esc(c.label)}</th>`)
    .join("");
  const body = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${columns
              .map((c) => {
                const value = typeof c.render === "function" ? c.render(row) : row[c.key];
                const cls = c.align === "right" ? "right" : c.align === "center" ? "center" : "";
                return `<td class="${cls}">${esc(value ?? "")}</td>`;
              })
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${columns.length}" class="center muted">No records</td></tr>`;
  const foot = totals
    ? `<tfoot><tr>${columns
        .map((c, i) => {
          const value = i === 0 ? totals.label || "Total" : totals[c.key] ?? "";
          const cls = c.align === "right" ? "right" : c.align === "center" ? "center" : "";
          return `<td class="${cls}">${esc(value)}</td>`;
        })
        .join("")}</tr></tfoot>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>${PAGE_CSS}</style></head><body><div class="sheet">
    <div class="head">
      <div>
        <h2 class="store-name">${esc(store.name || "Store")}</h2>
        ${store.address ? `<div class="muted">${esc(store.address)}</div>` : ""}
        ${store.phone ? `<div class="muted">Tel: ${esc(store.phone)}</div>` : ""}
      </div>
      <div class="doc-title">
        <h1>${esc(title)}</h1>
        <div class="muted">${esc(subtitle)}</div>
        <div class="muted">Printed ${esc(fmtDate(new Date()))}</div>
      </div>
    </div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
    <div class="footer">Employee reports are generated from records in the standalone Employees section.</div>
  </div></body></html>`;
  printDocument(html);
}
