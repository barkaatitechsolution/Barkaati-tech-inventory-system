import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate } from "../lib/format.js";
import { fileToBase64 } from "../lib/backup.js";
import { openUrl, shareText } from "../lib/share.js";
import { resolveFileUrl } from "../lib/files.js";
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
  showToast
} from "../components/ui.jsx";

const blank = () => ({ name: "", category: "Other", notes: "", file: "", file_type: "", file_size: 0 });

export default function BusinessDocs() {
  const { version, bump } = useApp();
  const docs = useAsync(() => api.businessDocuments(), [version]);
  const categories = useAsync(() => api.businessDocumentCategories(), [version]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) setForm(editing ? formFrom(editing) : blank());
  }, [open, editing]);

  const rows = docs.data || [];
  const cats = categories.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.name, r.category, r.notes].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      setForm((f) => ({
        ...f,
        file: `data:${file.type || "application/octet-stream"};base64,${base64}`,
        file_type: file.type || "",
        file_size: file.size || 0,
        name: f.name || file.name
      }));
    } catch {
      showToast("Could not read that file", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (!form.name.trim()) return showToast("Enter a document name", "error");
    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim() };
      if (editing) await api.updateBusinessDocument(editing.id, payload);
      else await api.createBusinessDocument(payload);
      showToast(editing ? "Document updated" : "Document saved");
      setOpen(false);
      bump();
      docs.reload();
    } catch (e) {
      showToast(e?.message || "Could not save document", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteBusinessDocument(deleting.id);
      showToast("Document deleted");
      setDeleting(null);
      bump();
      docs.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const addCategory = async () => {
    if (!catName.trim()) return;
    try {
      await api.createBusinessDocumentCategory({ name: catName.trim() });
      setCatName("");
      setCatOpen(false);
      categories.reload();
      showToast("Category added");
    } catch (e) {
      showToast(e?.message || "Could not add category", "error");
    }
  };

  const openDoc = async (r) => {
    if (!r.file_path) return showToast("No file attached", "error");
    const url = resolveFileUrl(r.file_path);
    await openUrl(url);
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Business documents"
        subtitle={`${rows.length} documents`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>}
      />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setCatOpen(true)}>Manage categories</Button>
        </div>

        {docs.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : docs.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{docs.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <FileText className="h-4 w-4" />
                  </div>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openDoc(r)}>
                    <p className="truncate text-sm font-semibold text-slate-800">{r.name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {r.category || "Other"} · {fmtDate(r.created_at)}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </button>
                  <Badge tone={r.file_path ? "green" : "slate"}>{r.file_path ? "File" : "No file"}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Button size="sm" variant="ghost" onClick={() => shareText({ title: r.name, text: r.name, url: "" })}>
                    Share
                  </Button>
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
          <Empty icon={FileText} title="No documents" description="Keep GST, licences, agreements and bills in one place."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add document</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit document" : "Add document"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save document</Button>}>
        <div className="space-y-3">
          <Field label="Document name"><Input value={form.name} onChange={set("name")} autoFocus /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={set("category")}>
              {[form.category, ...cats.map((c) => c.name)].filter((v, i, a) => v && a.indexOf(v) === i).map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
          <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
          <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> {form.file ? "Replace file" : "Attach file"}
          </Button>
          {form.file ? <p className="text-center text-[11px] text-emerald-600">File ready to save</p> : null}
          {editing?.file_path && !form.file ? <p className="text-center text-[11px] text-slate-400">Existing file will be kept</p> : null}
        </div>
      </Modal>

      <Modal open={catOpen} title="Document categories" onClose={() => setCatOpen(false)}
        footer={<Button className="w-full" onClick={addCategory}>Add category</Button>}>
        <div className="space-y-3">
          <Field label="New category"><Input value={catName} onChange={(e) => setCatName(e.target.value)} /></Field>
          <div className="space-y-1">
            {cats.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-700">{c.name}</span>
                <IconButton className="h-8 w-8 text-red-500" aria-label="Delete category"
                  onClick={async () => {
                    try { await api.deleteBusinessDocumentCategory(c.id); categories.reload(); showToast("Category deleted"); }
                    catch (e) { showToast(e?.message || "Could not delete", "error"); }
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete document?" message="The document and its file will be removed."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}

function formFrom(row) {
  return {
    name: row.name || "",
    category: row.category || "Other",
    notes: row.notes || "",
    file: "",
    file_type: row.file_type || "",
    file_size: Number(row.file_size) || 0
  };
}
