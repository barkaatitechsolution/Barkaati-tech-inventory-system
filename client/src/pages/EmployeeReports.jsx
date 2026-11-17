import { useEffect, useMemo, useState } from "react";
import { BarChart3, Download, FileSpreadsheet, FileText, Printer, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { useStoreInfo } from "../lib/storeInfo.js";
import Card from "../components/Card.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import { fmtDate, fmtMoney, fmtMonth } from "../lib/format.js";
import { printEmployeeReport } from "../lib/employeePrint.js";
import {
  PAYMENT_OPTIONS,
  PAY_MODES,
  PAYROLL_STATUS_META,
  STATUS_META,
  currentMonth,
  fmtFileSize,
  monthBounds
} from "../lib/employees.js";
import { workedHours, fmtHours } from "../lib/hours.js";

const SELECT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

const REPORTS = [
  { value: "staff", label: "Staff list" },
  { value: "attendance", label: "Attendance register" },
  { value: "payroll", label: "Monthly payroll summary" },
  { value: "payments", label: "Payment ledger" },
  { value: "documents", label: "Documents list" }
];

const payModeLabel = (value) => PAY_MODES.find((m) => m.value === value)?.label || value || "—";
const paymentTypeLabel = (value) =>
  PAYMENT_OPTIONS.find((p) => p.value === value)?.label || value || "—";

function attendanceFraction(status) {
  if (status === "present" || status === "holiday") return 1;
  if (status === "half_day") return 0.5;
  return 0;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, columns, rows, totals) {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(cellValue(c, row))).join(","));
  if (totals) body.push(columns.map((c, i) => csvCell(i === 0 ? totals.label || "Total" : totals[c.key] || "")).join(","));
  const blob = new Blob([`\uFEFF${[head, ...body].join("\n")}`], {
    type: "text/csv;charset=utf-8;"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function cellValue(column, row) {
  if (typeof column.value === "function") return column.value(row);
  if (typeof column.render === "function") return column.render(row);
  return row[column.key] ?? "";
}

export default function EmployeeReports() {
  const store = useStoreInfo();
  const [report, setReport] = useState("staff");
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const needsMonth = report === "attendance" || report === "payroll" || report === "payments";

  const title = useMemo(
    () => REPORTS.find((r) => r.value === report)?.label || "Employee report",
    [report]
  );

  const subtitle = useMemo(() => {
    if (report === "staff") return `As of ${fmtDate(new Date())}`;
    if (report === "documents") return "All employee documents";
    return fmtMonth(month);
  }, [report, month]);

  const columns = useMemo(() => {
    if (report === "staff") {
      return [
        { key: "name", label: "Name", value: (r) => r.name },
        { key: "designation", label: "Designation", value: (r) => r.designation || "—" },
        { key: "phone", label: "Phone", value: (r) => r.phone || "—" },
        { key: "salary_type", label: "Pay basis", value: (r) => payModeLabel(r.salary_type) },
        { key: "salary_rate", label: "Rate", align: "right", value: (r) => fmtMoney(r.salary_rate) },
        { key: "status", label: "Status", value: (r) => r.status || "active" },
        { key: "joining_date", label: "Joined", value: (r) => (r.joining_date ? fmtDate(r.joining_date) : "—") },
        { key: "last_working_date", label: "Last working", value: (r) => (r.last_working_date ? fmtDate(r.last_working_date) : "—") },
        { key: "pf_enabled", label: "PF", value: (r) => (r.pf_enabled ? "Yes" : "No") }
      ];
    }
    if (report === "attendance") {
      return [
        { key: "date", label: "Date", value: (r) => fmtDate(r.date) },
        { key: "employee_name", label: "Employee", value: (r) => r.employee_name },
        { key: "status", label: "Status", value: (r) => STATUS_META[r.status]?.label || r.status },
        { key: "time_in", label: "In", value: (r) => (r.time_in ? String(r.time_in).slice(0, 5) : "—") },
        { key: "time_out", label: "Out", value: (r) => (r.time_out ? String(r.time_out).slice(0, 5) : "—") },
        {
          key: "hours",
          label: "Hours",
          align: "right",
          value: (r) => fmtHours(workedHours(r.time_in, r.time_out))
        },
        { key: "notes", label: "Notes", value: (r) => r.notes || "" }
      ];
    }
    if (report === "payroll") {
      return [
        { key: "name", label: "Employee", value: (r) => r.name },
        { key: "designation", label: "Designation", value: (r) => r.designation || "—" },
        { key: "paid_days", label: "Paid days", align: "right", value: (r) => Number(r.paid_days) || 0 },
        { key: "accrual", label: "Earned", align: "right", value: (r) => fmtMoney(r.accrual) },
        { key: "pf_employee", label: "PF", align: "right", value: (r) => fmtMoney(r.pf_employee) },
        { key: "paid_before", label: "Paid before", align: "right", value: (r) => fmtMoney(r.paid_before) },
        { key: "net_payable", label: "Net payable", align: "right", value: (r) => fmtMoney(r.net_payable) },
        {
          key: "payroll_status",
          label: "Status",
          value: (r) => PAYROLL_STATUS_META[r.payroll_status]?.label || r.payroll_status || "draft"
        }
      ];
    }
    if (report === "payments") {
      return [
        { key: "date", label: "Date", value: (r) => fmtDate(r.date) },
        { key: "employee_name", label: "Employee", value: (r) => r.employee_name },
        { key: "type", label: "Type", value: (r) => paymentTypeLabel(r.type) },
        { key: "payment_method", label: "Method", value: (r) => r.payment_method || "cash" },
        { key: "amount", label: "Amount", align: "right", value: (r) => fmtMoney(r.amount) },
        { key: "note", label: "Note", value: (r) => r.note || "" }
      ];
    }
    return [
      { key: "employee_name", label: "Employee", value: (r) => r.employee_name },
      { key: "label", label: "Document", value: (r) => r.label || "Document" },
      { key: "category", label: "Category", value: (r) => r.category || "Other" },
      { key: "file_size", label: "Size", align: "right", value: (r) => fmtFileSize(r.file_size) },
      { key: "uploaded_at", label: "Uploaded", value: (r) => (r.uploaded_at ? fmtDate(r.uploaded_at) : "—") }
    ];
  }, [report]);

  const totals = useMemo(() => {
    if (report === "staff") return { label: `${rows.length} employee${rows.length === 1 ? "" : "s"}` };
    if (report === "attendance") {
      const days = rows.reduce((sum, row) => sum + attendanceFraction(row.status), 0);
      return { label: `${rows.length} marked · ${days % 1 === 0 ? days : days.toFixed(1)} paid days` };
    }
    if (report === "payroll") {
      return {
        label: "Total",
        accrual: fmtMoney(rows.reduce((sum, row) => sum + (Number(row.accrual) || 0), 0)),
        pf_employee: fmtMoney(rows.reduce((sum, row) => sum + (Number(row.pf_employee) || 0), 0)),
        paid_before: fmtMoney(rows.reduce((sum, row) => sum + (Number(row.paid_before) || 0), 0)),
        net_payable: fmtMoney(rows.reduce((sum, row) => sum + (Number(row.net_payable) || 0), 0))
      };
    }
    if (report === "payments") {
      return {
        label: "Total",
        amount: fmtMoney(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0))
      };
    }
    return { label: `${rows.length} document${rows.length === 1 ? "" : "s"}` };
  }, [report, rows]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { first, last } = monthBounds(month);
      let data = [];
      if (report === "staff") {
        data = await api.employees(month);
      } else if (report === "attendance") {
        data = await api.attendance(first, last);
      } else if (report === "payroll") {
        const payroll = await api.employeePayroll(month);
        data = payroll?.rows || [];
      } else if (report === "payments") {
        data = await api.employeePayments({ from: first, to: last });
      } else {
        data = await api.employeeDocuments();
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not build this report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, month]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const fileName = `employee-${report}-${needsMonth ? month : fmtDate(new Date())}`;

  const exportExcel = async () => {
    const data = rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column.label, cellValue(column, row)]))
    );
    if (totals && Object.keys(totals).length > 1) {
      data.push(
        Object.fromEntries(
          columns.map((column, index) => [
            column.label,
            index === 0 ? totals.label || "Total" : totals[column.key] ?? ""
          ])
        )
      );
    }
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(data);
    ws["!cols"] = columns.map((column) => ({
      wch: Math.max(12, Math.min(30, String(column.label).length + 6))
    }));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, title.slice(0, 31));
    writeFile(wb, `${fileName}.xlsx`);
    setToast(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to Excel`);
  };

  const exportCsv = () => {
    downloadCsv(`${fileName}.csv`, columns, rows, totals);
    setToast(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to CSV`);
  };

  const exportPdf = () => {
    const printColumns = columns.map((column) => ({
      label: column.label,
      align: column.align,
      render: (row) => cellValue(column, row)
    }));
    printEmployeeReport(store, title, subtitle, printColumns, rows, totals);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Employee reports</p>
            <p className="text-xs text-slate-500">
              Staff, attendance, payroll, payments and documents — ready to export.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="ghost" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="ghost" onClick={exportExcel} disabled={rows.length === 0}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button onClick={exportPdf} disabled={rows.length === 0}>
            <Printer className="h-4 w-4" /> PDF / Print
          </Button>
        </div>
      </div>

      <Card className="!p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Report">
            <select value={report} onChange={(e) => setReport(e.target.value)} className={`${SELECT} w-64`}>
              {REPORTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          {needsMonth && (
            <Field label="Month">
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-40"
              />
            </Field>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {loading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"} · ${subtitle}`}
          </span>
        </div>
      </Card>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError("")} className="shrink-0 font-bold">
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {toast}
        </div>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-bold text-slate-800">{title}</p>
              <p className="text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>
          <span className="text-[11px] text-slate-400">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <BarChart3 className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">Nothing to report yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add records or choose another month, then refresh.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-3 py-3 ${
                        column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id || index} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    {columns.map((column) => {
                      const value = cellValue(column, row);
                      const isStatus = column.key === "status" || column.key === "payroll_status";
                      return (
                        <td
                          key={column.key}
                          className={`px-3 py-2.5 ${
                            column.align === "right"
                              ? "text-right font-medium tabular-nums text-slate-700"
                              : "text-slate-600"
                          }`}
                        >
                          {isStatus ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                              {value}
                            </span>
                          ) : (
                            String(value ?? "")
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {totals && Object.keys(totals).length > 1 && (
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-slate-800">
                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={`px-3 py-3 ${
                          column.align === "right" ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {index === 0 ? totals.label || "Total" : totals[column.key] ?? ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-slate-400">
        PDF opens the browser print dialog — choose "Save as PDF" there. Excel and CSV download immediately.
      </p>
    </div>
  );
}
