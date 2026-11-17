import { useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
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

const CONDITIONS = ["good", "fair", "needs repair", "retired"];
const blank = () => ({
  name: "",
  category: "Equipment",
  purchase_date: new Date().toISOString().slice(0, 10),
  cost: "",
  current_value: "",
  condition: "good",
  location: "",
  notes: ""
});

export default function Assets() {
  const { version, bump } = useApp();
  const assets = useAsync(() => api.assets(), [version]);
  const categories = useAsync(() => api.assetCategories(), [version]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(editing ? formFrom(editing) : blank());
  }, [open, editing]);

  const rows = assets.data || [];
  const cats = categories.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.category, r.location, r.notes].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const cost = rows.reduce((n, r) => n + (Number(r.cost) || 0), 0);
    const value = rows.reduce((n, r) => n + (Number(r.current_value) || 0), 0);
    return { cost, value, count: rows.length };
  }, [rows]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) return showToast("Enter an asset name", "error");
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        cost: Number(form.cost) || 0,
        current_value: form.current_value === "" ? Number(form.cost) || 0 : Number(form.current_value) || 0
      };
      if (editing) await api.updateAsset(editing.id, payload);
      else await api.createAsset(payload);
      showToast(editing ? "Asset updated" : "Asset added");
      setOpen(false);
      bump();
      assets.reload();
    } catch (e) {
      showToast(e?.message || "Could not save asset", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteAsset(deleting.id);
      showToast("Asset deleted");
      setDeleting(null);
      bump();
      assets.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const addCategory = async () => {
    if (!catName.trim()) return;
    setCatSaving(true);
    try {
      await api.createAssetCategory({ name: catName.trim() });
      setCatName("");
      setCatOpen(false);
      categories.reload();
      showToast("Category added");
    } catch (e) {
      showToast(e?.message || "Could not add category", "error");
    } finally {
      setCatSaving(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Assets"
        subtitle={`${totals.count} items · ${fmtMoney(totals.value)} current value`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>}
      />

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Purchase cost</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{fmtMoney(totals.cost)}</p>
          </Card>
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Current value</p>
            <p className="mt-0.5 text-lg font-bold text-emerald-600">{fmtMoney(totals.value)}</p>
          </Card>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets" />
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setCatOpen(true)}>Manage categories</Button>
        </div>

        {assets.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : assets.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{assets.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{r.name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {r.category || "Uncategorised"} · {fmtDate(r.purchase_date)}
                      {r.location ? ` · ${r.location}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{fmtMoney(r.current_value)}</p>
                    <Badge tone={r.condition === "retired" ? "red" : r.condition === "needs repair" ? "amber" : "green"}>
                      {r.condition}
                    </Badge>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[11px] text-slate-400">Bought for {fmtMoney(r.cost)}</p>
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
          <Empty icon={Building2} title="No assets yet" description="Track shop equipment, furniture and valuables."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add asset</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit asset" : "Add asset"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save asset</Button>}>
        <div className="space-y-3">
          <Field label="Asset name"><Input value={form.name} onChange={set("name")} placeholder="e.g. Display counter" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <Select value={form.category} onChange={set("category")}>
                {[form.category, ...cats.map((c) => c.name)].filter((v, i, a) => v && a.indexOf(v) === i).map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Condition">
              <Select value={form.condition} onChange={set("condition")}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Purchase cost (Rs)"><Input value={form.cost} onChange={set("cost")} inputMode="decimal" /></Field>
            <Field label="Current value (Rs)"><Input value={form.current_value} onChange={set("current_value")} inputMode="decimal" placeholder="Same as cost" /></Field>
          </div>
          <Field label="Purchase date"><Input type="date" value={form.purchase_date} onChange={set("purchase_date")} /></Field>
          <Field label="Location"><Input value={form.location} onChange={set("location")} placeholder="e.g. Main counter" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Modal open={catOpen} title="Asset categories" onClose={() => setCatOpen(false)}
        footer={<Button className="w-full" loading={catSaving} onClick={addCategory}>Add category</Button>}>
        <div className="space-y-3">
          <Field label="New category"><Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Furniture" /></Field>
          <div className="space-y-1">
            {cats.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-700">{c.name}</span>
                <IconButton className="h-8 w-8 text-red-500" aria-label="Delete category"
                  onClick={async () => {
                    try { await api.deleteAssetCategory(c.id); categories.reload(); showToast("Category deleted"); }
                    catch (e) { showToast(e?.message || "Could not delete", "error"); }
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
            {!cats.length ? <p className="text-xs text-slate-400">No categories yet.</p> : null}
          </div>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete asset?" message="This asset will be removed permanently."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}

function formFrom(row) {
  return {
    name: row.name || "",
    category: row.category || "Equipment",
    purchase_date: row.purchase_date || new Date().toISOString().slice(0, 10),
    cost: String(row.cost ?? ""),
    current_value: String(row.current_value ?? ""),
    condition: row.condition || "good",
    location: row.location || "",
    notes: row.notes || ""
  };
}
