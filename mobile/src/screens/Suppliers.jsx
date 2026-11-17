import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Pencil, Plus, Search, Trash2, Truck } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { shareToWhatsApp } from "../lib/share.js";
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
  Spinner,
  Textarea,
  showToast
} from "../components/ui.jsx";

const blank = () => ({ name: "", company: "", phone: "", email: "", address: "", notes: "" });

export default function Suppliers() {
  const { version, bump } = useApp();
  const suppliers = useAsync(() => api.suppliers(), [version]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (open) setForm(editing ? { ...blank(), ...editing } : blank());
  }, [open, editing]);

  const rows = suppliers.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => [s.name, s.company, s.phone, s.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) return showToast("Enter the supplier name", "error");
    setSaving(true);
    try {
      if (editing) await api.updateSupplier(editing.id, form);
      else await api.createSupplier(form);
      showToast(editing ? "Supplier updated" : "Supplier added");
      setOpen(false);
      bump();
      suppliers.reload();
    } catch (e) {
      showToast(e?.message || "Could not save supplier", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteSupplier(deleting.id);
      showToast("Supplier deleted");
      setDeleting(null);
      bump();
      suppliers.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const openDetail = async (row) => {
    try {
      const data = await api.supplier(row.id);
      setDetail(data);
    } catch (e) {
      showToast(e?.message || "Could not load supplier", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Suppliers" subtitle={`${rows.length} suppliers`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>} />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers" />
        </div>

        {suppliers.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((s) => (
              <Card key={s.id} className="p-3">
                <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => openDetail(s)}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Truck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{s.company || "Supplier"}{s.phone ? ` · ${s.phone}` : ""}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <Button size="sm" variant="ghost" onClick={() => shareToWhatsApp(s.phone, `Hello ${s.name},`)}>WhatsApp</Button>
                  <div className="flex items-center gap-1">
                    <IconButton onClick={() => { setEditing(s); setOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton onClick={() => setDeleting(s)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Truck} title="No suppliers" description="Add suppliers to record purchases and balances."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add supplier</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit supplier" : "Add supplier"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save supplier</Button>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><Input value={form.name} onChange={set("name")} autoFocus /></Field>
            <Field label="Company"><Input value={form.company} onChange={set("company")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
            <Field label="Email"><Input value={form.email} onChange={set("email")} inputMode="email" /></Field>
          </div>
          <Field label="Address"><Input value={form.address} onChange={set("address")} /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Modal open={!!detail} title={detail?.name || "Supplier"} onClose={() => setDetail(null)} wide>
        {detail ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Outstanding</p>
                <p className="text-lg font-bold text-amber-600">{fmtMoney(detail.balance)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Purchases</p>
                <p className="text-lg font-bold text-slate-900">{detail.purchases?.length || 0}</p>
              </div>
            </div>
            <div className="space-y-1 text-sm text-slate-600">
              {detail.company ? <p>{detail.company}</p> : null}
              {detail.phone ? <p>{detail.phone}</p> : null}
              {detail.email ? <p>{detail.email}</p> : null}
              {detail.address ? <p>{detail.address}</p> : null}
              {detail.notes ? <p className="text-slate-400">{detail.notes}</p> : null}
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Recent purchases</p>
              <div className="space-y-2">
                {(detail.purchases || []).slice(0, 20).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{p.invoice_no || `Purchase #${p.id}`}</p>
                      <p className="text-[10px] text-slate-400">{fmtDate(p.purchased_at)}{p.due_date ? ` · due ${fmtDate(p.due_date)}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-800">{fmtMoney(p.total)}</p>
                      <Badge tone={Number(p.total) > Number(p.paid) ? "amber" : "green"}>
                        {Number(p.total) > Number(p.paid) ? `Due ${fmtMoney(Number(p.total) - Number(p.paid))}` : "Paid"}
                      </Badge>
                    </div>
                  </div>
                ))}
                {!detail.purchases?.length ? <p className="text-xs text-slate-400">No purchases yet.</p> : null}
              </div>
            </div>
            <Link to="/purchases"><Button variant="outline" className="w-full">Go to purchases</Button></Link>
          </div>
        ) : null}
      </Modal>

      <Confirm open={!!deleting} title="Delete supplier?" message="Purchases will be kept but unlinked."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
