import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CalendarCheck,
  FileText,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMonth, fmtMoney } from "../lib/format.js";
import { fileToBase64 } from "../lib/backup.js";
import { openUrl } from "../lib/share.js";
import { resolveFileUrl } from "../lib/files.js";
import {
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  cx,
  showToast
} from "../components/ui.jsx";

const TABS = [
  { key: "staff", label: "Staff", icon: Users },
  { key: "attendance", label: "Attendance", icon: CalendarCheck },
  { key: "payroll", label: "Payroll", icon: Wallet },
  { key: "payments", label: "Payments", icon: BadgeCheck },
  { key: "documents", label: "Documents", icon: FileText }
];
const ATT_STATUSES = ["present", "half_day", "holiday", "leave", "absent"];
const PAY_TYPES = ["salary", "advance", "bonus", "deduction"];
const SALARY_TYPES = ["salary", "wages", "freelancer"];
const RANKS = ["noob", "pro", "prince", "king"];
const EMP_STATUSES = ["active", "inactive", "resigned", "terminated"];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthRange = (m) => {
  const [y, mo] = String(m || thisMonth()).split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
};

const blankEmployee = () => ({
  name: "", phone: "", email: "", address: "", role: "", designation: "",
  salary_type: "salary", salary_rate: "", starting_date: new Date().toISOString().slice(0, 10),
  joining_date: "", rank: "noob", stars: "1", shift_start: "", shift_end: "",
  pf_enabled: false, pf_rate: "", status: "active", last_working_date: "",
  bank_name: "", bank_account_no: "", bank_ifsc: "", upi_id: "", date_of_birth: "",
  emergency_contact_name: "", emergency_contact_phone: "", id_proof_type: "", id_proof_number: "",
  notes: ""
});
const blankAttendance = () => ({
  employee_id: "", date: new Date().toISOString().slice(0, 10), status: "present", time_in: "", time_out: "", notes: ""
});
const blankPayment = () => ({
  employee_id: "", type: "salary", amount: "", date: new Date().toISOString().slice(0, 10), method: "cash", notes: ""
});

const rankTone = { noob: "slate", pro: "blue", prince: "purple", king: "amber" };

export default function Employees() {
  const { version, bump } = useApp();
  const [tab, setTab] = useState("staff");
  const [month, setMonth] = useState(thisMonth());
  const employees = useAsync(() => api.employees(month), [version, month]);
  const payroll = useAsync(() => api.employeePayroll(month), [version, month]);
  const { from, to } = monthRange(month);
  const attendance = useAsync(() => api.attendance({ from, to }), [version, month]);
  const payments = useAsync(() => api.employeePayments({ from, to }), [version, month]);
  const documents = useAsync(() => api.employeeDocuments(), [version]);

  const [empOpen, setEmpOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankEmployee);
  const [attOpen, setAttOpen] = useState(false);
  const [attForm, setAttForm] = useState(blankAttendance);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState(blankPayment);
  const [docOpen, setDocOpen] = useState(false);
  const [docForm, setDocForm] = useState({ employee_id: "", category: "Other", label: "", file: "" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deletingAtt, setDeletingAtt] = useState(null);
  const [deletingPay, setDeletingPay] = useState(null);
  const [deletingDoc, setDeletingDoc] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (empOpen) setForm(editing ? formFrom(editing) : blankEmployee());
  }, [empOpen, editing]);
  useEffect(() => { if (attOpen) setAttForm(blankAttendance()); }, [attOpen]);
  useEffect(() => { if (payOpen) setPayForm(blankPayment()); }, [payOpen]);
  useEffect(() => {
    if (docOpen) setDocForm({ employee_id: "", category: "Other", label: "", file: "" });
  }, [docOpen]);

  const staff = employees.data || [];
  const payrollData = payroll.data;
  const payrollRows = payrollData?.rows || [];
  const attRows = attendance.data || [];
  const payRows = payments.data || [];
  const docRows = documents.data || [];

  const refreshAll = () => {
    bump();
    employees.reload();
    payroll.reload();
    attendance.reload();
    payments.reload();
    documents.reload();
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveEmployee = async () => {
    if (!form.name.trim()) return showToast("Enter the employee name", "error");
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        salary_rate: Number(form.salary_rate) || 0,
        stars: Number(form.stars) || 1,
        pf_rate: Number(form.pf_rate) || 0
      };
      if (editing) await api.updateEmployee(editing.id, payload);
      else await api.createEmployee(payload);
      showToast(editing ? "Employee updated" : "Employee added");
      setEmpOpen(false);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not save employee", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveAttendance = async () => {
    if (!attForm.employee_id) return showToast("Choose an employee", "error");
    if (!attForm.date) return showToast("Choose a date", "error");
    setSaving(true);
    try {
      await api.saveAttendance(attForm);
      showToast("Attendance saved");
      setAttOpen(false);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not save attendance", "error");
    } finally {
      setSaving(false);
    }
  };

  const savePayment = async () => {
    if (!payForm.employee_id) return showToast("Choose an employee", "error");
    if (!(Number(payForm.amount) > 0)) return showToast("Enter an amount", "error");
    setSaving(true);
    try {
      await api.createEmployeePayment(payForm.employee_id, payForm);
      showToast("Payment recorded");
      setPayOpen(false);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not record payment", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveDocument = async () => {
    if (!docForm.employee_id) return showToast("Choose an employee", "error");
    if (!docForm.file) return showToast("Attach a file", "error");
    setSaving(true);
    try {
      await api.createEmployeeDocument(docForm.employee_id, docForm);
      showToast("Document uploaded");
      setDocOpen(false);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not upload", "error");
    } finally {
      setSaving(false);
    }
  };

  const pickDoc = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      setDocForm((f) => ({ ...f, file: `data:${file.type || "application/octet-stream"};base64,${base64}`, label: f.label || file.name }));
    } catch {
      showToast("Could not read file", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const finalize = async () => {
    try {
      await api.finalizeEmployeePayroll(month);
      showToast("Payroll finalized");
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not finalize", "error");
    }
  };

  const reopen = async () => {
    try {
      await api.reopenEmployeePayroll(month);
      showToast("Payroll reopened");
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not reopen", "error");
    }
  };

  const pay = async (row) => {
    try {
      const res = await api.payEmployeePayroll(row.id, month);
      showToast(`Paid ${fmtMoney(res.amount)}`);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not pay", "error");
    }
  };

  const removeEmployee = async () => {
    try {
      await api.deleteEmployee(deleting.id);
      showToast("Employee deleted");
      setDeleting(null);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const removeAttendance = async () => {
    try {
      await api.deleteAttendance(deletingAtt.id);
      showToast("Attendance removed");
      setDeletingAtt(null);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const removePayment = async () => {
    try {
      await api.deleteEmployeePayment(deletingPay.id);
      showToast("Payment removed");
      setDeletingPay(null);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const removeDoc = async () => {
    try {
      await api.deleteEmployeeDocument(deletingDoc.id);
      showToast("Document removed");
      setDeletingDoc(null);
      refreshAll();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const openDoc = async (row) => {
    if (!row.file_path) return showToast("No file", "error");
    await openUrl(resolveFileUrl(row.file_path));
  };

  const headerAction = () => {
    if (tab === "staff") return <Button size="sm" onClick={() => { setEditing(null); setEmpOpen(true); }}><UserPlus className="h-4 w-4" /> Add</Button>;
    if (tab === "attendance") return <Button size="sm" onClick={() => setAttOpen(true)}><Plus className="h-4 w-4" /> Mark</Button>;
    if (tab === "payments") return <Button size="sm" onClick={() => setPayOpen(true)}><Plus className="h-4 w-4" /> Pay</Button>;
    if (tab === "documents") return <Button size="sm" onClick={() => setDocOpen(true)}><Plus className="h-4 w-4" /> Upload</Button>;
    return null;
  };

  return (
    <div className="pb-24">
      <PageHeader title="Employees" subtitle={`${staff.length} staff · ${fmtMonth(month)}`} right={headerAction()} />

      <div className="space-y-3 px-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={cx("flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold",
                tab === key ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab !== "staff" && tab !== "documents" ? (
          <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        ) : null}

        {tab === "staff" ? (
          employees.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : staff.length ? (
              <div className="space-y-2">
                {staff.map((e) => (
                  <Card key={e.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                        {(e.name || "?").slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{e.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {e.designation || e.role || "Staff"} · {e.phone || "No phone"}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={rankTone[e.rank] || "slate"}>{e.rank}</Badge>
                          <Badge tone={e.status === "active" ? "green" : "red"}>{e.status}</Badge>
                          <span className="text-[10px] text-slate-400">{fmtMoney(e.salary_rate)} / {e.salary_type}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton onClick={() => { setEditing(e); setEmpOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton onClick={() => setDeleting(e)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center">
                      <div><p className="text-[10px] text-slate-400">Accrued</p><p className="text-xs font-bold text-slate-800">{fmtMoney(e.payroll?.accrual)}</p></div>
                      <div><p className="text-[10px] text-slate-400">Paid</p><p className="text-xs font-bold text-slate-800">{fmtMoney(e.payroll?.paid?.total)}</p></div>
                      <div><p className="text-[10px] text-slate-400">Balance</p><p className="text-xs font-bold text-brand-700">{fmtMoney(e.payroll?.balance)}</p></div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={Users} title="No employees" description="Add staff to track attendance, payroll and documents."
                action={<Button onClick={() => { setEditing(null); setEmpOpen(true); }}>Add employee</Button>} />
            )
        ) : null}

        {tab === "attendance" ? (
          attendance.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : attRows.length ? (
              <div className="space-y-2">
                {attRows.map((a) => (
                  <Card key={a.id} className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <CalendarCheck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{a.employee_name}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(a.date)}{a.time_in ? ` · ${a.time_in}` : ""}{a.time_out ? `–${a.time_out}` : ""}</p>
                    </div>
                    <Badge tone={a.status === "present" ? "green" : a.status === "absent" ? "red" : "amber"}>{a.status.replace("_", " ")}</Badge>
                    <IconButton onClick={() => setDeletingAtt(a)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={CalendarCheck} title="No attendance" description={`No attendance marked for ${fmtMonth(month)}.`}
                action={<Button onClick={() => setAttOpen(true)}>Mark attendance</Button>} />
            )
        ) : null}

        {tab === "payroll" ? (
          payroll.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : payrollRows.length ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-2xl bg-white p-3 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">{payrollData?.locked ? "Finalized" : "Draft payroll"}</p>
                    <p className="text-[11px] text-slate-400">{payrollData?.locked ? "Snapshot taken for this month" : "Based on live attendance"}</p>
                  </div>
                  {payrollData?.locked ? (
                    <Button size="sm" variant="outline" onClick={reopen} disabled={payrollData?.has_paid}>Reopen</Button>
                  ) : (
                    <Button size="sm" onClick={finalize}>Finalize</Button>
                  )}
                </div>
                {payrollRows.map((r) => (
                  <Card key={r.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{r.name}</p>
                        <p className="text-[11px] text-slate-400">{r.paid_days || 0} paid days · PF {fmtMoney(r.pf_employee)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{fmtMoney(r.net_payable)}</p>
                        <Badge tone={r.payroll_status === "paid" ? "green" : r.payroll_status === "finalized" ? "blue" : "amber"}>
                          {r.payroll_status}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center">
                      <div><p className="text-[10px] text-slate-400">Accrual</p><p className="text-xs font-bold text-slate-800">{fmtMoney(r.accrual)}</p></div>
                      <div><p className="text-[10px] text-slate-400">Paid before</p><p className="text-xs font-bold text-slate-800">{fmtMoney(r.paid_before)}</p></div>
                      <div><p className="text-[10px] text-slate-400">Net payable</p><p className="text-xs font-bold text-brand-700">{fmtMoney(r.net_payable)}</p></div>
                    </div>
                    {r.payroll_status === "finalized" ? (
                      <Button size="sm" className="mt-2 w-full" onClick={() => pay(r)}>
                        <Wallet className="h-3.5 w-3.5" /> Mark paid {fmtMoney(r.net_payable)}
                      </Button>
                    ) : null}
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={Wallet} title="No staff" description="Add employees before running payroll." />
            )
        ) : null}

        {tab === "payments" ? (
          payments.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : payRows.length ? (
              <div className="space-y-2">
                {payRows.map((p) => (
                  <Card key={p.id} className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <Wallet className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{p.employee_name}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(p.date)} · {p.type} · {p.method}</p>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{fmtMoney(p.amount)}</p>
                    <IconButton onClick={() => setDeletingPay(p)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={Wallet} title="No payments" description={`No staff payments in ${fmtMonth(month)}.`}
                action={<Button onClick={() => setPayOpen(true)}>Record payment</Button>} />
            )
        ) : null}

        {tab === "documents" ? (
          documents.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : docRows.length ? (
              <div className="space-y-2">
                {docRows.map((d) => (
                  <Card key={d.id} className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <FileText className="h-4 w-4" />
                    </div>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openDoc(d)}>
                      <p className="truncate text-sm font-semibold text-slate-800">{d.label || d.category}</p>
                      <p className="text-[11px] text-slate-400">{d.employee_name} · {d.category} · {fmtDate(d.uploaded_at)}</p>
                    </button>
                    <IconButton onClick={() => setDeletingDoc(d)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={FileText} title="No documents" description="Upload ID proofs, contracts and certificates."
                action={<Button onClick={() => setDocOpen(true)}>Upload document</Button>} />
            )
        ) : null}
      </div>

      <Modal open={empOpen} title={editing ? "Edit employee" : "Add employee"} onClose={() => setEmpOpen(false)} wide
        footer={<Button className="w-full" loading={saving} onClick={saveEmployee}>Save employee</Button>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><Input value={form.name} onChange={set("name")} autoFocus /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Email"><Input value={form.email} onChange={set("email")} inputMode="email" /></Field>
            <Field label="Designation"><Input value={form.designation} onChange={set("designation")} /></Field>
          </div>
          <Field label="Address"><Input value={form.address} onChange={set("address")} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Salary type">
              <Select value={form.salary_type} onChange={set("salary_type")}>
                {SALARY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Salary rate (Rs)"><Input value={form.salary_rate} onChange={set("salary_rate")} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starting date"><Input type="date" value={form.starting_date} onChange={set("starting_date")} /></Field>
            <Field label="Joining date"><Input type="date" value={form.joining_date} onChange={set("joining_date")} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Rank">
              <Select value={form.rank} onChange={set("rank")}>
                {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Stars"><Input value={form.stars} onChange={set("stars")} inputMode="numeric" /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={set("status")}>
                {EMP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Shift start"><Input type="time" value={form.shift_start} onChange={set("shift_start")} /></Field>
            <Field label="Shift end"><Input type="time" value={form.shift_end} onChange={set("shift_end")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="PF enabled">
              <Select value={form.pf_enabled ? "1" : "0"} onChange={(e) => setForm((f) => ({ ...f, pf_enabled: e.target.value === "1" }))}>
                <option value="0">No</option>
                <option value="1">Yes</option>
              </Select>
            </Field>
            <Field label="PF rate (%)"><Input value={form.pf_rate} onChange={set("pf_rate")} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bank name"><Input value={form.bank_name} onChange={set("bank_name")} /></Field>
            <Field label="Account no."><Input value={form.bank_account_no} onChange={set("bank_account_no")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="IFSC"><Input value={form.bank_ifsc} onChange={set("bank_ifsc")} /></Field>
            <Field label="UPI ID"><Input value={form.upi_id} onChange={set("upi_id")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date of birth"><Input type="date" value={form.date_of_birth} onChange={set("date_of_birth")} /></Field>
            <Field label="Last working date"><Input type="date" value={form.last_working_date} onChange={set("last_working_date")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Emergency contact"><Input value={form.emergency_contact_name} onChange={set("emergency_contact_name")} /></Field>
            <Field label="Emergency phone"><Input value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} inputMode="tel" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ID proof type"><Input value={form.id_proof_type} onChange={set("id_proof_type")} /></Field>
            <Field label="ID proof number"><Input value={form.id_proof_number} onChange={set("id_proof_number")} /></Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Modal open={attOpen} title="Mark attendance" onClose={() => setAttOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={saveAttendance}>Save attendance</Button>}>
        <div className="space-y-3">
          <Field label="Employee">
            <Select value={attForm.employee_id} onChange={(e) => setAttForm((f) => ({ ...f, employee_id: e.target.value }))}>
              <option value="">Choose an employee</option>
              {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date"><Input type="date" value={attForm.date} onChange={(e) => setAttForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Status">
              <Select value={attForm.status} onChange={(e) => setAttForm((f) => ({ ...f, status: e.target.value }))}>
                {ATT_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Time in"><Input type="time" value={attForm.time_in} onChange={(e) => setAttForm((f) => ({ ...f, time_in: e.target.value }))} /></Field>
            <Field label="Time out"><Input type="time" value={attForm.time_out} onChange={(e) => setAttForm((f) => ({ ...f, time_out: e.target.value }))} /></Field>
          </div>
          <Field label="Notes"><Textarea value={attForm.notes} onChange={(e) => setAttForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></Field>
        </div>
      </Modal>

      <Modal open={payOpen} title="Record staff payment" onClose={() => setPayOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={savePayment}>Save payment</Button>}>
        <div className="space-y-3">
          <Field label="Employee">
            <Select value={payForm.employee_id} onChange={(e) => setPayForm((f) => ({ ...f, employee_id: e.target.value }))}>
              <option value="">Choose an employee</option>
              {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <Select value={payForm.type} onChange={(e) => setPayForm((f) => ({ ...f, type: e.target.value }))}>
                {PAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Amount (Rs)"><Input value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date"><Input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Method"><Input value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))} /></Field>
          </div>
          <Field label="Notes"><Textarea value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} rows={2} /></Field>
        </div>
      </Modal>

      <Modal open={docOpen} title="Upload employee document" onClose={() => setDocOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={saveDocument}>Upload document</Button>}>
        <div className="space-y-3">
          <Field label="Employee">
            <Select value={docForm.employee_id} onChange={(e) => setDocForm((f) => ({ ...f, employee_id: e.target.value }))}>
              <option value="">Choose an employee</option>
              {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category"><Input value={docForm.category} onChange={(e) => setDocForm((f) => ({ ...f, category: e.target.value }))} /></Field>
            <Field label="Label"><Input value={docForm.label} onChange={(e) => setDocForm((f) => ({ ...f, label: e.target.value }))} /></Field>
          </div>
          <input ref={fileRef} type="file" className="hidden" onChange={pickDoc} />
          <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> {docForm.file ? "Replace file" : "Attach file"}
          </Button>
          {docForm.file ? <p className="text-center text-[11px] text-emerald-600">File ready</p> : null}
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete employee?" message="Attendance, payroll and documents for this employee will also be removed."
        onClose={() => setDeleting(null)} onConfirm={removeEmployee} />
      <Confirm open={!!deletingAtt} title="Remove attendance?" message="This attendance entry will be deleted."
        onClose={() => setDeletingAtt(null)} onConfirm={removeAttendance} />
      <Confirm open={!!deletingPay} title="Remove payment?" message="This staff payment will be deleted."
        onClose={() => setDeletingPay(null)} onConfirm={removePayment} />
      <Confirm open={!!deletingDoc} title="Remove document?" message="This document and its file will be deleted."
        onClose={() => setDeletingDoc(null)} onConfirm={removeDoc} />
    </div>
  );
}

function formFrom(row) {
  return {
    name: row.name || "", phone: row.phone || "", email: row.email || "", address: row.address || "",
    role: row.role || "", designation: row.designation || "", salary_type: row.salary_type || "salary",
    salary_rate: String(row.salary_rate ?? ""), starting_date: row.starting_date || "", joining_date: row.joining_date || "",
    rank: row.rank || "noob", stars: String(row.stars ?? 1), shift_start: row.shift_start || "", shift_end: row.shift_end || "",
    pf_enabled: !!row.pf_enabled, pf_rate: String(row.pf_rate ?? ""), status: row.status || "active",
    last_working_date: row.last_working_date || "", bank_name: row.bank_name || "", bank_account_no: row.bank_account_no || "",
    bank_ifsc: row.bank_ifsc || "", upi_id: row.upi_id || "", date_of_birth: row.date_of_birth || "",
    emergency_contact_name: row.emergency_contact_name || "", emergency_contact_phone: row.emergency_contact_phone || "",
    id_proof_type: row.id_proof_type || "", id_proof_number: row.id_proof_number || "", notes: row.notes || ""
  };
}
