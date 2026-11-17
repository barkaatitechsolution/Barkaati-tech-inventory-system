import { useMemo, useState } from "react";
import { CheckCircle2, Globe, Search, XCircle } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDateTime, fmtMoney } from "../lib/format.js";
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner, cx, showToast } from "../components/ui.jsx";

const FILTERS = ["all", "unpaid", "paid", "cancelled"];

export default function OnlineOrders() {
  const { version, bump } = useApp();
  const orders = useAsync(() => api.onlineOrders(), [version]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(null);

  const rows = orders.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.invoice_no, r.online_customer_name, r.online_customer_phone, r.customer_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const confirm = async (row) => {
    setBusy(row.id);
    try {
      await api.confirmOnlineOrder(row.id, { paid: row.total, payment_method: "cash" });
      showToast("Order confirmed");
      bump();
      orders.reload();
    } catch (e) {
      showToast(e?.message || "Could not confirm order", "error");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (row) => {
    setBusy(row.id);
    try {
      await api.cancelOnlineOrder(row.id);
      showToast("Order cancelled");
      bump();
      orders.reload();
    } catch (e) {
      showToast(e?.message || "Could not cancel order", "error");
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => ({
    open: rows.filter((r) => r.status === "unpaid" || r.status === "partial").length,
    paid: rows.filter((r) => r.status === "paid").length
  }), [rows]);

  return (
    <div className="pb-24">
      <PageHeader title="Online orders" subtitle={`${counts.open} open · ${counts.paid} paid`} />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search orders" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
                filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              {f}
            </button>
          ))}
        </div>

        {orders.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : orders.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{orders.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{r.invoice_no}</p>
                      <p className="shrink-0 text-sm font-bold text-slate-900">{fmtMoney(r.total)}</p>
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {r.online_customer_name || r.customer_name || "Online customer"}{r.online_customer_phone ? ` · ${r.online_customer_phone}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {r.online_delivery_type || "delivery"}{r.online_address ? ` · ${r.online_address}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={r.status === "paid" ? "green" : r.status === "cancelled" ? "red" : "amber"}>{r.status}</Badge>
                      <span className="text-[10px] text-slate-400">{fmtDateTime(r.created_at)}</span>
                    </div>
                  </div>
                </div>
                {!["paid", "cancelled"].includes(r.status) ? (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-red-600" loading={busy === r.id} onClick={() => cancel(r)}>
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button size="sm" className="flex-1" loading={busy === r.id} onClick={() => confirm(r)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirm paid
                    </Button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Globe} title="No online orders" description="Orders placed through the online store will appear here." />
        )}
      </div>
    </div>
  );
}
