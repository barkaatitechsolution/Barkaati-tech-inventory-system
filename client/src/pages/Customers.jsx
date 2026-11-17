import { useEffect, useRef, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Plus, Search, Users, Pencil, Trash2, Phone, Mail, HandCoins, Award, Printer, Barcode, IdCard } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDateTime } from "../lib/format.js";
import { printCustomerCardsOnLaptop } from "../lib/printRemote.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { useFormDraft, useDraftReopen } from "../lib/formDraft.js";

const PAGE_SIZE = 20;

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  address: "",
  credit_limit: "",
  category_id: "",
  card_no: ""
};

export default function Customers({ onCollect }) {
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
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, withBalance: 0, totalBalance: 0, totalPoints: 0 });
  const loadToken = useRef(0);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSaving, setNewCatSaving] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const [pointsCustomer, setPointsCustomer] = useState(null);
  const [pointsData, setPointsData] = useState(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState(null);
  const [adjustChange, setAdjustChange] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const draft = useFormDraft({
    key: `customers:${editing ? `edit:${editing.id}` : "new"}`,
    value: { form, editing, newCatOpen, newCatName },
    apply: (v) => {
      if (v.form) setForm(v.form);
      if (v.editing !== undefined) setEditing(v.editing);
      setNewCatOpen(!!v.newCatOpen);
      setNewCatName(v.newCatName || "");
    },
    active: open
  });

  useDraftReopen({
    prefix: "customers",
    open,
    session: editing?.id ?? null,
    onReopen: (id) => {
      setEditing(id ? { id } : null);
      setOpen(true);
    }
  });

  const loadCats = async () => {
    try {
      setCats(await api.customerCategories());
    } catch (e) {
      setError(e.message);
    }
  };

  const load = async () => {
    const token = ++loadToken.current;
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
      if (catFilter) params.category_id = catFilter;
      const data = await api.customersPaged(params);
      if (token !== loadToken.current) return;
      setRows(data.rows || []);
      setTotal(Number(data.total) || 0);
      setStats(data.summary || { total: 0, withBalance: 0, totalBalance: 0, totalPoints: 0 });
      setError(null);
    } catch (e) {
      if (token === loadToken.current) setError(e.message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadCats();
  }, []);

  useEffect(() => {
    load();
  }, [page, debouncedSearch, catFilter]);

  useEffect(() => () => {
    loadToken.current += 1;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, catFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
      category_id: c.category_id ?? "",
      card_no: c.card_no || ""
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
    const cardNo = form.card_no.trim();
    if (cardNo && !/^(\d{4}|\d{6})$/.test(cardNo)) {
      setFormError("Card number must be exactly 4 or 6 digits");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      credit_limit: Number(form.credit_limit) || 0,
      category_id: form.category_id ? Number(form.category_id) : null,
      card_no: cardNo || null
    };
    try {
      let res;
      if (editing) res = await api.updateCustomer(editing.id, payload);
      else res = await api.createCustomer(payload);
      setOpen(false);
      await draft.clear();
      setToast(
        editing
          ? "Customer updated"
          : res?.card_no
            ? `Customer added · Card ${res.card_no}`
            : res?.barcode
              ? `Customer added · Barcode ${res.barcode}`
              : "Customer added"
      );
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

  const openPoints = async (c) => {
    setPointsCustomer(c);
    setPointsData(null);
    setPointsError(null);
    setAdjustChange("");
    setAdjustReason("");
    setPointsLoading(true);
    try {
      const data = await api.customerPoints(c.id);
      setPointsData(data);
    } catch (err) {
      setPointsError(err.message);
    } finally {
      setPointsLoading(false);
    }
  };

  const closePoints = () => {
    setPointsCustomer(null);
    setPointsData(null);
    setPointsError(null);
  };

  const submitAdjust = async (e) => {
    e.preventDefault();
    const change = Math.trunc(Number(adjustChange));
    if (!pointsCustomer || !Number.isFinite(change) || change === 0) {
      setPointsError("Enter a non-zero whole number of points");
      return;
    }
    setAdjusting(true);
    setPointsError(null);
    try {
      await api.adjustCustomerPoints(pointsCustomer.id, {
        change,
        reason: adjustReason.trim()
      });
      setAdjustChange("");
      setAdjustReason("");
      const data = await api.customerPoints(pointsCustomer.id);
      setPointsData(data);
      setToast(`Points ${change > 0 ? "added" : "removed"} · ${data.points} total`);
      await load();
    } catch (err) {
      setPointsError(err.message);
    } finally {
      setAdjusting(false);
    }
  };

  const fetchAllFiltered = async () => {
    const all = [];
    let matching = 0;
    for (let p = 1; p <= 20; p += 1) {
      const params = { page: p, limit: 500 };
      if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
      if (catFilter) params.category_id = catFilter;
      const data = await api.customersPaged(params);
      const batch = data.rows || [];
      matching = Number(data.total) || 0;
      all.push(...batch);
      if (all.length >= matching || batch.length === 0) break;
    }
    return { rows: all, total: matching };
  };

  const printCards = async (single) => {
    setLabelBusy(true);
    try {
      let list = single ? [single] : [];
      let matching = list.length;
      if (!single) {
        const result = await fetchAllFiltered();
        list = result.rows;
        matching = result.total;
      }
      list = list.filter((c) => c.barcode);
      if (!list.length) {
        setToast("No customer cards to print");
        return;
      }
      setToast(single ? "Sending card to the printer…" : `Sending ${list.length} cards to the printer…`);
      await printCustomerCardsOnLaptop(getStoreInfo(), list);
      setToast(
        single
          ? "Card sent to the printer"
          : matching > list.length
            ? `Sent first ${list.length} of ${matching} cards`
            : `${list.length} cards sent to the printer`
      );
    } catch (err) {
      setToast(err.message || "Could not print cards");
    } finally {
      setLabelBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total Points</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{stats.totalPoints.toLocaleString("en-US")}</p>
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
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="soft"
            onClick={() => printCards()}
            disabled={loading || labelBusy || total === 0}
          >
            <Printer className="h-4 w-4" /> {labelBusy ? "Sending…" : "Print Cards"}
          </Button>
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
        ) : total === 0 ? (
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
                  <th className="px-3 py-3 text-right">Points</th>
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
                        {c.card_no && (
                          <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-slate-600">
                            <IdCard className="h-3 w-3" /> Card {c.card_no}
                          </p>
                        )}
                        {c.barcode && (
                          <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
                            <Barcode className="h-3 w-3" /> {c.barcode}
                          </p>
                        )}
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
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                          <Award className="h-3.5 w-3.5" />
                          {(Number(c.points) || 0).toLocaleString("en-US")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-semibold ${bal > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {fmtMoney(bal)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right sm:px-5">
                        <div className="flex items-center justify-end gap-1">
                          {bal > 0 && onCollect && (
                            <button
                              onClick={() => onCollect(c.id)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                              aria-label="Collect payment"
                              title="Collect payment"
                            >
                              <HandCoins className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => printCards(c)}
                            disabled={labelBusy || !c.barcode}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                            aria-label="Print membership card"
                            title="Print membership card"
                          >
                            <IdCard className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openPoints(c)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
                            aria-label="Loyalty points"
                            title="Loyalty points"
                          >
                            <Award className="h-4 w-4" />
                          </button>
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
                      {c.card_no && (
                        <p className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-slate-600">
                          <IdCard className="h-3 w-3" /> Card {c.card_no}
                        </p>
                      )}
                      {c.barcode && (
                        <p className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
                          <Barcode className="h-3 w-3" /> {c.barcode}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {bal > 0 && onCollect && (
                        <button
                          onClick={() => onCollect(c.id)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                          aria-label="Collect payment"
                          title="Collect payment"
                        >
                          <HandCoins className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => printCards(c)}
                        disabled={labelBusy || !c.barcode}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                        aria-label="Print membership card"
                        title="Print membership card"
                      >
                        <IdCard className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openPoints(c)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
                        aria-label="Loyalty points"
                        title="Loyalty points"
                      >
                        <Award className="h-4 w-4" />
                      </button>
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
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Points</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                      <Award className="h-3.5 w-3.5" />
                      {(Number(c.points) || 0).toLocaleString("en-US")}
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

        {!loading && !error && total > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Customer" : "Add Customer"}
        subtitle="Customer details and credit limit"
      >
        <DraftBanner draft={draft} />
        <form onSubmit={save} className="space-y-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="Customer name"
            />
          </Field>
          {editing && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs">
              {editing.card_no && (
                <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-700">
                  <IdCard className="h-3.5 w-3.5 text-slate-400" /> Card {editing.card_no}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 font-mono text-slate-600">
                <Barcode className="h-3.5 w-3.5 text-slate-400" /> {editing.barcode || "—"}
              </span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600">
                <Award className="h-3.5 w-3.5" />
                {(Number(editing.points) || 0).toLocaleString("en-US")} points
              </span>
            </div>
          )}
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
          <Field
            label="Card number"
            hint="Optional 4 or 6 digits. Must be unique; printed on the membership card and accepted at billing."
          >
            <Input
              value={form.card_no}
              onChange={(e) =>
                setForm({ ...form, card_no: e.target.value.replace(/\D/g, "").slice(0, 6) })
              }
              inputMode="numeric"
              maxLength={6}
              placeholder="e.g. 1234 or 123456"
            />
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

      <Modal
        open={!!pointsCustomer}
        onClose={closePoints}
        title={`${pointsCustomer?.name || "Customer"} — Points`}
        subtitle="1 point for every Rs 100 of a bill"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/70">Points balance</p>
              <p className="mt-0.5 text-2xl font-bold text-amber-700">
                {(Number(pointsData?.points ?? pointsCustomer?.points) || 0).toLocaleString("en-US")}
              </p>
              {pointsCustomer?.card_no && (
                <p className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-amber-700/80">
                  <IdCard className="h-3 w-3" /> Card {pointsCustomer.card_no}
                </p>
              )}
              {pointsCustomer?.barcode && (
                <p className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-amber-700/70">
                  <Barcode className="h-3 w-3" /> {pointsCustomer.barcode}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="soft"
              onClick={() => printCards(pointsCustomer)}
              disabled={labelBusy || !pointsCustomer?.barcode}
            >
              <IdCard className="h-4 w-4" /> {labelBusy ? "Sending…" : "Print Membership Card"}
            </Button>
          </div>

          <form onSubmit={submitAdjust} className="space-y-3 rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-semibold text-slate-600">Adjust points</p>
            <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
              <Input
                type="number"
                step="1"
                value={adjustChange}
                onChange={(e) => setAdjustChange(e.target.value)}
                placeholder="e.g. 50 or -20"
              />
              <Input
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Reason (optional)"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">Negative numbers remove points.</p>
              <Button type="submit" disabled={adjusting}>
                {adjusting ? "Saving…" : "Apply"}
              </Button>
            </div>
          </form>

          {pointsError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{pointsError}</p>}

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">History</p>
            {pointsLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-50" />
                ))}
              </div>
            ) : !pointsData?.ledger?.length ? (
              <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                No points activity yet. Points appear here after the customer's first bill.
              </p>
            ) : (
              <div className="max-h-64 divide-y divide-slate-50 overflow-y-auto scrollbar-thin rounded-xl border border-slate-100">
                {pointsData.ledger.map((l) => {
                  const ch = Number(l.change) || 0;
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-700">
                          {l.reason || "Points change"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {fmtDateTime(l.created_at)}
                          {l.invoice_no ? ` · ${l.invoice_no}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold ${ch > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {ch > 0 ? "+" : ""}
                          {ch.toLocaleString("en-US")}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {Number(l.balance).toLocaleString("en-US")} total
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
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