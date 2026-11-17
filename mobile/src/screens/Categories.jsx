import { useEffect, useMemo, useState } from "react";
import { FolderTree, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { Badge, Button, Card, Confirm, Empty, Field, IconButton, Input, Modal, PageHeader, Spinner, showToast } from "../components/ui.jsx";

const blank = () => ({ name: "", subcategories: "" });

export default function Categories() {
  const { version, bump } = useApp();
  const categories = useAsync(() => api.categories(), [version]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(editing ? {
        name: editing.name || "",
        subcategories: (editing.subcategories || []).map((s) => s.name).join(", ")
      } : blank());
    }
  }, [open, editing]);

  const rows = categories.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => [c.name, ...(c.subcategories || []).map((s) => s.name)].some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const save = async () => {
    if (!form.name.trim()) return showToast("Enter a category name", "error");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        subcategories: form.subcategories.split(",").map((s) => s.trim()).filter(Boolean)
      };
      if (editing) await api.updateCategory(editing.id, payload);
      else await api.createCategory(payload);
      showToast(editing ? "Category updated" : "Category added");
      setOpen(false);
      bump();
      categories.reload();
    } catch (e) {
      showToast(e?.message || "Could not save category", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteCategory(deleting.id);
      showToast("Category deleted");
      setDeleting(null);
      bump();
      categories.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Categories" subtitle={`${rows.length} categories`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>} />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories" />
        </div>

        {categories.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((c) => (
              <Card key={c.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <FolderTree className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{c.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{(c.subcategories || []).length} subcategories</p>
                  </div>
                  <IconButton onClick={() => { setEditing(c); setOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton onClick={() => setDeleting(c)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
                {c.subcategories?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.subcategories.map((s) => <Badge key={s.id} tone="slate">{s.name}</Badge>)}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={FolderTree} title="No categories" description="Group products into categories and subcategories."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add category</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit category" : "Add category"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save category</Button>}>
        <div className="space-y-3">
          <Field label="Category name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
          <Field label="Subcategories" hint="Separate with commas"><Input value={form.subcategories} onChange={(e) => setForm((f) => ({ ...f, subcategories: e.target.value }))} placeholder="e.g. T-shirts, Jeans, Shirts" /></Field>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete category?" message="Products in this category will become uncategorised."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
