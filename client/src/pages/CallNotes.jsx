import { useEffect, useMemo, useState } from "react";
import {
  PhoneCall,
  Plus,
  Search,
  Pencil,
  Trash2,
  CheckCircle2,
  RotateCcw,
  NotebookPen
} from "lucide-react";
import { api } from "../api";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { useDebouncedState } from "../lib/useDebounced.js";
import { fmtDateTime } from "../lib/format";

const CONTACT_TYPES = [
  { value: "customer", label: "Customer" },
  { value: "supplier", label: "Supplier" },
  { value: "client", label: "Client" },
  { value: "other", label: "Other" }
];

const TYPE_PILL = {
  customer: "bg-indigo-50 text-indigo-700",
  supplier: "bg-sky-50 text-sky-700",
  client: "bg-violet-50 text-violet-700",
  other: "bg-slate-100 text-slate-600"
};

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" }
];

const PRIORITY_PILL = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-amber-50 text-amber-700",
  high: "bg-rose-50 text-rose-700"
};

const EMPTY_FORM = () => ({
  contact_type: "customer",
  customer_id: "",
  supplier_id: "",
  contact_name: "",
  phone: "",
  subject: "",
  note: "",
  call_back_at: "",
  priority: "normal"
});

const pad = (n) => String(n).padStart(2, "0");

// A timestamp from the server arrives as an ISO string; <input type="datetime-local">
// wants "YYYY-MM-DDTHH:MM" in the shop's own timezone.
const toLocalInput = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Quick picks for the call-back slot.
const quickSlot = (dayOffset, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
};

const startOfDay = (value) => String(value || "").slice(0, 10);

export default function CallNotes() {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [notes, cus, sup] = await Promise.all([
        api.callNotes({ limit: 200 }),
        api.customers(),
        api.suppliers()
      ]);
      setRows(notes || []);
      setCustomers(cus || []);
      setSuppliers(sup || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesStatus =
        !statusFilter ||
        (statusFilter === "pending" ? r.status === "pending" : r.status === "done");
      const matchesType = !typeFilter || r.contact_type === typeFilter;
      const matchesQuery =
        !q ||
        [r.contact_name, r.subject, r.note, r.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      return matchesStatus && matchesType && matchesQuery;
    });
  }, [rows, debouncedSearch, statusFilter, typeFilter]);

  const stats = useMemo(() => {
    const today = todayStr();
    const pending = rows.filter((r) => r.status === "pending");
    const dueToday = pending.filter((r) => startOfDay(r.call_back_at) === today);
    const overdue = pending.filter(
      (r) => r.call_back_at && new Date(r.call_back_at).getTime() < Date.now()
    );
    const done = rows.filter((r) => r.status === "done");
    return { pending: pending.length, dueToday: dueToday.length, overdue: overdue.length, done: done.length };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM());
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      contact_type: row.contact_type || "customer",
      customer_id: row.customer_id ? String(row.customer_id) : "",
      supplier_id: row.supplier_id ? String(row.supplier_id) : "",
      contact_name: row.contact_name || "",
      phone: row.phone || "",
      subject: row.subject || "",
      note: row.note || "",
      call_back_at: toLocalInput(row.call_back_at),
      priority: row.priority || "normal"
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      contact_type: form.contact_type,
      customer_id: form.contact_type === "customer" ? form.customer_id || null : null,
      supplier_id: form.contact_type === "supplier" ? form.supplier_id || null : null,
      contact_name: form.contact_name.trim(),
      phone: form.phone.trim() || null,
      subject: form.subject.trim(),
      note: form.note.trim(),
      call_back_at: form.call_back_at || null,
      priority: form.priority
    };
    try {
      if (editing) await api.updateCallNote(editing.id, payload);
      else await api.createCallNote(payload);
      setOpen(false);
      setToast(editing ? "Note updated" : "Note added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row, status) => {
    try {
      await api.updateCallNoteStatus(row.id, status);
      setToast(status === "done" ? "Marked as called back" : "Reopened");
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteCallNote(toDelete.id);
      setToDelete(null);
      setToast("Note deleted");
      await load();
    } catch (e) {
      setError(e.message);
      setToDelete(null);
    }
  };

  const contactOptions =
    form.contact_type === "customer"
      ? customers.map((c) => ({ value: String(c.id), label: c.name }))
      : form.contact_type === "supplier"
        ? suppliers.map((s) => ({ value: String(s.id), label: s.name }))
        : [];

  const usePickedContact = (value) => {
    setForm((prev) => {
      const next = { ...prev, contact_name: "" };
      if (form.contact_type === "customer") {
        const c = customers.find((x) => String(x.id) === String(value));
        next.customer_id = value;
        if (c) {
          next.contact_name = c.name;
          next.phone = c.phone || prev.phone;
        }
      } else if (form.contact_type === "supplier") {
        const s = suppliers.find((x) => String(x.id) === String(value));
        next.supplier_id = value;
        if (s) {
          next.contact_name = s.name;
          next.phone = s.phone || prev.phone;
        }
      }
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={PhoneCall}
          label="To call back"
          value={stats.pending}
          sub="notes still open"
          tone="indigo"
        />
        <StatCard
          icon={NotebookPen}
          label="Due today"
          value={stats.dueToday}
          sub="scheduled for today"
          tone="amber"
        />
        <StatCard
          icon={PhoneCall}
          label="Overdue"
          value={stats.overdue}
          sub="call back time has passed"
          tone="rose"
        />
        <StatCard
          icon={CheckCircle2}
          label="Called back"
          value={stats.done}
          sub="notes closed"
          tone="emerald"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="pending">To call back</option>
          <option value="done">Called back</option>
          <option value="">All notes</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">Everyone</option>
          {CONTACT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New note
          </Button>
        </div>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <PhoneCall className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No notes here</p>
            <p className="mt-1 text-sm text-slate-500">
              Write down what someone said and set the time to call them back.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const overdue =
                r.status === "pending" && r.call_back_at && new Date(r.call_back_at).getTime() < Date.now();
              const dueToday = r.status === "pending" && startOfDay(r.call_back_at) === todayStr();
              return (
                <div key={r.id} className="p-4 sm:px-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {r.contact_name}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            TYPE_PILL[r.contact_type] || TYPE_PILL.other
                          }`}
                        >
                          {CONTACT_TYPES.find((t) => t.value === r.contact_type)?.label || r.contact_type}
                        </span>
                        {r.phone && (
                          <span className="text-[11px] text-slate-400">{r.phone}</span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            PRIORITY_PILL[r.priority] || PRIORITY_PILL.normal
                          }`}
                        >
                          {PRIORITIES.find((p) => p.value === r.priority)?.label || "Normal"}
                        </span>
                      </div>
                      {r.subject && (
                        <p className="mt-1 text-sm font-medium text-slate-700">{r.subject}</p>
                      )}
                      {r.note && (
                        <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-500">
                          {r.note}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {r.status === "done" && r.called_at
                          ? `Called back on ${fmtDateTime(r.called_at)}`
                          : `Noted on ${fmtDateTime(r.created_at)}`}
                      </p>
                    </div>

                    <div className="text-right">
                      {r.call_back_at ? (
                        <>
                          <p className="text-[11px] uppercase tracking-wide text-slate-400">
                            Call back
                          </p>
                          <p className="text-sm font-semibold text-slate-800">
                            {fmtDateTime(r.call_back_at)}
                          </p>
                          {overdue && (
                            <span className="mt-1 inline-block rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              Overdue
                            </span>
                          )}
                          {!overdue && dueToday && (
                            <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              Today
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-400">No time set</span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {r.status === "pending" ? (
                        <button
                          onClick={() => setStatus(r, "done")}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                          aria-label="Mark called back"
                          title="Mark as called back"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setStatus(r, "pending")}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
                          aria-label="Reopen"
                          title="Reopen this note"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setToDelete(r)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit note" : "New call note"}
        subtitle="What was said, and when to call back"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who is it about" required>
              <select
                value={form.contact_type}
                onChange={(e) => setForm({ ...form, contact_type: e.target.value, customer_id: "", supplier_id: "" })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {CONTACT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>

            {contactOptions.length > 0 ? (
              <Field label={form.contact_type === "customer" ? "Customer" : "Supplier"} required>
                <SearchableSelect
                  value={form.contact_type === "customer" ? form.customer_id : form.supplier_id}
                  onChange={(e) => usePickedContact(e.target.value)}
                  options={contactOptions}
                  placeholder="Search…"
                  searchPlaceholder="Search…"
                />
              </Field>
            ) : (
              <Field label="Name" required>
                <Input
                  value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                  placeholder="Who did you speak to?"
                />
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0300-1234567"
              />
            </Field>
            <Field label="Subject">
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Asked for 5 bags of rice"
              />
            </Field>
          </div>

          <Field label="What was said" hint="Note the exact request, price talked, or promise made.">
            <Textarea
              rows={3}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Said the 5kg pack is too costly; will decide after Diwali…"
            />
          </Field>

          <Field label="Call back on" hint="Pick the date and the time of the call.">
            <Input
              type="datetime-local"
              value={form.call_back_at}
              onChange={(e) => setForm({ ...form, call_back_at: e.target.value })}
            />
          </Field>
          <div className="-mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="soft" className="!px-3 !py-1.5 text-xs" onClick={() => setForm({ ...form, call_back_at: quickSlot(0, 18) })}>
              Today 6 PM
            </Button>
            <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setForm({ ...form, call_back_at: quickSlot(1, 10) })}>
              Tomorrow 10 AM
            </Button>
            <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setForm({ ...form, call_back_at: quickSlot(3, 11) })}>
              In 3 days
            </Button>
          </div>

          <Field label="Priority">
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update note" : "Save note"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this note?"
        message={toDelete ? `"${toDelete.subject || toDelete.contact_name}" will be permanently removed.` : ""}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
