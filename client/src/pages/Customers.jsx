import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Plus, Search, Users, Pencil, Trash2, Phone, Mail } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney } from "../lib/format.js";

const PAGE_SIZE = 20;

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  address: "",
  credit_limit: "",
  category_id: ""
};

export default function Customers() {
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [catFilter, setCatFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSaving, setNewCatSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [customerRows, categoryRows] = await Promise.all([api.customers(), api.customerCategories()]);
      setRows(customerRows);
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
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((c) => {
      const matchesQuery =
        !q ||
        [c.name, c.phone, c.email, c.address, c.category_name]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesCat = !catFilter || String(c.category_id) === String(catFilter);
      return matchesQuery && matchesCat;
    });
  }, [rows, debouncedSearch, catFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, catFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const withBalance = rows.filter((c) => Number(c.balance) > 0).length;
    const totalBalance = rows.reduce((a, c) => a + (Number(c.balance) || 0), 0);
    return { total, withBalance, totalBalance };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      credit_limit: c.credit_limit ?? "",
      category_id: c.category_id ?? ""
    });
    setFormError(null);
    setOpen(true);
  };

  const createCat = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setNewCatSaving(true);
    setFormError(null);
    try {
      await api.createCustomerCategory({ name });
      const categoryRows = await api.customerCategories();
      setCats(categoryRows);
      const created = categoryRows.find((c) => c.name === name);
      setForm({ ...form, category_id: created ? String(created.id) : "" });
      setNewCatOpen(false);
      setNewCatName("");
      setToast("Category added");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setNewCatSaving(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      credit_limit: Number(form.credit_limit) || 0,
      category_id: form.category_id ? Number(form.category_id) : null
    };
    try {
      if (editing) await api.updateCustomer(editing.id, payload);
      else await api.createCustomer(payload);
      setOpen(false);
      setToast(editing ? "Customer updated" : "Customer added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteCustomer(toDelete.id);
      setToDelete(null);
      setToast("Customer deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total Customers</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{stats.total}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">With Balance</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{stats.withBalance}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total Outstanding</p>
          <p className={`mt-1 text-xl font-bold ${stats.totalBalance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
            {fmtMoney(stats.totalBalance)}
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-44"
        >
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Customer
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
          <p className="p-5 text-sm text-rose-600">Failed to load customers: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Users className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No customers found</p>
            <p className="mt-1 text-sm text-slate-500">Add a customer to start tracking purchases.</p>
          </div>
        ) : (
          <>
          <div className="hidden overflow-x-auto scrollbar-thin sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-3 sm:px-5">Name</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Category</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Phone</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Email</th>
                  <th className="hidden px-3 py-3 text-right sm:table-cell">Credit Limit</th>
                  <th className="px-3 py-3 text-right">Balance</th>
                  <th className="px-3 py-3 text-right sm:px-5">—</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => {
                  const bal = Number(c.balance) || 0;
                  return (
                    <tr key={c.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-3 py-3 sm:px-5">
                        <p className="font-semibold text-slate-800">{c.name}</p>
                      </td>
                      <td className="hidden px-3 py-3 sm:table-cell">
                        {c.category_name ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                            {c.category_name}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                        {c.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-slate-400" /> {c.phone}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                        {c.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-slate-400" /> {c.email}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="hidden px-3 py-3 text-right text-slate-600 sm:table-cell">{fmtMoney(c.credit_limit)}</td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-semibold ${bal > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {fmtMoney(bal)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right sm:px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(c)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setToDelete(c)}
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

          <div className="divide-y divide-slate-50 sm:hidden">
            {pageRows.map((c) => {
              const bal = Number(c.balance) || 0;
              return (
                <div key={c.id} className="flex flex-col gap-3 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-slate-800">{c.name}</p>
                        {c.category_name && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            {c.category_name}
                          </span>
                        )}
                      </div>
                      {(c.phone || c.email) && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          {c.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3 text-slate-400" /> {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <Mail className="h-3 w-3 shrink-0 text-slate-400" />
                              <span className="truncate">{c.email}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setToDelete(c)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-50 pt-2.5 text-xs">
                    <span className="text-slate-500">Balance</span>
                    <span className={`font-semibold ${bal > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {fmtMoney(bal)}
                    </span>
                  </div>
                  {Number(c.credit_limit) > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Credit limit</span>
                      <span className="font-semibold text-slate-700">{fmtMoney(c.credit_limit)}</span>
                    </div>
                  )}
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
        title={editing ? "Edit Customer" : "Add Customer"}
        subtitle="Customer details and credit limit"
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="Customer name"
            />
          </Field>
          <Field label="Category" hint="e.g. Retailer, Hotel, Caterer — used for custom per-category prices">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <SearchableSelect
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  options={[{ value: "", label: "None" }, ...cats.map((c) => ({ value: String(c.id), label: c.name }))]}
                  placeholder="Select category"
                  searchPlaceholder="Search categories..."
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0300-1234567"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@example.com"
              />
            </Field>
          </div>
          <Field label="Address">
            <Textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Full address…"
            />
          </Field>
          <Field label="Credit limit">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.credit_limit}
              onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
              placeholder="0"
            />
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Customer" : "Add Customer"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete customer?"
        message={`"${toDelete?.name}" will be permanently removed. Sales linked to this customer will become walk-in.`}
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