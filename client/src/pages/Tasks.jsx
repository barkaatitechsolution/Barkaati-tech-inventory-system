import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { ClipboardList, Plus, Search, Pencil, Trash2, Play, CheckCircle2, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import { fmtDate, toDateInput } from "../lib/format.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 15;

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" }
];

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" }
];

const EMPTY_FORM = () => ({
  title: "",
  description: "",
  assigned_to: "",
  priority: "normal",
  status: "pending",
  due_date: ""
});

const priorityOf = (p) => {
  const map = {
    low: { color: "bg-slate-100 text-slate-600" },
    normal: { color: "bg-sky-50 text-sky-700" },
    high: { color: "bg-amber-50 text-amber-700" },
    urgent: { color: "bg-rose-50 text-rose-700" }
  };
  return (map[p] || map.normal).color;
};

const statusOf = (s) => {
  const map = {
    pending: { label: "Pending", color: "bg-amber-50 text-amber-700" },
    in_progress: { label: "In Progress", color: "bg-sky-50 text-sky-700" },
    completed: { label: "Completed", color: "bg-emerald-50 text-emerald-700" },
    cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-500" }
  };
  return map[s] || map.pending;
};

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const isOverdue = (r) =>
  (r.status === "pending" || r.status === "in_progress") &&
  r.due_date &&
  String(r.due_date).slice(0, 10) < todayStr();

export default function Tasks() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [tasks, emp] = await Promise.all([api.tasks(), api.employees()]);
      setRows(tasks);
      setEmployees(emp || []);
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
    return rows.filter((r) => {
      const matchesQuery =
        !q ||
        [r.title, r.description, r.employee_name, r.priority]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesStatus = !statusFilter || r.status === statusFilter;
      const matchesEmp = !employeeFilter || r.assigned_to === Number(employeeFilter);
      return matchesQuery && matchesStatus && matchesEmp;
    });
  }, [rows, debouncedSearch, statusFilter, employeeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, employeeFilter]);

  const stats = useMemo(() => {
    const counts = { pending: 0, in_progress: 0, overdue: 0, completed: 0 };
    rows.forEach((r) => {
      if (r.status === "pending" || r.status === "in_progress") {
        if (isOverdue(r)) counts.overdue += 1;
        if (r.status === "pending") counts.pending += 1;
        else counts.in_progress += 1;
      } else if (r.status === "completed") {
        counts.completed += 1;
      }
    });
    return counts;
  }, [rows]);

  const employeeOptions = employees.map((e) => ({ value: e.id, label: e.name }));
  const employeeFilterOptions = [{ value: "", label: "All employees" }, ...employeeOptions];

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM());
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      title: r.title || "",
      description: r.description || "",
      assigned_to: r.assigned_to ? String(r.assigned_to) : "",
      priority: r.priority || "normal",
      status: r.status || "pending",
      due_date: toDateInput(r.due_date)
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError("Enter a task title");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null
    };
    try {
      if (editing) await api.updateTask(editing.id, payload);
      else await api.createTask(payload);
      setOpen(false);
      setToast(editing ? "Task updated" : "Task added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (r, status) => {
    try {
      await api.updateTaskStatus(r.id, status);
      const label = { in_progress: "Task started", completed: "Task completed", pending: "Task reopened" }[status] || "Task updated";
      setToast(label);
      await load();
    } catch (err) {
      setToast(err.message);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteTask(toDelete.id);
      setToDelete(null);
      setToast("Task deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Pending</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{stats.pending}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">In Progress</p>
          <p className="mt-1 text-xl font-bold text-sky-600">{stats.in_progress}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Overdue</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{stats.overdue}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Completed</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{stats.completed}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[{ value: "", label: "All statuses" }, ...STATUSES]}
          placeholder="All statuses"
          searchPlaceholder="Search statuses..."
          className="w-full sm:w-44"
        />
        <SearchableSelect
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          options={employeeFilterOptions}
          placeholder="All employees"
          searchPlaceholder="Search employees..."
          className="w-full sm:w-48"
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Task
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
          <p className="p-5 text-sm text-rose-600">Failed to load tasks: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ClipboardList className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No tasks found</p>
            <p className="mt-1 text-sm text-slate-500">Assign a task to an employee to track its progress.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Task</th>
                    <th className="px-3 py-3">Assigned to</th>
                    <th className="px-3 py-3">Priority</th>
                    <th className="px-3 py-3">Due date</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const st = statusOf(r.status);
                    const overdue = isOverdue(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <p className="font-semibold text-slate-800">{r.title}</p>
                          {r.description && (
                            <p className="max-w-xs truncate text-[11px] text-slate-400">{r.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={r.employee_name ? "text-slate-700" : "text-slate-400"}>
                            {r.employee_name || "Unassigned"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityOf(r.priority)}`}>
                            {r.priority}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={overdue ? "font-semibold text-rose-600" : "text-slate-700"}>
                            {r.due_date ? fmtDate(r.due_date) : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.color}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-0.5">
                            {r.status === "pending" && (
                              <button
                                onClick={() => setStatus(r, "in_progress")}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                                title="Start task"
                                aria-label="Start task"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            )}
                            {(r.status === "pending" || r.status === "in_progress") && (
                              <button
                                onClick={() => setStatus(r, "completed")}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                                title="Mark complete"
                                aria-label="Mark complete"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                            )}
                            {r.status === "completed" && (
                              <button
                                onClick={() => setStatus(r, "pending")}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
                                title="Reopen"
                                aria-label="Reopen"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(r)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                              aria-label="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setToDelete(r)}
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
              {pageRows.map((r) => {
                const st = statusOf(r.status);
                const overdue = isOverdue(r);
                return (
                  <div key={r.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800">{r.title}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {r.employee_name || "Unassigned"}
                          {r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}
                          {overdue ? " · Overdue" : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityOf(r.priority)}`}>
                        {r.priority}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        {r.status === "pending" && (
                          <button
                            onClick={() => setStatus(r, "in_progress")}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                            aria-label="Start task"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                        )}
                        {(r.status === "pending" || r.status === "in_progress") && (
                          <button
                            onClick={() => setStatus(r, "completed")}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                            aria-label="Mark complete"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                        {r.status === "completed" && (
                          <button
                            onClick={() => setStatus(r, "pending")}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
                            aria-label="Reopen"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(r)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(r)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
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
        title={editing ? "Edit Task" : "Add Task"}
        subtitle="Task details, assigned employee, priority and due date"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Task title" required className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="e.g. Stock count of retail shelf"
              />
            </Field>
            <Field label="Assigned to">
              <SearchableSelect
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                options={[{ value: "", label: "Unassigned" }, ...employeeOptions]}
                placeholder="Select employee"
                searchPlaceholder="Search employees..."
              />
            </Field>
            <Field label="Priority">
              <SearchableSelect
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                options={PRIORITIES}
                placeholder="Select priority"
                searchPlaceholder="Search..."
              />
            </Field>
            <Field label="Due date">
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </Field>
            <Field label="Status">
              <SearchableSelect
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={STATUSES}
                placeholder="Select status"
                searchPlaceholder="Search..."
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What needs to be done"
              />
            </Field>
          </div>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Task" : "Add Task"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete task?"
        message={`"${toDelete?.title}" will be permanently removed.`}
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