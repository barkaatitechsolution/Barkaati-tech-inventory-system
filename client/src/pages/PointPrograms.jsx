import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Coins,
  Sparkles,
  CalendarDays,
  Gift,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { fmtMoney, fmtDate, fmtDateTime } from "../lib/format.js";

const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const EMPTY_PROGRAM = {
  name: "",
  earn_per: "100",
  point_value: "1",
  starts_on: localDate(),
  ends_on: "",
  active: true,
  notes: ""
};

const statusOf = (program) => {
  const today = localDate();
  if (!program.active) return { label: "Inactive", cls: "bg-slate-100 text-slate-500" };
  if (program.starts_on && today < program.starts_on) {
    return { label: "Upcoming", cls: "bg-amber-50 text-amber-700" };
  }
  if (program.ends_on && today > program.ends_on) {
    return { label: "Ended", cls: "bg-slate-100 text-slate-500" };
  }
  return { label: "Active", cls: "bg-emerald-50 text-emerald-700" };
};

const fmtRate = (value) =>
  `Rs ${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 4 })}`;

const pointsFor = (spend, earnPer) => {
  const per = Number(earnPer) || 0;
  const n = Number(spend) || 0;
  return per > 0 && n > 0 ? Math.floor(n / per) : 0;
};

export default function PointPrograms() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_PROGRAM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.pointPrograms();
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const programs = data?.programs || [];
  const summary = data?.summary || {};
  const recent = data?.recent || [];

  const preview = useMemo(() => {
    const earnPer = Number(form.earn_per) || 0;
    const value = Number(form.point_value) || 0;
    const sample = 1000;
    const points = pointsFor(sample, earnPer);
    return { sample, points, worth: Math.round(points * value * 100) / 100 };
  }, [form.earn_per, form.point_value]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_PROGRAM, starts_on: localDate() });
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (program) => {
    setEditing(program);
    setForm({
      name: program.name || "",
      earn_per: String(program.earn_per ?? ""),
      point_value: String(program.point_value ?? ""),
      starts_on: program.starts_on || "",
      ends_on: program.ends_on || "",
      active: Boolean(program.active),
      notes: program.notes || ""
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        ...form,
        earn_per: Number(form.earn_per),
        point_value: Number(form.point_value),
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null
      };
      if (editing) await api.updatePointProgram(editing.id, payload);
      else await api.createPointProgram(payload);
      setOpen(false);
      setToast(editing ? "Programme updated" : "Programme created");
      await load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await api.deletePointProgram(toDelete.id);
      setToDelete(null);
      setToast("Programme deleted");
      await load();
    } catch (e) {
      setToast(e.message);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="h-24 animate-pulse bg-slate-50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Loyalty programmes</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Set how customers earn points and what those points are worth at billing.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> New programme
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Points outstanding</p>
              <p className="text-lg font-bold text-slate-800">
                {Number(summary.outstanding_points || 0).toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-slate-400">
                {Number(summary.legacy_points || 0).toLocaleString("en-IN")} legacy
              </p>
            </div>
          </div>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Redeemable value</p>
              <p className="text-lg font-bold text-slate-800">{fmtMoney(summary.redeemable_value || 0)}</p>
              <p className="text-[11px] text-slate-400">
                Legacy worth {fmtMoney(summary.legacy_value || 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Points earned</p>
              <p className="text-lg font-bold text-slate-800">
                {Number(summary.earned_points || 0).toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-slate-400">All programmes</p>
            </div>
          </div>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Points redeemed</p>
              <p className="text-lg font-bold text-slate-800">{fmtMoney(summary.redeemed_value || 0)}</p>
              <p className="text-[11px] text-slate-400">
                {Number(summary.redeemed_points || 0).toLocaleString("en-IN")} points used
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {programs.map((program) => {
          const status = statusOf(program);
          return (
            <Card key={program.id} className="!p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-bold text-slate-900">{program.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {fmtRate(program.earn_per)} spent earns 1 point · 1 point is worth{" "}
                    {fmtRate(program.point_value)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(program)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Edit ${program.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setToDelete(program)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Delete ${program.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase text-slate-400">Runs from</p>
                  <p className="mt-0.5 font-semibold text-slate-700">
                    {program.starts_on ? fmtDate(program.starts_on) : "Any time"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase text-slate-400">Runs until</p>
                  <p className="mt-0.5 font-semibold text-slate-700">
                    {program.ends_on ? fmtDate(program.ends_on) : "No end date"}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Coins className="h-3.5 w-3.5" />
                  {Number(program.points_outstanding || 0).toLocaleString("en-IN")} points outstanding
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {Number(program.lot_count || 0)} point lot{Number(program.lot_count) === 1 ? "" : "s"}
                </span>
              </div>

              {program.notes && (
                <p className="mt-3 rounded-xl bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">
                  {program.notes}
                </p>
              )}
            </Card>
          );
        })}

        {programs.length === 0 && (
          <Card className="lg:col-span-2">
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Coins className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">No loyalty programme yet</p>
              <p className="max-w-md text-xs text-slate-500">
                Create one to start awarding points on bills. Existing customer balances keep their
                current value at Rs 1 per point.
              </p>
              <Button className="mt-2" onClick={openNew}>
                <Plus className="h-4 w-4" /> Create programme
              </Button>
            </div>
          </Card>
        )}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Recent point activity</h3>
            <p className="mt-0.5 text-xs text-slate-500">The last 25 earning and redemption entries.</p>
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
            No point activity yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {recent.map((row) => {
              const positive = Number(row.change) > 0;
              return (
                <div key={row.id} className="flex items-center gap-3 py-2.5">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    }`}
                  >
                    {positive ? (
                      <ArrowDownLeft className="h-4 w-4" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">
                      {row.customer_name}
                      <span className={`ml-2 font-bold ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                        {positive ? "+" : ""}
                        {Number(row.change).toLocaleString("en-IN")}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {row.reason || row.kind || "Points update"}
                      {row.program_name ? ` · ${row.program_name}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-semibold text-slate-700">
                      {Number(row.balance).toLocaleString("en-IN")} pts
                    </p>
                    <p className="text-[10px] text-slate-400">{fmtDateTime(row.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit loyalty programme" : "New loyalty programme"}
        subtitle="Only one programme can be active on any given day."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="point-program-form" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update programme" : "Create programme"}
            </Button>
          </>
        }
      >
        <form id="point-program-form" onSubmit={save} className="space-y-4">
          {formError && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>
          )}

          <Field label="Programme name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Festival Double Points"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Earn rate" hint="Rupees the customer must spend to earn one point." required>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Rs</span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.earn_per}
                  onChange={(e) => setForm({ ...form, earn_per: e.target.value })}
                  required
                />
                <span className="whitespace-nowrap text-xs text-slate-500">= 1 pt</span>
              </div>
            </Field>
            <Field label="Point value" hint="Rupees taken off the bill for each point redeemed." required>
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-xs font-semibold text-slate-500">1 pt =</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.point_value}
                  onChange={(e) => setForm({ ...form, point_value: e.target.value })}
                  required
                />
                <span className="text-xs text-slate-500">Rs</span>
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts on" hint="Leave blank to start immediately.">
              <Input
                type="date"
                value={form.starts_on}
                onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
              />
            </Field>
            <Field label="Ends on" hint="Leave blank to run until you stop it.">
              <Input
                type="date"
                value={form.ends_on}
                onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
              />
            </Field>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-700">
              Enable this programme
              <span className="block text-[11px] text-slate-400">
                Disabled programmes stop earning points but existing points stay redeemable.
              </span>
            </span>
          </label>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional note shown on the programme card"
            />
          </Field>

          <div className="rounded-xl bg-indigo-50/70 px-4 py-3 text-xs text-indigo-900">
            <p className="font-semibold">Preview</p>
            <p className="mt-1">
              A {fmtMoney(preview.sample)} bill earns{" "}
              <strong>{preview.points.toLocaleString("en-IN")}</strong> points, worth{" "}
              <strong>{fmtRate(preview.worth)}</strong> when redeemed.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Points are earned on the final amount after all discounts, including points already
              redeemed. Changing a programme never changes the value of points already earned.
            </span>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete programme?"
        message={
          toDelete
            ? `"${toDelete.name}" will be removed. Points already earned keep their value, but no new points will be earned at this rate.`
            : ""
        }
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
