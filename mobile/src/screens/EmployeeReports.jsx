import { useMemo, useState } from "react";
import { BarChart3, FileSpreadsheet, Printer, RefreshCw, Share2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney, fmtMonth } from "../lib/format.js";
import { fmtHours, workedHours } from "../lib/hours.js";
import { shareText } from "../lib/share.js";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, showToast } from "../components/ui.jsx";

const REPORTS = [
  { value: "staff", label: "Staff list" },
  { value: "attendance", label: "Attendance register" },
  { value: "payroll", label: "Monthly payroll" },
  { value: "payments", label: "Payment ledger" },
  { value: "documents", label: "Documents list" }
];

const PAY_BASIS = { salary: "Monthly salary", wages: "Daily wages", freelancer: "Freelancer" };
const PAY_TYPES = { salary: "Salary", advance: "Advance", bonus: "Bonus", deduction: "Deduction" };
const STATUS_LABELS = { present: "Present", half_day: "Half day", holiday: "Holiday", leave: "Leave", absent: "Absent" };

const thisMonth = () => new Date().toISOString().slice(0, 7);

const monthRange = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return { from: "", to: "" };
  const days = new Date(y, mo, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(days).padStart(2, "0")}` };
};

const fmtFileSize = (bytes) => {
  const b = Number(bytes) || 0;
  if (b <= 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function EmployeeReports() {
  const { version } = useApp();
  const [report, setReport] = useState("staff");
  const [month, setMonth] = useState(thisMonth());
  const needsMonth = report === "attendance" || report === "payroll" || report === "payments";
  const { from, to } = monthRange(month);

  const data = useAsync(async () => {
    if (report === "staff") return api.employees(month);
    if (report === "attendance") return api.attendance({ from, to });
    if (report === "payroll") {
      const payroll = await api.employeePayroll(month);
      return payroll?.rows || [];
    }
    if (report === "payments") return api.employeePayments({ from, to });
    return api.employeeDocuments();
  }, [version, report, month]);

  const rows = data.data || [];
  const title = REPORTS.find((r) => r.value === report)?.label || "Employee report";
  const subtitle = report === "staff" ? `As of ${fmtDate(new Date())}` : report === "documents" ? "All documents" : fmtMonth(month);

  const columns = useMemo(() => {
    if (report === "staff") {
      return [
        { key: "name", label: "Name", value: (r) => r.name },
        { key: "designation", label: "Designation", value: (r) => r.designation || r.role || "—" },
        { key: "phone", label: "Phone", value: (r) => r.phone || "—" },
        { key: "salary_type", label: "Pay basis", value: (r) => PAY_BASIS[r.salary_type] || r.salary_type || "—" },
        { key: "salary_rate", label: "Rate", value: (r) => fmtMoney(r.salary_rate) },
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
        { key: "status", label: "Status", value: (r) => STATUS_LABELS[r.status] || r.status },
        { key: "time_in", label: "In", value: (r) => (r.time_in ? String(r.time_in).slice(0, 5) : "—") },
        { key: "time_out", label: "Out", value: (r) => (r.time_out ? String(r.time_out).slice(0, 5) : "—") },
        { key: "hours", label: "Hours", value: (r) => fmtHours(workedHours(r.time_in, r.time_out)) },
        { key: "notes", label: "Notes", value: (r) => r.notes || "" }
      ];
    }
    if (report === "payroll") {
      return [
        { key: "name", label: "Employee", value: (r) => r.name },
        { key: "designation", label: "Designation", value: (r) => r.designation || r.role || "—" },
        { key: "paid_days", label: "Paid days", value: (r) => Number(r.paid_days) || 0 },
        { key: "accrual", label: "Earned", value: (r) => fmtMoney(r.accrual) },
        { key: "pf_employee", label: "PF", value: (r) => fmtMoney(r.pf_employee) },
        { key: "paid_before", label: "Paid before", value: (r) => fmtMoney(r.paid_before) },
        { key: "net_payable", label: "Net payable", value: (r) => fmtMoney(r.net_payable) },
        { key: "payroll_status", label: "Status", value: (r) => r.payroll_status || "draft" }
      ];
    }
    if (report === "payments") {
      return [
        { key: "date", label: "Date", value: (r) => fmtDate(r.date) },
        { key: "employee_name", label: "Employee", value: (r) => r.employee_name },
        { key: "type", label: "Type", value: (r) => PAY_TYPES[r.type] || r.type },
        { key: "method", label: "Method", value: (r) => r.method || "cash" },
        { key: "amount", label: "Amount", value: (r) => fmtMoney(r.amount) },
        { key: "notes", label: "Note", value: (r) => r.notes || "" }
      ];
    }
    return [
      { key: "employee_name", label: "Employee", value: (r) => r.employee_name },
      { key: "label", label: "Document", value: (r) => r.label || "Document" },
      { key: "category", label: "Category", value: (r) => r.category || "Other" },
      { key: "file_size", label: "Size", value: (r) => fmtFileSize(r.file_size) },
      { key: "uploaded_at", label: "Uploaded", value: (r) => (r.uploaded_at ? fmtDate(r.uploaded_at) : "—") }
    ];
  }, [report]);

  const totals = useMemo(() => {
    if (report === "payroll") {
      return {
        accrual: rows.reduce((n, r) => n + (Number(r.accrual) || 0), 0),
        pf_employee: rows.reduce((n, r) => n + (Number(r.pf_employee) || 0), 0),
        paid_before: rows.reduce((n, r) => n + (Number(r.paid_before) || 0), 0),
        net_payable: rows.reduce((n, r) => n + (Number(r.net_payable) || 0), 0)
      };
    }
    if (report === "payments") {
      return { amount: rows.reduce((n, r) => n + (Number(r.amount) || 0), 0) };
    }
    return null;
  }, [report, rows]);

  const buildCsv = () => {
    const head = columns.map((c) => csvCell(c.label)).join(",");
    const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(","));
    const totalLine =
      report === "payroll"
        ? columns.map((c, i) => csvCell(i === 0 ? "Total" : totals?.[c.key] != null ? fmtMoney(totals[c.key]) : "")).join(",")
        : report === "payments"
          ? columns.map((c, i) => csvCell(i === 0 ? "Total" : c.key === "amount" ? fmtMoney(totals?.amount) : "")).join(",")
          : "";
    return [head, ...body, totalLine].filter(Boolean).join("\n");
  };

  const shareCsv = async () => {
    if (!rows.length) return showToast("Nothing to export", "error");
    await shareText({
      title: `Employee ${report} ${needsMonth ? month : ""}`.trim(),
      text: buildCsv()
    });
    showToast("Report ready to share");
  };

  const print = () => {
    if (!rows.length) return showToast("Nothing to print", "error");
    window.print();
  };

  const summaryLine = () => {
    if (report === "payroll" && totals) {
      return `Earned ${fmtMoney(totals.accrual)} · PF ${fmtMoney(totals.pf_employee)} · Net ${fmtMoney(totals.net_payable)}`;
    }
    if (report === "payments" && totals) return `Total paid ${fmtMoney(totals.amount)}`;
    return `${rows.length} row${rows.length === 1 ? "" : "s"} · ${subtitle}`;
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Employee reports"
        subtitle={summaryLine()}
        right={
          <Button size="sm" onClick={shareCsv}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
        }
      />

      <div className="space-y-3 px-4">
        <Card className="space-y-3 p-3">
          <Field label="Report">
            <Select value={report} onChange={(e) => setReport(e.target.value)}>
              {REPORTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          {needsMonth ? (
            <Field label="Month">
              <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </Field>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => data.reload()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" className="flex-1" onClick={shareCsv}>
              <FileSpreadsheet className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" className="flex-1" onClick={print}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </Card>

        {data.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : data.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{data.error}</p></Card>
        ) : !rows.length ? (
          <Empty icon={BarChart3} title="Nothing to report" description="Add records or choose another month." />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
              <p className="text-[11px] text-slate-400">{rows.length} rows</p>
            </div>
            <div className="space-y-2">
              {rows.map((row, index) => (
                <Card key={row.id || index} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {columns[0].value(row)}
                    </p>
                    <Badge tone="slate">{subtitle}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {columns.slice(1).map((column) => (
                      <div key={column.key} className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{column.label}</p>
                        <p className="truncate text-xs text-slate-600">{column.value(row)}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
            {totals ? (
              <Card className="p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Totals</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
                  {report === "payroll" ? (
                    <>
                      <p className="flex justify-between"><span className="text-slate-500">Earned</span><span className="font-semibold">{fmtMoney(totals.accrual)}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500">PF</span><span className="font-semibold">{fmtMoney(totals.pf_employee)}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500">Paid before</span><span className="font-semibold">{fmtMoney(totals.paid_before)}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500">Net payable</span><span className="font-bold text-brand-700">{fmtMoney(totals.net_payable)}</span></p>
                    </>
                  ) : (
                    <p className="col-span-2 flex justify-between"><span className="text-slate-500">Total paid</span><span className="font-bold text-emerald-600">{fmtMoney(totals.amount)}</span></p>
                  )}
                </div>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
