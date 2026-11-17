import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Upload,
  Download,
  Trash2,
  Search,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import { fmtDate } from "../lib/format.js";
import { useFormDraft, useDraftReopen } from "../lib/formDraft.js";
import { DOCUMENT_CATEGORIES, fmtFileSize } from "../lib/employees.js";

const SELECT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

const MAX_BYTES = 10 * 1024 * 1024;

const CATEGORY_STYLE = {
  "ID Proof": "bg-sky-50 text-sky-700",
  "Address Proof": "bg-amber-50 text-amber-700",
  Contract: "bg-violet-50 text-violet-700",
  "Bank Details": "bg-emerald-50 text-emerald-700",
  Qualification: "bg-indigo-50 text-indigo-700",
  Photo: "bg-pink-50 text-pink-700",
  Other: "bg-slate-100 text-slate-600"
};

function fileExtension(doc) {
  const path = String(doc.file_path || "");
  const fromPath = path.includes(".") ? path.split(".").pop() : "";
  return (fromPath || "").toLowerCase();
}

function fileKind(doc) {
  const type = String(doc.file_type || "").toLowerCase();
  const ext = fileExtension(doc);
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["pdf", "doc", "docx", "txt"].includes(ext) || type.includes("pdf")) return "text";
  return "file";
}

function downloadName(doc) {
  const base = String(doc.label || "document").trim() || "document";
  const ext = fileExtension(doc);
  if (!ext || base.toLowerCase().endsWith(`.${ext}`)) return base;
  return `${base}.${ext}`;
}

function KindIcon({ doc, className = "h-5 w-5" }) {
  const kind = fileKind(doc);
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "sheet") return <FileSpreadsheet className={className} />;
  if (kind === "text") return <FileText className={className} />;
  return <FileIcon className={className} />;
}

export default function EmployeeDocuments() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [documents, setDocuments] = useState([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", category: "Other", label: "" });
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const draft = useFormDraft({
    key: "employee-documents:new",
    value: { form, file },
    apply: (v) => {
      if (v.form) setForm(v.form);
      setFile(v.file instanceof File ? v.file : null);
    },
    active: uploadOpen
  });


  useDraftReopen({
    prefix: "employee-documents",
    open: uploadOpen,
    onReopen: () => setUploadOpen(true)
  });

  const loadEmployees = async () => {
    try {
      const list = await api.employees();
      setEmployees(Array.isArray(list) ? list : []);
    } catch {
      /* the upload dialog explains when there is no one to attach a file to */
    }
  };

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const list = await api.employeeDocuments(employeeId || undefined);
      setDocuments(Array.isArray(list) ? list : []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      if (category && doc.category !== category) return false;
      if (!q) return true;
      return [doc.label, doc.employee_name, doc.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [documents, category, search]);

  const categoryCount = useMemo(() => {
    const set = new Set(documents.map((doc) => doc.category).filter(Boolean));
    return set.size;
  }, [documents]);

  const openUpload = () => {
    setForm({ employee_id: employeeId || employees[0]?.id || "", category: "Other", label: "" });
    setFile(null);
    setUploadOpen(true);
    setError("");
  };

  const chooseFile = (selected) => {
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size > MAX_BYTES) {
      setError("That file is larger than 10 MB. Choose a smaller document.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setError("");
    setFile(selected);
    if (!form.label) {
      const name = selected.name.includes(".")
        ? selected.name.slice(0, selected.name.lastIndexOf("."))
        : selected.name;
      setForm((prev) => ({ ...prev, label: name }));
    }
  };

  const upload = async () => {
    if (!form.employee_id) {
      setError("Choose an employee first");
      return;
    }
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    setUploading(true);
    try {
      await api.uploadEmployeeDoc(
        form.employee_id,
        file,
        form.label.trim() || file.name,
        form.category
      );
      setUploadOpen(false);
      setFile(null);
      await draft.clear();
      setToast("Document uploaded");
      await loadDocuments();
    } catch (e) {
      setError(e.message || "Could not upload document");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteEmployeeDoc(deleteTarget.id);
      setDeleteTarget(null);
      setToast("Document deleted");
      await loadDocuments();
    } catch (e) {
      setError(e.message || "Could not delete document");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <FolderOpen className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Employee documents</p>
            <p className="text-xs text-slate-500">
              ID proofs, contracts and other files kept with the employee record.
            </p>
          </div>
        </div>
        <Button onClick={openUpload} disabled={employees.length === 0}>
          <Upload className="h-4 w-4" /> Upload document
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Files</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{documents.length}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Categories in use</p>
          <p className="mt-1 text-xl font-bold text-indigo-700">{categoryCount}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Showing</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{filtered.length}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Employee">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={`${SELECT} w-52`}
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${SELECT} w-44`}>
            <option value="">All categories</option>
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <div className="relative flex-1 sm:min-w-48 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {filtered.length} of {documents.length} files
        </span>
      </div>

      {error && !uploadOpen && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError("")} className="shrink-0 font-bold">
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <FolderOpen className="h-7 w-7" />
          </div>
          <p className="mt-4 font-semibold text-slate-900">No documents found</p>
          <p className="mt-1 text-sm text-slate-500">
            {documents.length === 0
              ? "Upload the first document for an employee."
              : "Try a different employee, category or search."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((doc) => {
            const style = CATEGORY_STYLE[doc.category] || CATEGORY_STYLE.Other;
            return (
              <Card key={doc.id} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <KindIcon doc={doc} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{doc.label || "Document"}</p>
                    <p className="truncate text-[11px] text-slate-400">{doc.employee_name}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${style}`}>
                    {doc.category || "Other"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                  <span className="text-[11px] text-slate-400">
                    {fmtFileSize(doc.file_size)}
                    {doc.uploaded_at ? ` · ${fmtDate(doc.uploaded_at)}` : ""}
                  </span>
                  <div className="flex items-center gap-1">
                    <a
                      href={doc.file_path}
                      download={downloadName(doc)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                      title="Download"
                      aria-label="Download"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => setDeleteTarget(doc)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload employee document"
        subtitle="Attach a scan, contract or ID proof to an employee."
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={upload} disabled={uploading || !file}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      >
        <DraftBanner draft={draft} />
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee" required>
              <select
                value={form.employee_id || ""}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                className={SELECT}
              >
                <option value="">Select employee…</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={SELECT}
              >
                {DOCUMENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Label">
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Aadhaar card"
            />
          </Field>
          <Field label="File" required hint="PDF, image, Word, Excel or text file up to 10 MB.">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.txt,.rtf"
              onChange={(e) => chooseFile(e.target.files?.[0] || null)}
              className="block w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700"
            />
          </Field>
          {file && (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              Selected: <span className="font-semibold">{file.name}</span> · {fmtFileSize(file.size)}
            </p>
          )}
          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
          )}
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete this document?"
        subtitle={deleteTarget ? `${deleteTarget.label || "Document"} · ${deleteTarget.employee_name}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete document"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          The file is removed from the server and cannot be downloaded again.
        </p>
      </Modal>
    </div>
  );
}
