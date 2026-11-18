import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  BellRing,
  Package,
  Tags,
  Receipt,
  ShoppingCart,
  Users,
  Truck,
  Boxes,
  Wallet,
  BarChart3,
  Ruler,
  Settings,
  X,
  Store,
  CircleDollarSign,
  ShoppingBag,
  Megaphone,
  FileText,
  TicketPercent,
  Banknote,
  ClipboardList,
  FolderOpen,
  Undo2,
  Layers,
  UserRound,
  MessageSquare,
  PackageMinus,
  HandCoins,
  Coins,
  PhoneCall,
  CheckCircle2,
  CalendarDays,
  FileSpreadsheet,
  Search,
  Barcode
} from "lucide-react";
import { useStoreInfo } from "../lib/storeInfo.js";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "reminders", label: "Reminders", icon: BellRing }
    ]
  },
  {
    label: "Employees",
    items: [
      { key: "employees", label: "Employees", icon: Users },
      { key: "employeeAttendance", label: "Attendance", icon: CalendarDays },
      { key: "employeeAttendanceSheet", label: "Attendance Sheet", icon: FileSpreadsheet },
      { key: "employeePayroll", label: "Payroll", icon: Wallet },
      { key: "employeePayments", label: "Payments", icon: HandCoins },
      { key: "employeeDocuments", label: "Documents", icon: FolderOpen },
      { key: "employeeReports", label: "Reports", icon: BarChart3 }
    ]
  },
  {
    label: "Catalog",
    items: [
      { key: "categories", label: "Categories", icon: Tags },
      { key: "products", label: "Product DB", icon: Package },
      { key: "weightBarcodes", label: "Weight Barcodes", icon: Barcode },
      { key: "stock", label: "Stock Levels", icon: Layers },
      { key: "stockRemoval", label: "Stock Removal", icon: PackageMinus },
      { key: "nonSale", label: "Non-Sale Inventory", icon: Boxes },
      { key: "prices", label: "Prices", icon: CircleDollarSign },
      { key: "units", label: "Measuring Units", icon: Ruler }
    ]
  },
  {
    label: "Purchasing",
    items: [
      { key: "suppliers", label: "Supplier Detail", icon: Truck },
      { key: "purchases", label: "Supplier Purchased", icon: Receipt },
      { key: "brokers", label: "Brokers", icon: UserRound },
      { key: "packs", label: "Inventory Packs", icon: Package }
    ]
  },
  {
    label: "Sales & People",
    items: [
      { key: "onlineOrders", label: "Online Orders", icon: ShoppingBag },
      { key: "quotation", label: "Quotation Bill", icon: FileText },
      { key: "vouchers", label: "Discount Vouchers", icon: TicketPercent },
      { key: "sales", label: "Sales", icon: ShoppingCart },
      { key: "returns", label: "Returns", icon: Undo2 },
      { key: "customers", label: "Customers", icon: Users },
      { key: "pointPrograms", label: "Point Programs", icon: Coins },
      { key: "customerPayments", label: "Customer Payments", icon: HandCoins },
      { key: "completedBills", label: "Completed Bills", icon: CheckCircle2 },
      { key: "broadcast", label: "WhatsApp Broadcast", icon: Megaphone },
      { key: "broadcastSmsEmail", label: "SMS & Email", icon: MessageSquare }
    ]
  },
  {
    label: "Finance",
    items: [
      { key: "expenses", label: "Expenses", icon: Wallet },
      { key: "assets", label: "Assets", icon: Boxes },
      { key: "cheques", label: "Cheques", icon: Banknote }
    ]
  },
  {
    label: "Operations",
    items: [
      { key: "callNotes", label: "Call Back Notes", icon: PhoneCall },
      { key: "tasks", label: "Tasks", icon: ClipboardList },
      { key: "documents", label: "Business Docs", icon: FolderOpen }
    ]
  },
  {
    label: "Insights",
    items: [
      { key: "reports", label: "Reports", icon: BarChart3 },
      { key: "settings", label: "Settings", icon: Settings }
    ]
  }
];

// Extra words the sidebar search understands. They let the shop find a page
// by what it does ("bill", "salary", "udhaar") rather than by its menu name.
const SEARCH_KEYWORDS = {
  dashboard: "home overview summary today",
  reminders: "due alerts payments cheques tasks",
  employees: "staff workers team",
  employeeAttendance: "staff attendance present absent",
  employeeAttendanceSheet: "attendance register sheet staff",
  employeePayroll: "salary wages payroll staff",
  employeePayments: "salary advance staff payment",
  employeeDocuments: "staff contract id papers",
  employeeReports: "staff report attendance salary",
  categories: "category subcategory quality",
  products: "product item inventory catalogue barcode sku",
  weightBarcodes: "weight barcode label gram kg 500g 250g 1.5kg scale",
  stock: "stock inventory quantity levels",
  stockRemoval: "write off damage expired loss",
  nonSale: "packaging bags materials",
  prices: "price mrp selling market",
  units: "unit kg gram litre measure",
  suppliers: "supplier vendor company",
  purchases: "purchase buy bill supplier bill",
  brokers: "broker enquiry ask",
  packs: "pack inventory lots",
  onlineOrders: "online orders website store",
  quotation: "quote estimate bill",
  vouchers: "discount coupon voucher",
  sales: "sale bill billing invoice receipt pos",
  returns: "return refund restock",
  customers: "customer client buyer",
  pointPrograms: "loyalty points rewards programme program redeem",
  customerPayments: "payment collection receivable udhaar",
  completedBills: "completed paid bills history",
  broadcast: "whatsapp broadcast message",
  broadcastSmsEmail: "sms email broadcast message",
  expenses: "expense cost spending",
  assets: "asset equipment property",
  cheques: "cheque check bank",
  callNotes: "call notes callback phone",
  tasks: "task todo reminder",
  documents: "documents business docs licenses papers",
  reports: "report analytics profit insights",
  settings: "settings store configuration profile"
};

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
};

export default function Sidebar({ page, onNavigate, open, onClose, onOpen, onPrefetch, badges = {} }) {
  const store = useStoreInfo();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef(null);

  const focusSearch = useCallback(() => {
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    if (!desktop && !open) onOpen?.();
    window.setTimeout(() => searchRef.current?.focus(), 60);
  }, [open, onOpen]);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === "/" && !mod && !e.altKey && !isTypingTarget(document.activeElement)) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_GROUPS;
    const tokens = q.split(/\s+/).filter(Boolean);
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = `${item.label} ${group.label} ${SEARCH_KEYWORDS[item.key] || ""}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
    })).filter((group) => group.items.length > 0);
  }, [query]);

  // A flat list in on-screen order is what arrow keys walk through. The map
  // turns a key into its position without scanning on every hover.
  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const indexByKey = useMemo(
    () => new Map(flatItems.map((item, index) => [item.key, index])),
    [flatItems]
  );

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    setActiveIndex((i) => (i >= flatItems.length ? flatItems.length - 1 : i));
  }, [flatItems.length]);

  // Keep the highlighted result in view while arrowing through a long list.
  useEffect(() => {
    if (activeIndex < 0) return;
    const item = flatItems[activeIndex];
    if (!item) return;
    document.getElementById(`nav-item-${item.key}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatItems]);

  const selectItem = (key) => {
    onNavigate(key);
    setQuery("");
    setActiveIndex(-1);
    onClose();
  };

  return (
    <>
      {/* Backdrop - only visible on mobile when sidebar is open */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-slate-900 text-slate-300 transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
              <Store className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-[17px] font-bold tracking-tight text-white">{store.name}</p>
              <p className="text-xs text-slate-500">Shop Manager</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section search */}
        <div className="px-3 pb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setActiveIndex(-1);
                  e.currentTarget.blur();
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" && activeIndex >= 0) {
                  e.preventDefault();
                  const item = flatItems[activeIndex];
                  if (item) selectItem(item.key);
                }
              }}
              placeholder="Find a section…"
              aria-label="Find a section"
              autoComplete="off"
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-16 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-indigo-400/60 focus:bg-white/10 focus:ring-2 focus:ring-indigo-500/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 lg:block">
                Ctrl K
              </span>
            )}
            {query && flatItems.length > 0 && (
              <span className="pointer-events-none absolute right-9 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 lg:block">
                ↵
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {groups.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center">
              <Search className="mx-auto h-5 w-5 text-slate-600" />
              <p className="mt-2 text-sm font-medium text-slate-400">No sections found</p>
              <p className="mt-1 text-[11px] text-slate-500">Try “bill”, “stock” or “salary”.</p>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = page === item.key;
                  const highlighted = activeIndex === indexByKey.get(item.key);
                  const Icon = item.icon;
                  // Only shown for pages that pass a count; a zero means there is
                  // nothing waiting, so the badge stays hidden rather than
                  // advertising an empty list.
                  const badge = Number(badges[item.key]) || 0;
                  return (
                    <button
                      key={item.key}
                      id={`nav-item-${item.key}`}
                      onClick={() => selectItem(item.key)}
                      onPointerEnter={() => {
                        onPrefetch?.(item.key);
                        setActiveIndex(indexByKey.get(item.key) ?? -1);
                      }}
                      onFocus={() => onPrefetch?.(item.key)}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                        active
                          ? "bg-indigo-500/15 text-white"
                          : highlighted
                            ? "bg-white/10 text-white ring-1 ring-inset ring-indigo-400/40"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400 transition-all ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <Icon className={`h-[18px] w-[18px] ${active ? "text-indigo-400" : ""}`} />
                      <span className="flex-1 text-left">{item.label}</span>
                      {badge > 0 && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            active
                              ? "bg-indigo-500 text-white"
                              : "bg-rose-500/90 text-white"
                          }`}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/5 p-4">
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-dot" />
              <p className="text-xs font-semibold text-white">Local data mode</p>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Everything is stored on this device. No sign-up needed.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}