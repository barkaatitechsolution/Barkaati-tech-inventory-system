import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, Plus, Search, Trash2, Wallet, XCircle } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
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

const STATUSES = ["pending", "cleared", "bounced"];
const FILTERS = ["all", "pending", "cleared", "bounced"];
const blank = () => ({
  cheque_no: "",
  bank_name: "",
  drawer_name: "",
  payee: "",
  amount: "",
  cheque_date: new Date().toISOString().slice(0, 10),
  clearing_date: "",
  status: "pending",
  supplier_id: "",
  customer_id: "",
  notes: ""
});

const tone = (status) => (status === "cleared" ? "green" : status === "bounced" ? "red" : "amber");

export default function Cheques() {
  const { version, bump } = useApp();
  const cheques = useAsync(() => api.cheques(), [version]);
  const suppliers = useAsync(() => api.suppliers(), [version]);
  const customers = useAsync(() => api.customers(), [version]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) setForm(editing ? formFrom(editing) : blank());
  }, [open, editing]);

  const rows = cheques.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.cheque_no, r.bank_name, r.drawer_name, r.payee, r.supplier_name, r.customer_name, r.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const totals = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending").reduce((n, r) => n + (Number(r.amount) || 0), 0);
    const cleared = rows.filter((r) => r.status === "cleared").reduce((n, r) => n + (Number(r.amount) || 0), 0);
    return { pending, cleared, count: rows.length };
  }, [rows]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.cheque_no.trim()) return showToast("Enter the cheque number", "error");
    if (!(Number(form.amount) > 0)) return showToast("Enter a valid amount", "error");
    setSaving(true);
    try {
      const payload = {
        ...form,
        cheque_no: form.cheque_no.trim(),
        amount: Number(form.amount) || 0,
        supplier_id: form.supplier_id || null,
        customer_id: form.customer_id || null
      };
      if (editing) await api.updateCheque(editing.id, payload);
      else await api.createCheque(payload);
      showToast(editing ? "Cheque updated" : "Cheque added");
      setOpen(false);
      bump();
      cheques.reload();
    } catch (e) {
      showToast(e?.message || "Could not save cheque", "error");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row, status) => {
    try {
      await api.updateChequeStatus(row.id, { status });
      showToast(`Marked ${status}`);
      bump();
      cheques.reload();
    } catch (e) {
      showToast(e?.message || "Could not update", "error");
    }
  };

  const remove = async () => {
    try {
      await api.deleteCheque(deleting.id);
      showToast("Cheque deleted");
      setDeleting(null);
      bump();
      cheques.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Cheques"
        subtitle={`${totals.count} cheques · ${fmtMoney(totals.pending)} pending`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>}
      />

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pending value</p>
            <p className="mt-0.5 text-lg font-bold text-amber-600">{fmtMoney(totals.pending)}</p>
          </Card>
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cleared value</p>
            <p className="mt-0.5 text-lg font-bold text-emerald-600">{fmtMoney(totals.cleared)}</p>
          </Card>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cheques" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
                filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              {f}
            </button>
          ))}
        </div>

        {cheques.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : cheques.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{cheques.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Wallet className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">#{r.cheque_no}</p>
                      <p className="shrink-0 text-sm font-bold text-slate-900">{fmtMoney(r.amount)}</p>
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {[r.bank_name, r.drawer_name || r.payee, r.supplier_name || r.customer_name].filter(Boolean).join(" · ") || "No party"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={tone(r.status)}>{r.status}</Badge>
                      <span className="text-[10px] text-slate-400">Dated {fmtDate(r.cheque_date)}</span>
                      {r.clearing_date ? <span className="text-[10px] text-slate-400">· clears {fmtDate(r.clearing_date)}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    {r.status !== "cleared" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(r, "cleared")}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Clear
                      </Button>
                    ) : null}
                    {r.status !== "bounced" ? (
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setStatus(r, "bounced")}>
                        <XCircle className="h-3.5 w-3.5" /> Bounce
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton onClick={() => { setEditing(r); setOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton onClick={() => setDeleting(r)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Wallet} title="No cheques" description="Record post-dated and received cheques here."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add cheque</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit cheque" : "Add cheque"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save cheque</Button>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cheque no."><Input value={form.cheque_no} onChange={set("cheque_no")} autoFocus /></Field>
            <Field label="Amount (Rs)"><Input value={form.amount} onChange={set("amount")} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bank"><Input value={form.bank_name} onChange={set("bank_name")} /></Field>
            <Field label="Drawer name"><Input value={form.drawer_name} onChange={set("drawer_name")} /></Field>
          </div>
          <Field label="Payee"><Input value={form.payee} onChange={set("payee")} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cheque date"><Input type="date" value={form.cheque_date} onChange={set("cheque_date")} /></Field>
            <Field label="Clearing date"><Input type="date" value={form.clearing_date} onChange={set("clearing_date")} /></Field>
          </div>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Supplier">
              <Select value={form.supplier_id} onChange={set("supplier_id")}>
                <option value="">None</option>
                {(suppliers.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Customer">
              <Select value={form.customer_id} onChange={set("customer_id")}>
                <option value="">None</option>
                {(customers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete cheque?" message="This cheque record will be removed."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}

function formFrom(row) {
  return {
    cheque_no: row.cheque_no || "",
    bank_name: row.bank_name || "",
    drawer_name: row.drawer_name || "",
    payee: row.payee || "",
    amount: String(row.amount ?? ""),
    cheque_date: row.cheque_date || new Date().toISOString().slice(0, 10),
    clearing_date: row.clearing_date || "",
    status: row.status || "pending",
    supplier_id: row.supplier_id ? String(row.supplier_id) : "",
    customer_id: row.customer_id ? String(row.customer_id) : "",
    notes: row.notes || ""
  };
}
