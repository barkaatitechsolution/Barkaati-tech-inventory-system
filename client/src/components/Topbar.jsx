import { Menu, Plus, Search, Zap } from "lucide-react";
import ThemeToggle from "./ThemeToggle.jsx";

export default function Topbar({
  title,
  subtitle,
  onMenu,
  onNewSale,
  onNewProduct,
  quickSearch,
  onQuickSearch,
  onSearchSubmit
}) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
        <button
          onClick={onMenu}
          className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-xl">
            {title}
          </h1>
          {subtitle && <p className="hidden truncate text-xs text-slate-500 sm:block">{subtitle}</p>}
        </div>

        <form
          className="relative hidden md:block"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={quickSearch}
            onChange={(e) => onQuickSearch(e.target.value)}
            placeholder="Search products…"
            className="w-64 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
          />
        </form>

        <button
          onClick={onNewProduct}
          className="hidden shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:flex"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden md:inline">Add Product</span>
        </button>
        <ThemeToggle />
        <button
          onClick={onNewSale}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700 active:scale-[0.98] sm:gap-2 sm:px-3.5"
        >
          <Zap className="h-4 w-4" />
          <span className="hidden sm:inline">New Sale</span>
        </button>
      </div>
    </header>
  );
}