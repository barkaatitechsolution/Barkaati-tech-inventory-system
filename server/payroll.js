// ─── Payroll maths ──────────────────────────────────────────────
// Everything the app knows about what an employee has earned lives here, kept
// out of api.js so the arithmetic can be checked on its own.
//
// A salaried employee's day is worth (monthly × 12) ÷ 364.5. For ₹15,000 that
// is ₹493.8272. 364.5 is the mean of a leap and a common year, so the rate is
// derived from a whole year of attendance rather than from a rounded 30 or 30.5.
//
// Attendance then turns into money day by day:
//
//   present   +1.0 day      holiday  +1.0 day  (paid rest day)
//   half_day  +0.5 day      leave    +0        absent  +0
//
// A salaried month stops accruing once it has earned the stated monthly amount,
// so a 31-day month tops out at ₹15,000 instead of paying extra for the extra
// day. Daily-wage ("wages") employees have no cap and earn their rate for every
// day worked. Freelancers do not accrue at all; only the payments recorded
// against them move.

export const DAYS_PER_YEAR = 364.5;

export const RANKS = ["noob", "pro", "prince", "king"];

export const PAYMENT_TYPES = ["salary", "advance", "bonus", "deduction"];

// How much of a day's pay a given attendance mark earns.
export const DAY_FRACTION = {
  present: 1,
  half_day: 0.5,
  holiday: 1,
  leave: 0,
  absent: 0
};

export const PAYMENT_TYPES_LABELS = {
  salary: "Salary paid",
  advance: "Advance taken",
  bonus: "Bonus paid",
  deduction: "Deduction"
};

const num = (n) => {
  if (n === null || n === undefined || n === "") return 0;
  return Number(n);
};

const round2 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) {
    throw new Error(`Payroll calculation produced a non-finite amount (${n})`);
  }
  return Math.round(v * 100) / 100;
};

export function dailyRate(emp = {}) {
  const rate = num(emp.salary_rate);
  if (!Number.isFinite(rate)) {
    if (emp.salary_type === "salary" || emp.salary_type === "wages") {
      throw new Error(
        `Employee "${emp.name || emp.id || "?"}" has a non-numeric salary amount (${emp.salary_rate})`
      );
    }
    return 0;
  }
  if (emp.salary_type === "wages") return rate;
  if (emp.salary_type === "salary") return (rate * 12) / DAYS_PER_YEAR;
  return 0;
}

export const accrues = (emp = {}) => dailyRate(emp) > 0;

const monthCap = (emp = {}) => (emp.salary_type === "salary" ? num(emp.salary_rate) : Infinity);

function creditSchedule(emp, rows = [], { respectStart = true } = {}) {
  const daily = dailyRate(emp);
  if (!daily) {
    return { daily: 0, cap: null, entries: [], accrual: 0, capped: false, cappedOn: null, days: 0 };
  }

  const cap = monthCap(emp);
  const start = respectStart && emp.starting_date ? String(emp.starting_date).slice(0, 10) : null;
  const ordered = [...rows].sort((a, b) =>
    String(a?.date || "").slice(0, 10).localeCompare(String(b?.date || "").slice(0, 10))
  );

  const entries = [];
  let total = 0;
  let paidDays = 0;
  let capped = false;
  let cappedOn = null;

  for (const row of ordered) {
    const date = String(row?.date || "").slice(0, 10);
    if (start && date && date < start) continue;

    const frac = DAY_FRACTION[row.status];
    if (frac == null || frac <= 0) continue;

    let credit = daily * frac;
    let trimmed = false;
    if (total + credit >= cap) {
      credit = Math.max(0, cap - total);
      capped = true;
      trimmed = true;
      cappedOn = date || cappedOn;
    }
    total += credit;
    paidDays += frac;
    entries.push({
      date,
      status: row.status,
      time_in: row.time_in || null,
      time_out: row.time_out || null,
      credit: round2(credit),
      rawCredit: credit,
      trimmed
    });
    if (total >= cap) break;
  }

  return {
    daily: round2(daily),
    cap: Number.isFinite(cap) ? round2(cap) : null,
    entries,
    accrual: round2(total),
    capped,
    cappedOn,
    days: round2(paidDays)
  };
}

export function monthAccrual(emp, rows = [], opts = {}) {
  return creditSchedule(emp, rows, opts);
}

export function ledgerFor(emp, monthRows = [], monthPayments = []) {
  const sched = creditSchedule(emp, monthRows);
  const pf = providentFund(emp, sched.accrual);

  const events = sched.entries.map((e) => ({
    kind: "attendance",
    date: e.date,
    status: e.status,
    time_in: e.time_in,
    time_out: e.time_out,
    label: null,
    amount: e.credit,
    raw: e.rawCredit,
    running: 0
  }));

  for (const p of monthPayments) {
    const raw = -num(p.amount);
    events.push({
      kind: "payment",
      date: String(p.date || "").slice(0, 10),
      status: null,
      label: PAYMENT_TYPES_LABELS[p.type] || p.type,
      type: p.type,
      amount: round2(raw),
      raw,
      running: 0
    });
  }

  if (pf.employee) {
    events.push({
      kind: "pf",
      date: null,
      status: null,
      label: `Provident fund (employee ${pf.rate}%)`,
      amount: -pf.employee,
      raw: -pf.employee,
      running: 0
    });
  }

  events.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return 0;
  });

  let running = 0;
  for (const e of events) {
    running += e.raw;
    e.running = round2(running);
  }

  return { events, accrual: sched.accrual, pf, balance: round2(running), daily: sched.daily, cap: sched.cap };
}

export function providentFund(emp, accrual) {
  if (!emp.pf_enabled) return { employee: 0, employer: 0, rate: num(emp.pf_rate) };
  const rate = num(emp.pf_rate);
  const employee = round2((num(accrual) * rate) / 100);
  return { employee, employer: employee, rate };
}

export function paymentTotals(payments = []) {
  const t = { salary: 0, advance: 0, bonus: 0, deduction: 0, total: 0 };
  for (const p of payments) {
    const amount = num(p.amount);
    const type = String(p.type || "");
    if (t[type] == null) t[type] = 0;
    t[type] = round2(t[type] + amount);
    t.total = round2(t.total + amount);
  }
  return t;
}

export function balanceFor(accrual, pfEmployee, payments) {
  const paid = paymentTotals(payments);
  return round2(num(accrual) - num(pfEmployee) - paid.total);
}

export function payrollFor(emp, monthRows = [], monthPayments = [], allMonths = [], allPayments = []) {
  const month = monthAccrual(emp, monthRows);
  const monthPf = providentFund(emp, month.accrual);
  const monthPaid = paymentTotals(monthPayments);

  let lifetimeAccrual = 0;
  for (const entry of allMonths) lifetimeAccrual += num(entry.accrual);
  lifetimeAccrual = round2(lifetimeAccrual);
  const lifetimePf = providentFund(emp, lifetimeAccrual);
  const lifetimePaid = paymentTotals(allPayments);

  return {
    daily: month.daily,
    cap: month.cap,
    capped: month.capped,
    cappedOn: month.cappedOn,
    paidDays: month.days,
    accrual: month.accrual,
    pf: monthPf,
    paid: monthPaid,
    netPayable: round2(month.accrual - monthPf.employee),
    balance: balanceFor(month.accrual, monthPf.employee, monthPayments),
    lifetime: {
      accrual: lifetimeAccrual,
      pf: lifetimePf,
      paid: lifetimePaid,
      balance: balanceFor(lifetimeAccrual, lifetimePf.employee, allPayments)
    }
  };
}

export const monthKeyOf = (date) => String(date || "").slice(0, 7);
