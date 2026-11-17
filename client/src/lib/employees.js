// Shared vocabulary for the standalone Employees section.

export const EMPLOYEE_STATUSES = [
  { value: "active", label: "Active", color: "bg-emerald-50 text-emerald-700" },
  { value: "inactive", label: "Inactive", color: "bg-slate-100 text-slate-600" },
  { value: "resigned", label: "Resigned", color: "bg-amber-50 text-amber-700" },
  { value: "terminated", label: "Terminated", color: "bg-rose-50 text-rose-700" }
];

export const EMPLOYEE_STATUS_META = Object.fromEntries(
  EMPLOYEE_STATUSES.map((s) => [s.value, s])
);

export const PAY_MODES = [
  {
    value: "salary",
    label: "Salary (fixed per month)",
    amountLabel: "Monthly salary",
    amountHint: "A day is worth (amount × 12) ÷ 364.5, and a month never earns more than this."
  },
  {
    value: "wages",
    label: "Daily wages (per day worked)",
    amountLabel: "Wage per day",
    amountHint: "Paid for every day actually worked. No monthly limit."
  },
  {
    value: "freelancer",
    label: "Freelancer (no attendance pay)",
    amountLabel: "Agreed amount",
    amountHint: "Attendance does not change the balance. Only recorded payments do."
  }
];

export const RANKS = ["noob", "pro", "prince", "king"];

export const STATUS_OPTIONS = [
  { value: "present", label: "Present", credit: "+1 day", color: "bg-emerald-50 text-emerald-700" },
  { value: "half_day", label: "Half day", credit: "+½ day", color: "bg-amber-50 text-amber-700" },
  { value: "holiday", label: "Holiday", credit: "+1 day", color: "bg-violet-50 text-violet-700" },
  { value: "leave", label: "Leave", credit: "no pay", color: "bg-slate-100 text-slate-600" },
  { value: "absent", label: "Absent", credit: "no pay", color: "bg-rose-50 text-rose-700" }
];

export const STATUS_META = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

export const PAYMENT_OPTIONS = [
  { value: "salary", label: "Salary paid" },
  { value: "advance", label: "Advance taken" },
  { value: "bonus", label: "Bonus" },
  { value: "deduction", label: "Deduction" }
];

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" }
];

export const DOCUMENT_CATEGORIES = [
  "ID Proof",
  "Address Proof",
  "Contract",
  "Bank Details",
  "Qualification",
  "Photo",
  "Other"
];

export const PAYROLL_STATUS_META = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-600" },
  finalized: { label: "Finalized", color: "bg-sky-50 text-sky-700" },
  paid: { label: "Paid", color: "bg-emerald-50 text-emerald-700" }
};

export const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const currentMonth = () => localDate().slice(0, 7);

export const monthBounds = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return { first: "", last: "", days: 0 };
  const p = (n) => String(n).padStart(2, "0");
  const days = new Date(y, mo, 0).getDate();
  return { first: `${y}-${p(mo)}-01`, last: `${y}-${p(mo)}-${p(days)}`, days };
};

export const stripTime = (t) => (t ? String(t).slice(0, 5) : "");

export const blankEmployee = () => ({
  name: "",
  phone: "",
  email: "",
  address: "",
  designation: "",
  salary_type: "salary",
  salary_rate: "",
  rank: "noob",
  stars: 1,
  shift_start: "",
  shift_end: "",
  joining_date: "",
  starting_date: "",
  pf_enabled: false,
  pf_rate: 12,
  notes: "",
  status: "active",
  last_working_date: "",
  bank_name: "",
  bank_account_no: "",
  bank_ifsc: "",
  upi_id: "",
  date_of_birth: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  id_proof_type: "",
  id_proof_number: ""
});

export const blankPayment = () => ({
  type: "salary",
  amount: "",
  payment_method: "cash",
  date: localDate(),
  note: ""
});

export const fmtFileSize = (bytes) => {
  const b = Number(bytes) || 0;
  if (b <= 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};
