import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Wallet, Trash2, Calendar } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDate } from "../lib/format.js";

const PAGE_SIZE = 20;

const CATEGORIES = [
  "Rent",
  "Utilities",
  "Salaries",
  "Transport",
  "Marketing",
  "Office Supplies",
  "Maintenance",
  "Insurance",
  "Taxes",
  "Other"
].map((c) => ({ value: c, label: c }));

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "online", label: "Online" }
];

const EMPTY = {
  category: "",
  amount: "",
  description: "",
  payment_method: "cash",
  date: new Date().toISOString().slice(0, 10)
};

export default function Expenses() {
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSaving, setNewCatSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [expenses, categoryRows] = await Promise.all([api.expenses(), api.expenseCategories()]);
      setRows(expenses);
      setCats(categoryRows);
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
    const q = search.trim().toLowerCase();
    return rows.filter((e) => {
      const matchesQuery =
        !q ||
        [e.category, e.description, e.payment_method]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesCat = !catFilter || e.category === catFilter;
      return matchesQuery && matchesCat;
    });
  }, [rows, search, catFilter]);

  const catOptions = useMemo(() => {
    const map = new Map();
    const push = (name) => {
      const n = String(name || "").trim();
      if (n && !map.has(n)) map.set(n, { value: n, label: n });
    };
    CATEGORIES.forEach((o) => push(o.value));
    cats.forEach((c) => push(c.name));
    rows.forEach((r) => push(r.category));
    return [...map.values()];
  }, [cats, rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, catFilter]);

  const stats = useMemo(() => {
    const total = rows.reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const thisMonth = rows
      .filter((e) => e.date && e.date.slice(0, 7) === new Date().toISOString().slice(0, 7))
      .reduce((a, e) => a + (Number(e.amount) || 0), 0);
    return { total, thisMonth, count: rows.length };
  }, [rows]);

  const openCreate = () => {
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      category: form.category,
      amount: Number(form.amount) || 0,
      description: form.description.trim() || null,
      payment_method: form.payment_method,
      date: form.date || null
    };
    try {
      await api.createExpense(payload);
      setOpen(false);
      setToast("Expense added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteExpense(toDelete.id);
      setToDelete(null);
      setToast("Expense deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const createCat = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setNewCatSaving(true);
    setFormError(null);
    try {
      await api.createExpenseCategory({ name });
      setCats(await api.expenseCategories());
      setForm({ ...form, category: name });
      setNewCatOpen(false);
      setNewCatName("");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setNewCatSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">This Month</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{fmtMoney(stats.thisMonth)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">All Time</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{fmtMoney(stats.total)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Transactions</p>
          <p className="mt-1 text-xl font-bold text-indigo-600">{stats.count}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          options={[{ value: "", label: "All categories" }, ...catOptions]}
          placeholder="All categories"
          searchPlaceholder="Search categories..."
          className="w-full sm:w-48"
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Expense
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
          <p className="p-5 text-sm text-rose-600">Failed to load expenses: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Wallet className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No expenses found</p>
            <p className="mt-1 text-sm text-slate-500">Record an expense to track your spending.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Category</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Description</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Date</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Payment</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-3 py-3 sm:px-5">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {e.category}
                        </span>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">{e.description || "—"}</td>
                      <td className="hidden px-3 py-3 text-slate-500 sm:table-cell">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {fmtDate(e.date)}
                        </span>
                      </td>
                      <td className="hidden px-3 py-3 capitalize text-slate-600 sm:table-cell">{e.payment_method}</td>
                      <td className="px-3 py-3 text-right font-bold text-rose-600">{fmtMoney(e.amount)}</td>
                      <td className="px-3 py-3 text-right sm:px-5">
                        <button
                          onClick={() => setToDelete(e)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {e.category}
                    </span>
                    <p className="mt-1.5 truncate text-sm text-slate-700">{e.description || "—"}</p>
                    <p className="mt-0.5 text-[11px] capitalize text-slate-400">
                      <Calendar className="mr-1 inline h-3 w-3 align-[-1px]" />
                      {fmtDate(e.date)}
                      <span className="capitalize"> · {e.payment_method}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <p className="text-sm font-bold text-rose-600">{fmtMoney(e.amount)}</p>
                    <button
                      onClick={() => setToDelete(e)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
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
        title="Add Expense"
        subtitle="Record a new expense"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <SearchableSelect
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    options={[{ value: "", label: "Select category" }, ...catOptions]}
                    placeholder="Select category"
                    searchPlaceholder="Search categories..."
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="soft"
                  className="h-[42px] shrink-0 px-3"
                  onClick={() => setNewCatOpen(true)}
                  aria-label="Create category"
                  title="Create new category"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {newCatOpen && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        createCat();
                      }
                    }}
                    placeholder="New category name"
                    autoFocus
                    disabled={newCatSaving}
                  />
                  <Button type="button" onClick={createCat} disabled={!newCatName.trim() || newCatSaving} className="shrink-0">
                    {newCatSaving ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      setNewCatOpen(false);
                      setNewCatName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Amount" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                placeholder="0.00"
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </Field>
            <Field label="Payment method">
              <SearchableSelect
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                options={METHODS}
                placeholder="Select method"
                searchPlaceholder="Search methods..."
              />
            </Field>
          </div>
          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What was this expense for?"
            />
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add Expense"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete expense?"
        message={`"${toDelete?.category} — ${fmtMoney(toDelete?.amount)}" will be permanently removed.`}
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