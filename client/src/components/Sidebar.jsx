import {
  LayoutDashboard,
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
  Store
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard }]
  },
  {
    label: "Catalog",
    items: [
      { key: "categories", label: "Categories", icon: Tags },
      { key: "products", label: "Product DB", icon: Package },
      { key: "units", label: "Measuring Units", icon: Ruler }
    ]
  },
  {
    label: "Purchasing",
    items: [
      { key: "suppliers", label: "Supplier Detail", icon: Truck },
      { key: "purchases", label: "Supplier Purchased", icon: Receipt },
      { key: "packs", label: "Inventory Packs", icon: Package }
    ]
  },
  {
    label: "Sales & People",
    items: [
      { key: "sales", label: "Sales", icon: ShoppingCart },
      { key: "customers", label: "Customers", icon: Users }
    ]
  },
  {
    label: "Finance",
    items: [
      { key: "expenses", label: "Expenses", icon: Wallet },
      { key: "assets", label: "Assets", icon: Boxes }
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

export default function Sidebar({ page, onNavigate, open, onClose }) {
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
              <p className="text-[17px] font-bold tracking-tight text-white">Royal Spicy Masala</p>
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

        {/* Navigation */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = page === item.key;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        onNavigate(item.key);
                        onClose();
                      }}
                      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                        active
                          ? "bg-indigo-500/15 text-white"
                          : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400 transition-all ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <Icon className={`h-[18px] w-[18px] ${active ? "text-indigo-400" : ""}`} />
                      {item.label}
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