import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Lock, Users } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import TimeInput from "../components/TimeInput.jsx";
import { fmtDate, fmtMonth, fmtMoney } from "../lib/format.js";
import { workedHours, fmtHours, arrivalLabel, timeOptions } from "../lib/hours.js";
import { patchAttRow } from "../lib/attendance.js";
import { useFormDraft } from "../lib/formDraft.js";
import {
  STATUS_META,
  STATUS_OPTIONS,
  currentMonth,
  localDate,
  monthBounds,
  stripTime
} from "../lib/employees.js";

const SELECT =
  "shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium outline-none transition focus:border-indigo-400";

export default function EmployeeAttendance() {
  const [tab, setTab] = useState("daily");
  const [month, setMonth] = useState(currentMonth);
  const [attDate, setAttDate] = useState(localDate);
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState({});
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const dayRequest = useRef(0);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "active"),
    [employees]
  );

  const draft = useFormDraft({
    key: `employee-attendance:${attDate}`,
    value: { rows },
    apply: (v) => {
      if (v.rows) setRows(v.rows);
    },
    active: tab === "daily" && !locked && dayLoaded && activeEmployees.length > 0
  });

  const lockMonth = tab === "monthly" ? month : String(attDate || "").slice(0, 7);

  const loadEmployees = async () => {
    try {
      const list = await api.employees(month);
      setEmployees(Array.isArray(list) ? list : []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load employees");
    } finally {
      setLoading(false);
    }
  };

  const loadDay = async (date = attDate) => {
    const request = ++dayRequest.current;
    setDayLoaded(false);
    try {
      const list = await api.attendance(date, date);
      if (request !== dayRequest.current) return;
      const next = {};
      (list || []).forEach((r) => {
        next[String(r.employee_id)] = {
          status: r.status || "present",
          time_in: stripTime(r.time_in),
          time_out: stripTime(r.time_out),
          notes: r.notes || ""
        };
      });
      setRows(next);
      setDayLoaded(true);
    } catch {
      /* keep the last good register */
    }
  };

  const loadMonthly = async () => {
    const { first, last } = monthBounds(month);
    try {
      const list = await api.attendance(first, last);
      setMonthlyRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e.message || "Could not load attendance");
    }
  };

  const loadLock = async (m) => {
    if (!/^\d{4}-\d{2}$/.test(String(m || ""))) {
      setLocked(false);
      return;
    }
    try {
      const payroll = await api.employeePayroll(m);
      setLocked(!!payroll?.locked);
    } catch {
      setLocked(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    loadLock(lockMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockMonth]);

  useEffect(() => {
    loadDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attDate]);

  useEffect(() => {
    if (tab === "monthly") loadMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, month]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const setAtt = (employeeId, field, value) =>
    setRows((prev) => ({
      ...prev,
      [String(employeeId)]: patchAttRow(prev[String(employeeId)], field, value)
    }));

  const markAllPresent = () => {
    const next = { ...rows };
    activeEmployees.forEach((e) => {
      next[String(e.id)] = patchAttRow(next[String(e.id)], "status", "present");
    });
    setRows(next);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      for (const e of activeEmployees) {
        const row = rows[String(e.id)];
        if (!row) continue;
        await api.saveAttendance({
          employee_id: e.id,
          date: attDate,
          status: row.status,
          time_in: row.time_in || null,
          time_out: row.time_out || null,
          notes: row.notes || null
        });
      }
      await draft.clear();
      setToast("Attendance saved");
      await loadDay(attDate);
      await loadLock(lockMonth);
    } catch (e) {
      setError(e.message || "Could not save attendance");
    } finally {
      setSaving(false);
    }
  };

  const dailyTotals = useMemo(() => {
    let present = 0;
    let hours = 0;
    let clocked = 0;
    for (const e of activeEmployees) {
      const row = rows[String(e.id)];
      if (!row) continue;
      if (row.status === "present" || row.status === "holiday") present += 1;
      const h = workedHours(row.time_in, row.time_out);
      if (h !== null) {
        hours += h;
        clocked += 1;
      }
    }
    return { present, hours, clocked };
  }, [activeEmployees, rows]);

  const summary = useMemo(() => {
    const byEmp = new Map();
    for (const row of monthlyRows) {
      const key = String(row.employee_id);
      if (!byEmp.has(key)) {
        byEmp.set(key, {
          employee_id: row.employee_id,
          name: row.employee_name,
          present: 0,
          half_day: 0,
          holiday: 0,
          leave: 0,
          absent: 0,
          days: 0,
          hours: 0
        });
      }
      const item = byEmp.get(key);
      item[row.status] = (item[row.status] || 0) + 1;
      const fraction =
        row.status === "present" || row.status === "holiday"
          ? 1
          : row.status === "half_day"
            ? 0.5
            : 0;
      item.days += fraction;
      const h = workedHours(row.time_in, row.time_out);
      if (h !== null) item.hours += h;
    }
    return [...byEmp.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [monthlyRows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Attendance</p>
            <p className="text-xs text-slate-500">Daily marks drive payroll. Clock times are reference only.</p>
          </div>
        </div>
        <Input
          type="month"
          value={month}
          onChange={(e) => {
            const next = e.target.value;
            setMonth(next);
            if (tab === "daily" && next && String(attDate).slice(0, 7) !== next) {
              setAttDate(`${next}-01`);
            }
          }}
          className="w-40"
        />
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {[
          { key: "daily", label: "Daily register", icon: Check },
          { key: "monthly", label: "Monthly summary", icon: Users }
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
                tab === t.key
                  ? "border-indigo-500 text-indigo-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
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
      {locked && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {fmtMonth(month)} payroll is finalized, so attendance is locked. Reopen the month from Payroll
            before making changes.
          </span>
        </div>
      )}

      {tab === "daily" && (
        <div className="space-y-5">
          <DraftBanner draft={draft} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={attDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setAttDate(next);
                  if (next && String(next).slice(0, 7) !== month) setMonth(String(next).slice(0, 7));
                }}
                className="w-44"
              />
            </Field>
            <Button variant="soft" onClick={markAllPresent} disabled={locked}>
              <Check className="h-4 w-4" /> Mark all present
            </Button>
            <Button onClick={save} disabled={saving || locked || activeEmployees.length === 0}>
              {saving ? "Saving…" : "Save attendance"}
            </Button>
            <span className="ml-auto text-xs text-slate-500">
              {dailyTotals.present} of {activeEmployees.length} marked
              {dailyTotals.clocked > 0 && (
                <span className="ml-2 font-semibold tabular-nums text-slate-700">
                  {fmtHours(dailyTotals.hours)} worked
                </span>
              )}
            </span>
          </div>

          {loading ? (
            <Card className="p-8 text-center text-sm text-slate-400">Loading…</Card>
          ) : activeEmployees.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-400">
              Add an active employee first to mark attendance.
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeEmployees.map((employee) => {
                const row = rows[String(employee.id)] || {
                  status: "present",
                  time_in: "",
                  time_out: ""
                };
                const daily = Number(employee.payroll?.daily) || 0;
                const meta = STATUS_META[row.status];
                const earns =
                  row.status === "present" || row.status === "holiday"
                    ? daily
                    : row.status === "half_day"
                      ? daily / 2
                      : 0;
                const hours = workedHours(row.time_in, row.time_out);
                const arrival = arrivalLabel(row.time_in, employee.shift_start);
                const arrivedLate = arrival && arrival.startsWith("Late");
                return (
                  <Card key={employee.id} className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">{employee.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {employee.designation || "Employee"}
                          {daily > 0 && <span> · {fmtMoney(daily)}/day</span>}
                        </p>
                      </div>
                      <select
                        value={row.status}
                        onChange={(e) => setAtt(employee.id, "status", e.target.value)}
                        className={SELECT}
                        disabled={locked}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <TimeInput
                        value={row.time_in}
                        onChange={(v) => setAtt(employee.id, "time_in", v)}
                        options={timeOptions(employee.shift_start, employee.shift_end)}
                        ariaLabel={`Time in for ${employee.name}`}
                      />
                      <TimeInput
                        value={row.time_out}
                        onChange={(v) => setAtt(employee.id, "time_out", v)}
                        options={timeOptions(employee.shift_start, employee.shift_end)}
                        ariaLabel={`Time out for ${employee.name}`}
                      />
                    </div>

                    {(hours !== null || arrival) && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Worked</span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold tabular-nums text-slate-700">{fmtHours(hours)}</span>
                          {arrival && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 font-medium ${
                                arrivedLate
                                  ? "bg-amber-50 text-amber-700"
                                  : arrival === "On time"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {arrival}
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    <div
                      className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-[11px] font-semibold ${
                        meta?.color || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <span>{meta?.credit}</span>
                      <span>{earns > 0 ? `+${fmtMoney(earns)}` : "Rs 0"}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "monthly" && (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-slate-800">{fmtMonth(month)} attendance</p>
              <p className="text-xs text-slate-400">Saved marks for the selected month.</p>
            </div>
            <p className="text-xs text-slate-400">{monthlyRows.length} marked rows</p>
          </div>
          {summary.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              No attendance marked for {fmtMonth(month)} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-3 py-3 text-center">Present</th>
                    <th className="px-3 py-3 text-center">Half day</th>
                    <th className="px-3 py-3 text-center">Holiday</th>
                    <th className="px-3 py-3 text-center">Leave</th>
                    <th className="px-3 py-3 text-center">Absent</th>
                    <th className="px-3 py-3 text-right">Paid days</th>
                    <th className="px-3 py-3 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.employee_id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 font-semibold text-slate-700">{row.name}</td>
                      <td className="px-3 py-3 text-center text-emerald-700">{row.present}</td>
                      <td className="px-3 py-3 text-center text-amber-700">{row.half_day}</td>
                      <td className="px-3 py-3 text-center text-violet-700">{row.holiday}</td>
                      <td className="px-3 py-3 text-center text-slate-600">{row.leave}</td>
                      <td className="px-3 py-3 text-center text-rose-700">{row.absent}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-800">
                        {row.days % 1 === 0 ? row.days : row.days.toFixed(1)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmtHours(row.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <p className="text-[11px] text-slate-400">
        Daily register for {fmtDate(attDate)}. Holidays are paid; leave and absent days are unpaid.
      </p>
    </div>
  );
}
