import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import {
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

export default function Expenses() {
  const { version, bump } = useApp();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState({
    category_id: "",
    amount: "",
    method: "cash",
    note: "",
    date: new Date().toISOString().slice(0, 10)
  });
  const [saving, setSaving] = useState(false);

  const expenses = useAsync(() => api.expenses(), [version]);
  const categories = useAsync(() => api.expenseCategories(), [version]);

  useEffect(() => {
    if (open) {
      setForm({
        category_id: "",
        amount: "",
        method: "cash",
        note: "",
        date: new Date().toISOString().slice(0, 10)
      });
    }
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const month = new Date().toISOString().slice(0, 7);
  const monthTotal = useMemo(
    () =>
      (expenses.data || [])
        .filter((e) => String(e.date || "").slice(0, 7) === month)
        .reduce((n, e) => n + (Number(e.amount) || 0), 0),
    [expenses.data, month]
  );

  const save = async () => {
    if (!(Number(form.amount) > 0)) return showToast("Enter an amount", "error");
    setSaving(true);
    try {
      await api.createExpense({
        ...form,
        amount: Number(form.amount),
        category_id: form.category_id || null,
        category: (categories.data || []).find((c) => String(c.id) === String(form.category_id))?.name || "Other"
      });
      showToast("Expense added");
      setOpen(false);
      bump();
      expenses.reload();
    } catch (e) {
      showToast(e?.message || "Could not save expense", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteExpense(deleting.id);
      showToast("Expense deleted");
      setDeleting(null);
      bump();
      expenses.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Expenses"
        subtitle={`This month ${fmtMoney(monthTotal)}`}
        right={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />

      <div className="px-4">
        {expenses.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : expenses.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{expenses.error}</p></Card>
        ) : expenses.data?.length ? (
          <div className="space-y-2">
            {expenses.data.map((e) => (
              <Card key={e.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <CircleDollarSign className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{e.category_name || e.category || "Other"}</p>
                  <p className="text-[11px] text-slate-400">
                    {fmtDate(e.date)} · {String(e.method || "cash").toUpperCase()}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <p className="text-sm font-bold text-slate-900">{fmtMoney(e.amount)}</p>
                <IconButton onClick={() => setDeleting(e)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            icon={CircleDollarSign}
            title="No expenses yet"
            description="Track rent, salaries and other shop costs."
            action={<Button onClick={() => setOpen(true)}>Add expense</Button>}
          />
        )}
      </div>

      <Modal
        open={open}
        title="Add expense"
        onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save expense</Button>}
      >
        <div className="space-y-3">
          <Field label="Category">
            <Select value={form.category_id} onChange={set("category_id")}>
              <option value="">Other</option>
              {(categories.data || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount (Rs)">
              <Input value={form.amount} onChange={set("amount")} inputMode="decimal" autoFocus />
            </Field>
            <Field label="Date">
              <Input type="date" value={form.date} onChange={set("date")} />
            </Field>
          </div>
          <Field label="Method">
            <Select value={form.method} onChange={set("method")}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank">Bank</option>
            </Select>
          </Field>
          <Field label="Note">
            <Textarea value={form.note} onChange={set("note")} rows={2} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title="Delete expense?"
        message="This expense will be removed from your reports."
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}
