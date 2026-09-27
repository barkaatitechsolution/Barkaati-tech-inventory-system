import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Plus, Search, Pencil, Trash2, Truck, Phone, MapPin, Building2, PackageCheck, Mail } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney } from "../lib/format.js";

const PAGE_SIZE = 18;

const EMPTY = {
  name: "",
  company_name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  detail: "",
  products_sold: ""
};

export default function Suppliers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.suppliers());
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
    if (!q) return rows;
    return rows.filter((s) =>
      [s.name, s.company_name, s.contact_person, s.phone, s.products_sold, s.address]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name || "",
      company_name: s.company_name || "",
      contact_person: s.contact_person || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      detail: s.detail || "",
      products_sold: s.products_sold || ""
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) await api.updateSupplier(editing.id, form);
      else await api.createSupplier(form);
      setOpen(false);
      setToast(editing ? "Supplier updated" : "Supplier added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteSupplier(toDelete.id);
      setToDelete(null);
      setToast("Supplier deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Supplier
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200/70" />
          ))}
        </div>
      ) : error ? (
        <Card className="text-sm text-rose-600">Failed to load suppliers: {error}</Card>
      ) : filtered.length === 0 ? (
        <Card className="py-14 text-center text-sm text-slate-500">No suppliers found.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pageRows.map((s) => {
            const products = (s.products_sold || "")
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            return (
              <Card key={s.id} className="animate-fade-up flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{s.name}</h3>
                      {s.company_name && (
                        <p className="flex items-center gap-1 text-xs text-slate-500">
                          <Building2 className="h-3 w-3" /> {s.company_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(s)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setToDelete(s)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                  {s.contact_person && <p className="font-medium text-slate-600">Contact: {s.contact_person}</p>}
                  {s.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400" /> {s.phone}
                    </p>
                  )}
                  {s.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" /> {s.email}
                    </p>
                  )}
                  {s.address && (
                    <p className="flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {s.address}
                    </p>
                  )}
                </div>

                {s.detail && <p className="mt-2 line-clamp-2 text-xs text-slate-400">{s.detail}</p>}

                {products.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {products.slice(0, 3).map((p) => (
                      <span key={p} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                        {p}
                      </span>
                    ))}
                    {products.length > 3 && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        +{products.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <PackageCheck className="h-3.5 w-3.5" /> {s.purchase_count} purchase{s.purchase_count === 1 ? "" : "s"}
                  </span>
                  <span className="font-semibold text-slate-600">{fmtMoney(s.purchase_total)}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <Card className="!p-0">
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Supplier" : "Add Supplier"}
        subtitle="Contact details, company and the products they supply"
        wide
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Al-Noor Trading Co." />
            </Field>
            <Field label="Company name">
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="e.g. Al-Noor Trading (Pvt) Ltd" />
            </Field>
            <Field label="Contact person">
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="Full name" />
            </Field>
            <Field label="Contact no">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
            </Field>
            <Field label="Address">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Shop / street / area" />
            </Field>
          </div>
          <Field label="Detail">
            <Textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="Payment terms, delivery notes, history…" />
          </Field>
          <Field label="Product sells" hint="Comma separated list of products this supplier provides">
            <Textarea value={form.products_sold} onChange={(e) => setForm({ ...form, products_sold: e.target.value })} placeholder="Rice, flour, cooking oil, sugar" />
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Supplier" : "Add Supplier"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete supplier?"
        message={`"${toDelete?.name}" will be removed. Existing purchase records stay but lose the supplier link.`}
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