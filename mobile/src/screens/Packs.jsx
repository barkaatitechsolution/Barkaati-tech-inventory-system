import { useEffect, useMemo, useState } from "react";
import { Boxes, Pencil, Search } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  showToast
} from "../components/ui.jsx";

export default function Packs() {
  const { version, bump } = useApp();
  const packs = useAsync(() => api.productPacks(), [version]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [remaining, setRemaining] = useState("");
  const [status, setStatus] = useState("open");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setRemaining(String(editing.remaining ?? ""));
      setStatus(editing.status || "open");
    }
  }, [editing]);

  const data = packs.data || { packs: [], stats: {} };
  const rows = data.packs || [];
  const stats = data.stats || {};
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.product_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, filter]);

  const save = async () => {
    if (!editing) return;
    const value = Number(remaining);
    if (!Number.isFinite(value) || value < 0) return showToast("Enter a valid remaining quantity", "error");
    setSaving(true);
    try {
      await api.updateProductPack(editing.id, { remaining: value, status });
      showToast("Pack updated");
      setEditing(null);
      bump();
      packs.reload();
    } catch (e) {
      showToast(e?.message || "Could not update pack", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Inventory packs" subtitle={`${stats.total_packs || rows.length} packs · ${stats.total_stock_qty || 0} units left`} />

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Open packs</p>
            <p className="mt-0.5 text-lg font-bold text-emerald-600">{stats.open_packs || 0}</p>
          </Card>
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Units remaining</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{stats.total_stock_qty || 0}</p>
          </Card>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search packs" />
        </div>

        <div className="flex gap-2">
          {["all", "open", "empty"].map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm"}`}>
              {f}
            </button>
          ))}
        </div>

        {packs.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => {
              const qty = Number(r.qty) || 0;
              const left = Number(r.remaining) || 0;
              return (
                <Card key={r.id} className="flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
                    <Boxes className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{r.product_name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {left} / {qty} left · {fmtMoney(r.unit_cost)} each · {fmtDate(r.created_at)}
                    </p>
                  </div>
                  <Badge tone={r.status === "open" ? "green" : "slate"}>{r.status}</Badge>
                  <IconButton onClick={() => setEditing(r)} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty icon={Boxes} title="No packs" description="Packs are created when you purchase stock with pack quantities." />
        )}
      </div>

      <Modal open={!!editing} title={editing?.product_name || "Pack"} onClose={() => setEditing(null)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save pack</Button>}>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="text-slate-500">Pack quantity</p>
            <p className="text-lg font-bold text-slate-900">{editing?.qty} units</p>
          </div>
          <Field label="Remaining units"><Input value={remaining} onChange={(e) => setRemaining(e.target.value)} inputMode="decimal" autoFocus /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">open</option>
              <option value="empty">empty</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
