import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Banknote, Plus, Search, Pencil, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../api.js";
import { fmtMoney, fmtDate, toDateInput } from "../lib/format.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 15;

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "cleared", label: "Cleared" },
  { value: "bounced", label: "Bounced" }
];

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "cleared", label: "Cleared" },
  { value: "bounced", label: "Bounced" }
];

const EMPTY_FORM = () => ({
  cheque_no: "",
  bank_name: "",
  drawer_name: "",
  amount: "",
  issue_date: "",
  clearing_date: "",
  status: "pending",
  supplier_id: "",
  customer_id: "",
  notes: ""
});

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const statOf = (r) => {
  if (r.status === "cleared") return { key: "cleared", label: "Cleared", color: "bg-emerald-50 text-emerald-700" };
  if (r.status === "bounced") return { key: "bounced", label: "Bounced", color: "bg-rose-50 text-rose-700" };
  if (r.status === "pending") {
    const clearing = r.clearing_date ? String(r.clearing_date).slice(0, 10) : "";
    if (clearing && clearing < todayStr()) {
      return { key: "overdue", label: "Overdue", color: "bg-orange-50 text-orange-700" };
    }
    return { key: "pending", label: "Pending", color: "bg-amber-50 text-amber-700" };
  }
  return { key: "pending", label: "Pending", color: "bg-amber-50 text-amber-700" };
};

const partyOf = (r) => {
  if (r.supplier_name) return { name: r.supplier_name, type: "To supplier" };
  if (r.customer_name) return { name: r.customer_name, type: "From customer" };
  return null;
};

export default function Cheques() {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [cheques, sup, cus] = await Promise.all([api.cheques(), api.suppliers(), api.customers()]);
      setRows(cheques);
      setSuppliers(sup || []);
      setCustomers(cus || []);
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
      const party = partyOf(r);
      const matchesQuery =
        !q ||
        [r.cheque_no, r.bank_name, r.drawer_name, party?.name, r.notes]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesStatus = !statusFilter || statOf(r).key === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [rows, debouncedSearch, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  const stats = useMemo(() => {
    const counts = { pending: 0, overdue: 0, cleared: 0, bounced: 0, outstanding: 0 };
    rows.forEach((r) => {
      const key = statOf(r).key;
      if (key === "overdue") {
        counts.overdue += 1;
      } else if (counts[key] != null) {
        counts[key] += 1;
      }
      if (key === "pending" || key === "overdue") counts.outstanding += Number(r.amount) || 0;
    });
    return counts;
  }, [rows]);

  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }));
  const customerOptions = customers.map((c) => ({ value: c.id, label: c.name }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM());
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      cheque_no: r.cheque_no || "",
      bank_name: r.bank_name || "",
      drawer_name: r.drawer_name || "",
      amount: r.amount != null ? String(Number(r.amount)) : "",
      issue_date: toDateInput(r.issue_date),
      clearing_date: toDateInput(r.clearing_date),
      status: r.status || "pending",
      supplier_id: r.supplier_id ? String(r.supplier_id) : "",
      customer_id: r.customer_id ? String(r.customer_id) : "",
      notes: r.notes || ""
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.cheque_no.trim()) {
      setFormError("Enter the cheque number");
      return;
    }
    if (!(Number(form.amount) > 0)) {
      setFormError("Amount must be greater than zero");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      cheque_no: form.cheque_no.trim(),
      bank_name: form.bank_name.trim() || null,
      drawer_name: form.drawer_name.trim() || null,
      amount: Number(form.amount) || 0,
      issue_date: form.issue_date || null,
      clearing_date: form.clearing_date || null,
      status: form.status,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      customer_id: form.customer_id ? Number(form.customer_id) : null,
      notes: form.notes.trim() || null
    };
    try {
      if (editing) await api.updateCheque(editing.id, payload);
      else await api.createCheque(payload);
      setOpen(false);
      setToast(editing ? "Cheque updated" : "Cheque added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const markStatus = async (r, status) => {
    try {
      await api.updateChequeStatus(r.id, status);
      setToast(status === "cleared" ? "Cheque marked as cleared" : "Cheque marked as bounced");
      await load();
    } catch (err) {
      setToast(err.message);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteCheque(toDelete.id);
      setToDelete(null);
      setToast("Cheque deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Pending</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{stats.pending}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Overdue</p>
          <p className="mt-1 text-xl font-bold text-orange-600">{stats.overdue}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Cleared</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{stats.cleared}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Bounced</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{stats.bounced}</p>
        </Card>
        <Card className="!p-3 sm:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Outstanding</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{fmtMoney(stats.outstanding)}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cheques, bank, name…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={STATUSES}
          placeholder="All statuses"
          searchPlaceholder="Search statuses..."
          className="w-full sm:w-44"
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Cheque
          </Button>
        </div>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-rose-600">Failed to load cheques: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Banknote className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No cheques found</p>
            <p className="mt-1 text-sm text-slate-500">Add a cheque to track its number, clearing date and payee.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Date</th>
                    <th className="px-3 py-3">Cheque No</th>
                    <th className="hidden px-3 py-3 md:table-cell">Bank / Drawer</th>
                    <th className="hidden px-3 py-3 lg:table-cell">Payee</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Clearing</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const st = statOf(r);
                    const party = partyOf(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <p className="font-semibold text-slate-800">{r.issue_date ? fmtDate(r.issue_date) : "—"}</p>
                          <p className="font-mono text-xs text-slate-400 sm:hidden">{r.cheque_no}</p>
                        </td>
                        <td className="px-3 py-3 font-mono text-sm font-semibold text-slate-800">{r.cheque_no}</td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          <p className="text-slate-800">{r.bank_name || "—"}</p>
                          <p className="text-[11px] text-slate-400">{r.drawer_name || ""}</p>
                        </td>
                        <td className="hidden px-3 py-3 lg:table-cell">
                          {party ? (
                            <>
                              <p className="text-slate-800">{party.name}</p>
                              <p className="text-[11px] text-slate-400">{party.type}</p>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-800">{fmtMoney(r.amount)}</td>
                        <td className="hidden px-3 py-3 sm:table-cell">
                          <span className={r.clearing_date ? "text-slate-700" : "text-slate-400"}>
                            {r.clearing_date ? fmtDate(r.clearing_date) : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.color}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-0.5">
                            {r.status === "pending" && (
                              <>
                                <button
                                  onClick={() => markStatus(r, "cleared")}
                                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                                  title="Mark as cleared"
                                  aria-label="Mark as cleared"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => markStatus(r, "bounced")}
                                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                  title="Mark as bounced"
                                  aria-label="Mark as bounced"
                                >
                                  <XCircle className="h-4 w-4" />
                                </button>
                              </>
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((r) => {
                const st = statOf(r);
                const party = partyOf(r);
                return (
                  <div key={r.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-semibold text-slate-800">{r.cheque_no}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {r.issue_date ? fmtDate(r.issue_date) : "No date"}
                          {r.bank_name ? ` · ${r.bank_name}` : ""}
                        </p>
                        {party && (
                          <p className="mt-1 truncate text-xs text-slate-600">
                            {party.name} <span className="text-[10px] text-slate-400">({party.type})</span>
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 font-semibold text-slate-800">{fmtMoney(r.amount)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.color}`}>
                        {st.label}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {r.clearing_date ? `Clearing ${fmtDate(r.clearing_date)}` : "No clearing date"}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        {r.status === "pending" && (
                          <>
                            <button
                              onClick={() => markStatus(r, "cleared")}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                              aria-label="Mark as cleared"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => markStatus(r, "bounced")}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Mark as bounced"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
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
          </>
        )}

        {!loading && !error && filtered.length > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Cheque" : "Add Cheque"}
        subtitle="Cheque number, dates, amount and payee"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cheque number" required>
              <Input
                value={form.cheque_no}
                onChange={(e) => setForm({ ...form, cheque_no: e.target.value })}
                required
                placeholder="e.g. 004521"
              />
            </Field>
            <Field label="Amount" required>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                placeholder="0"
              />
            </Field>
            <Field label="Bank name">
              <Input
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                placeholder="e.g. SBI, HDFC"
              />
            </Field>
            <Field label="Drawer / Branch">
              <Input
                value={form.drawer_name}
                onChange={(e) => setForm({ ...form, drawer_name: e.target.value })}
                placeholder="Who signed the cheque"
              />
            </Field>
            <Field label="Issue date">
              <Input
                type="date"
                value={form.issue_date}
                onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
              />
            </Field>
            <Field label="Clearing date">
              <Input
                type="date"
                value={form.clearing_date}
                onChange={(e) => setForm({ ...form, clearing_date: e.target.value })}
              />
            </Field>
            <Field label="Given to supplier">
              <SearchableSelect
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value, customer_id: e.target.value ? "" : form.customer_id })}
                options={[{ value: "", label: "None" }, ...supplierOptions]}
                placeholder="Select supplier"
                searchPlaceholder="Search suppliers..."
              />
            </Field>
            <Field label="Received from customer">
              <SearchableSelect
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value, supplier_id: e.target.value ? "" : form.supplier_id })}
                options={[{ value: "", label: "None" }, ...customerOptions]}
                placeholder="Select customer"
                searchPlaceholder="Search customers..."
              />
            </Field>
            <Field label="Status">
              <SearchableSelect
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={STATUS_OPTIONS}
                placeholder="Select status"
                searchPlaceholder="Search..."
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional remarks"
              />
            </Field>
          </div>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Cheque" : "Add Cheque"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete cheque?"
        message={`Cheque #${toDelete?.cheque_no} will be permanently removed.`}
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