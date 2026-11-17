import { useMemo, useState } from "react";
import { CheckCircle2, ReceiptText, Search, Share2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { shareText } from "../lib/share.js";
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner, showToast } from "../components/ui.jsx";

export default function CompletedBills() {
  const { version } = useApp();
  const bills = useAsync(() => api.completedCustomerBills(), [version]);
  const [search, setSearch] = useState("");

  const rows = bills.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.invoice_no, r.customer_name, r.customer_phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);
  const total = rows.reduce((n, r) => n + (Number(r.total) || 0), 0);

  const share = async (row) => {
    try {
      const full = await api.sale(row.id);
      const items = (full?.items || []).map((it) => `• ${it.product_name} × ${it.qty} = ${fmtMoney(it.line_total)}`).join("\n");
      const text = [
        `*Bill ${row.invoice_no}*`,
        row.customer_name ? `Customer: ${row.customer_name}` : "",
        fmtDate(row.created_at),
        "",
        items,
        "",
        `Total: ${fmtMoney(row.total)}`,
        `Paid: ${fmtMoney(row.paid)}`
      ].filter(Boolean).join("\n");
      await shareText({ title: `Bill ${row.invoice_no}`, text });
    } catch (e) {
      showToast(e?.message || "Could not share bill", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Completed bills" subtitle={`${rows.length} bills · ${fmtMoney(total)} settled`} />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search completed bills" />
        </div>

        {bills.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : bills.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{bills.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => (
              <Card key={r.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{r.invoice_no}</p>
                    <p className="truncate text-[11px] text-slate-400">{r.customer_name || "Walk-in"} · {fmtDate(r.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{fmtMoney(r.total)}</p>
                    <Badge tone="green">paid</Badge>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => share(r)}><Share2 className="h-3.5 w-3.5" /> Share</Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={ReceiptText} title="No completed bills" description="Fully paid bills will show up here." />
        )}
      </div>
    </div>
  );
}
