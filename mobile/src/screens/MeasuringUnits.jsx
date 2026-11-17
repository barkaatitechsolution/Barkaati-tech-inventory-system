import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Ruler, Search, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { Badge, Button, Card, Confirm, Empty, Field, IconButton, Input, Modal, PageHeader, Select, Spinner, showToast } from "../components/ui.jsx";

const UNITS = ["count", "weight", "volume", "length", "area", "pack"];
const blank = () => ({ name: "", short_name: "", category: "count", conversion_factor: "1" });

export default function MeasuringUnits() {
  const { version, bump } = useApp();
  const units = useAsync(() => api.measuringUnits(), [version]);
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
        short_name: editing.short_name || "",
        category: editing.category || "count",
        conversion_factor: String(editing.conversion_factor ?? 1)
      } : blank());
    }
  }, [open, editing]);

  const rows = units.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => [u.name, u.short_name, u.category].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const save = async () => {
    if (!form.name.trim()) return showToast("Enter a unit name", "error");
    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), conversion_factor: Number(form.conversion_factor) || 1 };
      if (editing) await api.updateMeasuringUnit(editing.id, payload);
      else await api.createMeasuringUnit(payload);
      showToast(editing ? "Unit updated" : "Unit added");
      setOpen(false);
      bump();
      units.reload();
    } catch (e) {
      showToast(e?.message || "Could not save unit", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteMeasuringUnit(deleting.id);
      showToast("Unit deleted");
      setDeleting(null);
      bump();
      units.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Measuring units" subtitle={`${rows.length} units`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>} />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search units" />
        </div>

        {units.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((u) => (
              <Card key={u.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                  <Ruler className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{u.name}{u.short_name ? ` (${u.short_name})` : ""}</p>
                  <p className="truncate text-[11px] text-slate-400">{u.category} · factor {u.conversion_factor}</p>
                </div>
                <Badge tone="slate">{u.short_name || u.name}</Badge>
                <IconButton onClick={() => { setEditing(u); setOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton onClick={() => setDeleting(u)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Ruler} title="No units" description="Add units like kg, litre, dozen and pack."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add unit</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit unit" : "Add unit"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save unit</Button>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Unit name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus /></Field>
            <Field label="Short name"><Input value={form.short_name} onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))} placeholder="kg" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
            <Field label="Conversion factor"><Input value={form.conversion_factor} onChange={(e) => setForm((f) => ({ ...f, conversion_factor: e.target.value }))} inputMode="decimal" /></Field>
          </div>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete unit?" message="Products using this unit will keep their text unit."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
