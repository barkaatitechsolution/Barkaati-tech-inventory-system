import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate } from "../lib/format.js";
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
  cx,
  showToast
} from "../components/ui.jsx";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["pending", "in_progress", "completed", "cancelled"];
const FILTERS = ["open", "all", "completed"];
const blank = () => ({
  title: "",
  description: "",
  priority: "normal",
  due_date: "",
  status: "pending"
});

const priorityTone = { low: "slate", normal: "blue", high: "amber", urgent: "red" };

export default function Tasks() {
  const { version, bump } = useApp();
  const tasks = useAsync(() => api.tasks(), [version]);
  const [filter, setFilter] = useState("open");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) setForm(editing ? formFrom(editing) : blank());
  }, [open, editing]);

  const rows = tasks.data || [];
  const filtered = useMemo(() => {
    if (filter === "open") return rows.filter((r) => ["pending", "in_progress"].includes(r.status));
    if (filter === "completed") return rows.filter((r) => ["completed", "cancelled"].includes(r.status));
    return rows;
  }, [rows, filter]);

  const counts = useMemo(() => ({
    open: rows.filter((r) => ["pending", "in_progress"].includes(r.status)).length,
    done: rows.filter((r) => r.status === "completed").length
  }), [rows]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim()) return showToast("Enter a task title", "error");
    setSaving(true);
    try {
      const payload = { ...form, title: form.title.trim() };
      if (editing) await api.updateTask(editing.id, payload);
      else await api.createTask(payload);
      showToast(editing ? "Task updated" : "Task added");
      setOpen(false);
      bump();
      tasks.reload();
    } catch (e) {
      showToast(e?.message || "Could not save task", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row) => {
    const status = row.status === "completed" ? "pending" : "completed";
    try {
      await api.updateTaskStatus(row.id, { status });
      bump();
      tasks.reload();
    } catch (e) {
      showToast(e?.message || "Could not update", "error");
    }
  };

  const remove = async () => {
    try {
      await api.deleteTask(deleting.id);
      showToast("Task deleted");
      setDeleting(null);
      bump();
      tasks.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Tasks"
        subtitle={`${counts.open} open · ${counts.done} done`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>}
      />

      <div className="space-y-3 px-4">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cx("flex-1 rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
                filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              {f}
            </button>
          ))}
        </div>

        {tasks.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : tasks.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{tasks.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => {
              const done = ["completed", "cancelled"].includes(r.status);
              const overdue = !done && r.due_date && r.due_date < new Date().toISOString().slice(0, 10);
              return (
                <Card key={r.id} className={cx("p-3", done && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => toggle(r)} className="mt-0.5 shrink-0" aria-label="Toggle task">
                      {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cx("text-sm font-semibold text-slate-800", done && "line-through")}>{r.title}</p>
                      {r.description ? <p className="mt-0.5 text-[11px] text-slate-500">{r.description}</p> : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={priorityTone[r.priority] || "slate"}>{r.priority}</Badge>
                        <Badge tone={r.status === "completed" ? "green" : r.status === "cancelled" ? "red" : r.status === "in_progress" ? "blue" : "slate"}>
                          {r.status.replace("_", " ")}
                        </Badge>
                        {r.due_date ? (
                          <span className={cx("inline-flex items-center gap-1 text-[10px]", overdue ? "font-semibold text-red-600" : "text-slate-400")}>
                            <Clock className="h-3 w-3" /> {fmtDate(r.due_date)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton onClick={() => { setEditing(r); setOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setDeleting(r)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty icon={CheckCircle2} title="No tasks" description="Keep track of shop chores and follow-ups."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add task</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit task" : "Add task"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save task</Button>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={set("title")} autoFocus /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={set("description")} rows={2} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Priority">
              <Select value={form.priority} onChange={set("priority")}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="Due date"><Input type="date" value={form.due_date} onChange={set("due_date")} /></Field>
          </div>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete task?" message="This task will be removed."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}

function formFrom(row) {
  return {
    title: row.title || "",
    description: row.description || "",
    priority: row.priority || "normal",
    due_date: row.due_date || "",
    status: row.status || "pending"
  };
}
