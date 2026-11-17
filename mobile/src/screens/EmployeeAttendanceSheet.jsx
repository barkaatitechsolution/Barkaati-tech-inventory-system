import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Share2, Users } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMonth, initials } from "../lib/format.js";
import { arrivalLabel, fmtHours, workedHours } from "../lib/hours.js";
import { shareText } from "../lib/share.js";
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner, cx, showToast } from "../components/ui.jsx";

const STATUS_META = {
  present: { label: "Present", tone: "green" },
  half_day: { label: "Half day", tone: "amber" },
  holiday: { label: "Holiday", tone: "purple" },
  leave: { label: "Leave", tone: "slate" },
  absent: { label: "Absent", tone: "red" }
};

const pad = (n) => String(n).padStart(2, "0");

const weekdayOf = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
};

const monthRange = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return { from: "", to: "", days: 0 };
  const days = new Date(y, mo, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${pad(days)}`, days };
};

const shiftMonth = (month, delta) => {
  const [y, m] = String(month).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

const payBasis = (value) =>
  ({ salary: "Monthly salary", wages: "Daily wages", freelancer: "Freelancer" })[value] || value || "";

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
  const { version } = useApp();
  const [month, setMonth] = useState(thisMonth());
  const [selectedId, setSelectedId] = useState("");
  const { from, to } = monthRange(month);
  const employees = useAsync(() => api.employees(month), [version, month]);
  const attendance = useAsync(() => api.attendance({ from, to }), [version, month]);

  const staff = employees.data || [];
  const marks = attendance.data || [];
  const loading = employees.loading || attendance.loading;
  const error = employees.error || attendance.error;

  const dateList = useMemo(() => {
    const { days } = monthRange(month);
    return Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`);
  }, [month]);

  const attMap = useMemo(() => {
    const map = new Map();
    for (const row of marks) map.set(`${row.employee_id}|${String(row.date).slice(0, 10)}`, row);
    return map;
  }, [marks]);

  const sheets = useMemo(() => {
    const map = new Map();
    for (const employee of staff) {
      const rows = dateList.map((date) => {
        const record = attMap.get(`${employee.id}|${date}`);
        const timeIn = record?.time_in ? String(record.time_in).slice(0, 5) : "";
        const timeOut = record?.time_out ? String(record.time_out).slice(0, 5) : "";
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
        if (!row.status) summary.unmarked += 1;
        else {
          summary[row.status] = (summary[row.status] || 0) + 1;
          if (row.status === "present" || row.status === "holiday") summary.paidDays += 1;
          else if (row.status === "half_day") summary.paidDays += 0.5;
        }
        if (row.hours !== null) summary.hours += row.hours;
      }
      map.set(String(employee.id), { employee, rows, summary });
    }
    return map;
  }, [staff, attMap, dateList]);

  const selected =
    sheets.get(String(selectedId)) || (staff[0] ? sheets.get(String(staff[0].id)) : null) || null;

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

  const csvFor = (sheet) => {
    const { employee, rows, summary } = sheet;
    const lines = [
      ["Employee", employee.name],
      ["Designation", employee.designation || employee.role || ""],
      ["Pay basis", payBasis(employee.salary_type)],
      ["Month", fmtMonth(month)],
      [],
      ["Date", "Day", "Status", "In", "Out", "Hours", "Arrival", "Notes"],
      ...rows.map((r) => [
        r.date,
        r.weekday,
        r.label,
        r.timeIn,
        r.timeOut,
        r.hours !== null ? r.hours.toFixed(2) : "",
        r.arrival || "",
        r.notes || ""
      ]),
      [],
      ["Present", summary.present],
      ["Half day", summary.half_day],
      ["Holiday", summary.holiday],
      ["Leave", summary.leave],
      ["Absent", summary.absent],
      ["Unmarked", summary.unmarked],
      ["Paid days", summary.paidDays],
      ["Total hours", summary.hours.toFixed(2)]
    ];
    return lines.map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  };

  const shareSheet = async () => {
    if (!selected) return showToast("Choose an employee first", "error");
    await shareText({
      title: `Attendance ${selected.employee.name} ${month}`,
      text: csvFor(selected)
    });
    showToast("Attendance sheet ready to share");
  };

  const shareAll = async () => {
    if (!staff.length) return showToast("No employees to export", "error");
    const text = [...sheets.values()]
      .map((sheet) => csvFor(sheet))
      .join("\n\n");
    await shareText({ title: `Attendance sheets ${month}`, text });
    showToast("All attendance sheets ready to share");
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Attendance sheet"
        subtitle={`${staff.length} staff · ${fmtMonth(month)}`}
        right={
          <Button size="sm" onClick={shareAll}>
            <Share2 className="h-4 w-4" /> Share all
          </Button>
        }
      />

      <div className="space-y-3 px-4">
        <Card className="flex items-center gap-2 p-2">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="rounded-lg p-2 text-slate-400 active:bg-slate-100"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="flex-1" />
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="rounded-lg p-2 text-slate-400 active:bg-slate-100"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </Card>

        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Staff", value: staff.length, tone: "text-indigo-700" },
            { label: "Marked", value: totals.marked, tone: "text-slate-800" },
            { label: "Present", value: totals.present, tone: "text-emerald-600" },
            { label: "Absent", value: totals.absent, tone: "text-red-600" }
          ].map((item) => (
            <Card key={item.label} className="p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className={cx("mt-0.5 text-base font-bold", item.tone)}>{item.value}</p>
            </Card>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{error}</p></Card>
        ) : !staff.length ? (
          <Empty icon={Users} title="No employees" description="Add employees first to build attendance sheets." />
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {staff.map((employee) => {
                const sheet = sheets.get(String(employee.id));
                const active = String(selected?.employee?.id) === String(employee.id);
                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => setSelectedId(String(employee.id))}
                    className={cx(
                      "flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-left shadow-sm",
                      active ? "bg-brand-700 text-white" : "bg-white text-slate-700"
                    )}
                  >
                    <span className={cx(
                      "flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold",
                      active ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-600"
                    )}>
                      {initials(employee.name)}
                    </span>
                    <span>
                      <span className="block max-w-[110px] truncate text-xs font-semibold">{employee.name}</span>
                      <span className={cx("block text-[10px]", active ? "text-white/70" : "text-slate-400")}>
                        {sheet ? `${sheet.summary.present + sheet.summary.holiday}P · ${sheet.summary.absent}A` : "—"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {selected ? (
              <>
                <Card className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{selected.employee.name}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {selected.employee.designation || selected.employee.role || "Employee"}
                        {selected.employee.phone ? ` · ${selected.employee.phone}` : ""}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {fmtMonth(month)} · {payBasis(selected.employee.salary_type)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={shareSheet}>
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(STATUS_META).map(([key, meta]) => (
                      <Badge key={key} tone={meta.tone}>
                        {meta.label} {selected.summary[key] || 0}
                      </Badge>
                    ))}
                    <Badge tone="slate">Unmarked {selected.summary.unmarked}</Badge>
                    <Badge tone="blue">Paid days {selected.summary.paidDays}</Badge>
                    <Badge tone="green">Hours {fmtHours(selected.summary.hours)}</Badge>
                  </div>
                </Card>

                <div className="space-y-2">
                  {selected.rows.map((row) => {
                    const meta = row.status ? STATUS_META[row.status] : null;
                    const late = row.arrival?.startsWith("Late");
                    return (
                      <Card key={row.date} className={cx("p-3", !row.status && "opacity-70")}>
                        <div className="flex items-center gap-3">
                          <div className={cx(
                            "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl",
                            row.weekday === "Sun" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
                          )}>
                            <span className="text-[10px] font-bold uppercase">{row.weekday}</span>
                            <span className="text-xs font-bold">{row.date.slice(8, 10)}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-slate-800">{fmtDate(row.date)}</p>
                              {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : <Badge tone="slate">Unmarked</Badge>}
                            </div>
                            <p className="text-[11px] text-slate-400">
                              {row.timeIn || "—"} to {row.timeOut || "—"}
                              {row.hours !== null ? ` · ${fmtHours(row.hours)}` : ""}
                            </p>
                            {row.arrival ? (
                              <p className={cx("mt-0.5 text-[10px] font-semibold", late ? "text-amber-600" : "text-emerald-600")}>
                                {row.arrival}
                              </p>
                            ) : null}
                            {row.notes ? <p className="truncate text-[10px] text-slate-400">{row.notes}</p> : null}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <Empty icon={CalendarDays} title="Choose an employee" description="Select a staff member to view their month." />
            )}
          </>
        )}
      </div>
    </div>
  );
}
