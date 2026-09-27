import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import {
  FolderOpen,
  Plus,
  Search,
  Pencil,
  Trash2,
  Upload,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File
} from "lucide-react";
import { api } from "../api.js";
import { fmtDateTime } from "../lib/format.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 15;

const CATEGORIES = [
  { value: "Taxation", label: "Taxation" },
  { value: "License & Registration", label: "License & Registration" },
  { value: "Insurance", label: "Insurance" },
  { value: "Bank & Finance", label: "Bank & Finance" },
  { value: "Purchase Invoices", label: "Purchase Invoices" },
  { value: "Sales & Clients", label: "Sales & Clients" },
  { value: "Warranty & Repair", label: "Warranty & Repair" },
  { value: "Employee Records", label: "Employee Records" },
  { value: "Property & Rental", label: "Property & Rental" },
  { value: "Other", label: "Other" }
];

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/bmp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/rtf";

const EMPTY_FORM = () => ({
  name: "",
  category: "Other",
  notes: "",
  file: null
});

const fmtSize = (bytes) => {
  const b = Number(bytes) || 0;
  if (b <= 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const typeOf = (d) => {
  const t = d.file_type || "";
  const p = d.file_path || "";
  if (t.startsWith("image/")) return { label: "Image", color: "bg-violet-50 text-violet-700", icon: ImageIcon };
  if (t.includes("pdf") || p.endsWith(".pdf")) return { label: "PDF", color: "bg-rose-50 text-rose-700", icon: FileText };
  if (t.includes("excel") || t.includes("spreadsheet") || /\.(xls|xlsx|csv)$/i.test(p))
    return { label: "Spreadsheet", color: "bg-emerald-50 text-emerald-700", icon: FileSpreadsheet };
  if (t.includes("word") || /\.(doc|docx|rtf)$/i.test(p))
    return { label: "Word", color: "bg-sky-50 text-sky-700", icon: FileText };
  if (t.startsWith("text/") || p.endsWith(".txt")) return { label: "Text", color: "bg-slate-100 text-slate-600", icon: File };
  return { label: "File", color: "bg-slate-100 text-slate-600", icon: File };
};

export default function BusinessDocs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [catFilter, setCatFilter] = useState("");
  const [cats, setCats] = useState([]);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSaving, setNewCatSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const [docs, catRows] = await Promise.all([api.businessDocuments(), api.businessDocumentCategories()]);
      setRows(docs);
      setCats(catRows || []);
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
    return rows.filter((d) => {
      const ty = typeOf(d);
      const matchesQuery =
        !q || [d.name, d.category, ty.label, d.notes].filter(Boolean).some((v) => v.toLowerCase().includes(q));
      const matchesCat = !catFilter || d.category === catFilter;
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
    const s = { total: rows.length, images: 0, pdf: 0, other: 0, size: 0 };
    rows.forEach((d) => {
      const ty = typeOf(d).label;
      if (ty === "Image") s.images += 1;
      else if (ty === "PDF") s.pdf += 1;
      else s.other += 1;
      s.size += Number(d.file_size) || 0;
    });
    return s;
  }, [rows]);

  const catOptions = useMemo(() => {
    const map = new Map();
    const push = (name) => {
      const n = String(name || "").trim();
      if (n && !map.has(n)) map.set(n, { value: n, label: n });
    };
    CATEGORIES.forEach((o) => push(o.value));
    cats.forEach((c) => push(c.name));
    rows.forEach((d) => push(d.category));
    return [...map.values()];
  }, [cats, rows]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setFormError(`File is too large — maximum is 15MB (yours is ${fmtSize(file.size)})`);
      return;
    }
    // Keep the File as-is. Reading it as a base64 data URL first would block the
    // main thread and inflate the payload by ~33% before it is even sent.
    const isImage = (file.type || "").startsWith("image/");
    setForm((f) => ({
      ...f,
      file: {
        name: file.name,
        size: file.size,
        type: file.type,
        raw: file,
        previewUrl: isImage ? URL.createObjectURL(file) : null
      }
    }));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM());
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (d) => {
    setEditing(d);
    setForm({
      name: d.name || "",
      category: d.category || "Other",
      notes: d.notes || "",
      file: null
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Enter a document name");
      return;
    }
    if (!editing && !form.file) {
      setFormError("Choose a file to upload");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      // Upload the bytes first, then reference the stored path in the metadata call.
      let filePath = null;
      let fileType = null;
      if (form.file?.raw) {
        const uploaded = await api.uploadBusinessDocumentFile(form.file.raw);
        filePath = uploaded.file_path;
        fileType = uploaded.file_type;
      }
      const payload = {
        name: form.name.trim(),
        category: form.category,
        notes: form.notes.trim() || null,
        file: filePath,
        file_type: fileType
      };
      if (editing) await api.updateBusinessDocument(editing.id, payload);
      else await api.createBusinessDocument(payload);
      setOpen(false);
      setToast(editing ? "Document updated" : "Document uploaded");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createCat = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setNewCatSaving(true);
    setFormError(null);
    try {
      await api.createBusinessDocumentCategory({ name });
      setCats(await api.businessDocumentCategories());
      setForm({ ...form, category: name });
      setNewCatOpen(false);
      setNewCatName("");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setNewCatSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteBusinessDocument(toDelete.id);
      setToDelete(null);
      setToast("Document deleted");
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
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total docs</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{stats.total}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Images</p>
          <p className="mt-1 text-xl font-bold text-violet-600">{stats.images}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">PDFs</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{stats.pdf}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Other files</p>
          <p className="mt-1 text-xl font-bold text-slate-600">{stats.other}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total size</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{fmtSize(stats.size)}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
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
            <Plus className="h-4 w-4" /> Upload Doc
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
          <p className="p-5 text-sm text-rose-600">Failed to load documents: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <FolderOpen className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No documents yet</p>
            <p className="mt-1 text-sm text-slate-500">Store business images, PDFs and files in one safe place.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Name</th>
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3 text-right">Size</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Uploaded</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((d) => {
                    const ty = typeOf(d);
                    const Icon = ty.icon;
                    return (
                      <tr key={d.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <a
                            href={d.file_path}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2.5 font-semibold text-slate-800 hover:text-indigo-600"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="truncate">{d.name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 text-slate-300" />
                          </a>
                          {d.notes && <p className="mt-0.5 max-w-xs truncate text-[11px] text-slate-400">{d.notes}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                            {d.category}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ty.color}`}>
                            {ty.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtSize(d.file_size)}</td>
                        <td className="hidden px-3 py-3 text-slate-500 sm:table-cell">{fmtDateTime(d.uploaded_at)}</td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-0.5">
                            <a
                              href={d.file_path}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                              title="Open"
                              aria-label="Open"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <button
                              onClick={() => openEdit(d)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                              aria-label="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setToDelete(d)}
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
              {pageRows.map((d) => {
                const ty = typeOf(d);
                const Icon = ty.icon;
                return (
                  <div key={d.id} className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-5 w-5 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <a href={d.file_path} target="_blank" rel="noreferrer" className="block truncate font-semibold text-slate-800 hover:text-indigo-600">
                          {d.name}
                        </a>
                        <p className="truncate text-[11px] text-slate-400">
                          {d.category} · {ty.label} · {fmtSize(d.file_size)}
                        </p>
                      </div>
                      <p className="shrink-0 text-[11px] text-slate-400">{fmtDateTime(d.uploaded_at)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-0.5">
                      <a
                        href={d.file_path}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Open"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => openEdit(d)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setToDelete(d)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
        title={editing ? "Edit Document" : "Upload Document"}
        subtitle="Images, PDFs, Word or Excel files"
      >
        <form onSubmit={save} className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFile}
            className="hidden"
          />
          <Field label="File" required={!editing}>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> {form.file ? "Change file" : editing ? "Replace file (optional)" : "Choose file"}
              </Button>
              {form.file && (
                <span className="text-xs text-slate-600">
                  {form.file.name} <span className="text-slate-400">({fmtSize(form.file.size)})</span>
                </span>
              )}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Document name" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="e.g. GST registration certificate"
              />
            </Field>
            <Field label="Category">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <SearchableSelect
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    options={catOptions}
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
              {saving ? "Saving…" : editing ? "Update Document" : "Upload Document"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete document?"
        message={`"${toDelete?.name}" will be permanently removed.`}
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