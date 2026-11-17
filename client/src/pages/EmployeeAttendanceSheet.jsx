import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Search,
  Users
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import { Button } from "../components/Field.jsx";
import { fmtDate, fmtMonth, initials } from "../lib/format.js";
import { arrivalLabel, fmtHours, workedHours } from "../lib/hours.js";
import {
  EMPLOYEE_STATUS_META,
  PAY_MODES,
  STATUS_META,
  STATUS_OPTIONS,
  currentMonth,
  monthBounds,
  stripTime
} from "../lib/employees.js";

const pad = (n) => String(n).padStart(2, "0");

const weekdayOf = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
};

const shiftMonthKey = (month, delta) => {
  const [y, m] = String(month).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

const slug = (value) =>
  String(value || "employee")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "employee";

const safeSheetName = (name, used) => {
  const base = String(name || "Employee").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Employee";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
};

const payBasis = (value) => PAY_MODES.find((m) => m.value === value)?.label || value || "";

const emptySummary = () => ({
  present: 0,
  half_day: 0,
  holiday: 0,
  leave: 0,
  absent: 0,
  unmarked: 0,
  hours: 0,
  paidDays: 0
});

export default function EmployeeAttendanceSheet() {
  const [month, setMonth] = useState(currentMonth);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { first, last } = monthBounds(month);
        const [staff, marks] = await Promise.all([
          api.employees(month),
          api.attendance(first, last)
        ]);
        if (!active) return;
        const list = Array.isArray(staff) ? staff : [];
        setEmployees(list);
        setAttendance(Array.isArray(marks) ? marks : []);
        setSelectedId((prev) => {
          if (prev && list.some((e) => String(e.id) === String(prev))) return prev;
          return list[0] ? String(list[0].id) : "";
        });
      } catch (e) {
        if (!active) return;
        setError(e.message || "Could not load the attendance sheet");
        setEmployees([]);
        setAttendance([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [month]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const dateList = useMemo(() => {
    const { days } = monthBounds(month);
    return Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`);
  }, [month]);

  const attMap = useMemo(() => {
    const map = new Map();
    for (const row of attendance) {
      map.set(`${row.employee_id}|${String(row.date).slice(0, 10)}`, row);
    }
    return map;
  }, [attendance]);

  const sheets = useMemo(() => {
    const map = new Map();
    for (const employee of employees) {
      const rows = dateList.map((date) => {
        const record = attMap.get(`${employee.id}|${date}`);
        const timeIn = stripTime(record?.time_in);
        const timeOut = stripTime(record?.time_out);
        return {
          date,
          weekday: weekdayOf(date),
          status: record?.status || "",
          label: record ? STATUS_META[record.status]?.label || record.status : "Unmarked",
          timeIn,
          timeOut,
          hours: workedHours(timeIn, timeOut),
          arrival: arrivalLabel(timeIn, employee.shift_start),
          notes: record?.notes || ""
        };
      });

      const summary = emptySummary();
      for (const row of rows) {
        if (!row.status) {
          summary.unmarked += 1;
        } else {
          summary[row.status] = (summary[row.status] || 0) + 1;
          if (row.status === "present" || row.status === "holiday") summary.paidDays += 1;
          else if (row.status === "half_day") summary.paidDays += 0.5;
        }
        if (row.hours !== null) summary.hours += row.hours;
      }

      map.set(String(employee.id), { employee, rows, summary });
    }
    return map;
  }, [employees, attMap, dateList]);

  const totals = useMemo(() => {
    const out = { present: 0, absent: 0, marked: 0, hours: 0 };
    for (const sheet of sheets.values()) {
      out.present += sheet.summary.present + sheet.summary.holiday;
      out.absent += sheet.summary.absent;
      out.hours += sheet.summary.hours;
      out.marked += dateList.length - sheet.summary.unmarked;
    }
    return out;
  }, [sheets, dateList.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.name, e.designation, e.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [employees, search]);

  const selected = sheets.get(String(selectedId)) || null;

  const buildWorksheet = (utils, sheet) => {
    const { employee, rows, summary } = sheet;
    const header = [
      ["Employee", employee.name],
      ["Designation", employee.designation || ""],
      ["Pay basis", payBasis(employee.salary_type)],
      ["Month", fmtMonth(month)],
      []
    ];
    const columns = ["Date", "Day", "Status", "Time in", "Time out", "Worked hours", "Arrival", "Notes"];
    const body = rows.map((row) => [
      fmtDate(row.date),
      row.weekday,
      row.label,
      row.timeIn || "",
      row.timeOut || "",
      row.hours !== null ? Number(row.hours.toFixed(2)) : "",
      row.arrival || "",
      row.notes || ""
    ]);
    const summaryRows = [
      [],
      ["Summary for", employee.name],
      ["Present", summary.present],
      ["Half day", summary.half_day],
      ["Holiday", summary.holiday],
      ["Leave", summary.leave],
      ["Absent", summary.absent],
      ["Unmarked", summary.unmarked],
      ["Paid days", summary.paidDays],
      ["Total hours", Number(summary.hours.toFixed(2))]
    ];
    const ws = utils.aoa_to_sheet([...header, columns, ...body, ...summaryRows]);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 8 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 13 },
      { wch: 14 },
      { wch: 32 }
    ];
    return ws;
  };

  const exportEmployee = async (employeeId = selectedId) => {
    const sheet = sheets.get(String(employeeId));
    if (!sheet) {
      setToast("Choose an employee first");
      return;
    }
    setExporting(String(sheet.employee.id));
    try {
      const { utils, writeFile } = await import("xlsx");
      const wb = utils.book_new();
      utils.book_append_sheet(wb, buildWorksheet(utils, sheet), safeSheetName(sheet.employee.name, new Set()));
      writeFile(wb, `attendance-${slug(sheet.employee.name)}-${month}.xlsx`);
      setToast(`Downloaded ${sheet.employee.name}'s attendance`);
    } catch (e) {
      setError(e.message || "Could not download the Excel file");
    } finally {
      setExporting("");
    }
  };

  const exportAll = async () => {
    const list = employees.map((e) => sheets.get(String(e.id))).filter(Boolean);
    if (list.length === 0) {
      setToast("No employees to export");
      return;
    }
    setExporting("all");
    try {
      const { utils, writeFile } = await import("xlsx");
      const wb = utils.book_new();
      const used = new Set();

      const summaryRows = [
        ["Employee", "Present", "Half day", "Holiday", "Leave", "Absent", "Unmarked", "Paid days", "Hours"],
        ...list.map(({ employee, summary }) => [
          employee.name,
          summary.present,
          summary.half_day,
          summary.holiday,
          summary.leave,
          summary.absent,
          summary.unmarked,
          summary.paidDays,
          Number(summary.hours.toFixed(2))
        ])
      ];
      const summarySheet = utils.aoa_to_sheet([
        ["Attendance summary", fmtMonth(month)],
        [],
        ...summaryRows
      ]);
      summarySheet["!cols"] = [
        { wch: 28 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 10 },
        { wch: 8 }
      ];
      used.add("Summary");
      utils.book_append_sheet(wb, summarySheet, "Summary");

      for (const sheet of list) {
        utils.book_append_sheet(wb, buildWorksheet(utils, sheet), safeSheetName(sheet.employee.name, used));
      }

      writeFile(wb, `attendance-sheets-${month}.xlsx`);
      setToast(`Downloaded ${list.length} employee sheet${list.length === 1 ? "" : "s"}`);
    } catch (e) {
      setError(e.message || "Could not download the Excel file");
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Attendance Sheet</p>
            <p className="text-xs text-slate-500">
              Every date in the month, one employee at a time — with Excel download.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonthKey(m, -1))}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="w-36 bg-transparent px-1 py-1 text-sm font-semibold text-slate-700 outline-none"
              aria-label="Attendance month"
            />
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonthKey(m, 1))}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={exportAll} disabled={loading || exporting === "all" || sheets.size === 0}>
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === "all" ? "Building…" : "Export all"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Employees", value: employees.length, cls: "text-indigo-700" },
          { label: "Marked days", value: totals.marked, cls: "text-slate-800" },
          { label: "Present", value: totals.present, cls: "text-emerald-600" },
          { label: "Absent", value: totals.absent, cls: "text-rose-600" }
        ].map((item) => (
          <Card key={item.label} className="!p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{item.label}</p>
            <p className={`mt-1 text-xl font-bold ${item.cls}`}>{item.value}</p>
          </Card>
        ))}
      </div>

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

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading attendance…</Card>
      ) : employees.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="mx-auto h-10 w-10 text-slate-200" />
          <p className="mt-3 text-sm font-semibold text-slate-600">No employees yet</p>
          <p className="mt-1 text-xs text-slate-400">Add employees first to build their attendance sheets.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="!p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div className="mt-2 max-h-[560px] space-y-1 overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-slate-400">No matching employees.</p>
              ) : (
                filtered.map((employee) => {
                  const sheet = sheets.get(String(employee.id));
                  const summary = sheet?.summary;
                  const active = String(employee.id) === String(selectedId);
                  const status = EMPLOYEE_STATUS_META[employee.status] || EMPLOYEE_STATUS_META.active;
                  return (
                    <div
                      key={employee.id}
                      className={`group flex items-center gap-2 rounded-xl p-2 transition ${
                        active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(String(employee.id))}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        {employee.photo_path ? (
                          <img
                            src={employee.photo_path}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm"
                          />
                        ) : (
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                              active ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-600"
                            }`}
                          >
                            {initials(employee.name)}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-700">
                            {employee.name}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {employee.designation || "Employee"}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className={`rounded-full px-1.5 py-0.5 font-semibold ${status.color}`}>
                              {status.label}
                            </span>
                            {summary && (
                              <>
                                <span className="font-semibold text-emerald-600">
                                  {summary.present + summary.holiday}P
                                </span>
                                <span className="font-semibold text-rose-600">{summary.absent}A</span>
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => exportEmployee(employee.id)}
                        disabled={exporting === String(employee.id)}
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100 focus:opacity-100"
                        title={`Download ${employee.name}'s Excel sheet`}
                        aria-label={`Download ${employee.name}'s Excel sheet`}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card className="!p-0 overflow-hidden">
            {!selected ? (
              <div className="p-10 text-center text-sm text-slate-400">
                Select an employee to see their attendance sheet.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {selected.employee.photo_path ? (
                      <img
                        src={selected.employee.photo_path}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-2xl object-cover shadow-sm"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-bold text-indigo-600">
                        {initials(selected.employee.name)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-slate-900">{selected.employee.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {selected.employee.designation || "Employee"}
                        {selected.employee.phone ? ` · ${selected.employee.phone}` : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {fmtMonth(month)} · {payBasis(selected.employee.salary_type)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="soft"
                    onClick={() => exportEmployee(selected.employee.id)}
                    disabled={exporting === String(selected.employee.id)}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    {exporting === String(selected.employee.id) ? "Building…" : "Download Excel"}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
                  {STATUS_OPTIONS.map((option) => (
                    <span
                      key={option.value}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${option.color}`}
                    >
                      {option.label}
                      <span className="tabular-nums">{selected.summary[option.value] || 0}</span>
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    Unmarked <span className="tabular-nums">{selected.summary.unmarked}</span>
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                    Paid days <span className="tabular-nums">{selected.summary.paidDays}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                    Hours <span className="tabular-nums">{fmtHours(selected.summary.hours)}</span>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <th className="px-4 py-3">Date</th>
                        <th className="px-3 py-3">Day</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">In</th>
                        <th className="px-3 py-3">Out</th>
                        <th className="px-3 py-3 text-right">Hours</th>
                        <th className="px-3 py-3">Arrival</th>
                        <th className="px-4 py-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.rows.map((row) => {
                        const meta = row.status ? STATUS_META[row.status] : null;
                        const weekend = row.weekday === "Sun";
                        const late = row.arrival?.startsWith("Late");
                        return (
                          <tr
                            key={row.date}
                            className={`border-b border-slate-50 last:border-0 ${
                              row.status ? "hover:bg-slate-50/60" : "bg-slate-50/30"
                            }`}
                          >
                            <td className="px-4 py-2.5 font-medium text-slate-700">{fmtDate(row.date)}</td>
                            <td className={`px-3 py-2.5 text-xs font-medium ${weekend ? "text-rose-500" : "text-slate-400"}`}>
                              {row.weekday}
                            </td>
                            <td className="px-3 py-2.5">
                              {meta ? (
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>
                                  {meta.label}
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                  Unmarked
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{row.timeIn || "—"}</td>
                            <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{row.timeOut || "—"}</td>
                            <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">
                              {fmtHours(row.hours)}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.arrival ? (
                                <span
                                  className={`rounded-full px-1.5 py-0.5 font-medium ${
                                    late
                                      ? "bg-amber-50 text-amber-700"
                                      : row.arrival === "On time"
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {row.arrival}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-slate-500" title={row.notes}>
                              {row.notes || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
                  <span>
                    {selected.summary.present} present · {selected.summary.absent} absent ·{" "}
                    {selected.summary.unmarked} unmarked
                  </span>
                  <span className="font-semibold text-slate-700">
                    {selected.summary.paidDays} paid day{selected.summary.paidDays === 1 ? "" : "s"} ·{" "}
                    {fmtHours(selected.summary.hours)} worked
                  </span>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Unmarked dates stay blank on purpose. Download one employee from the list, or export every employee as a
        workbook with one sheet each.
      </p>
    </div>
  );
}
