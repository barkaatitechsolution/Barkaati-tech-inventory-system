import { lazy, Suspense, useState } from "react";
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
  Settings
} from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Placeholder from "./components/Placeholder.jsx";

const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Categories = lazy(() => import("./pages/Categories.jsx"));
const Products = lazy(() => import("./pages/Products.jsx"));
const Suppliers = lazy(() => import("./pages/Suppliers.jsx"));
const SupplierPurchases = lazy(() => import("./pages/SupplierPurchases.jsx"));
const Sales = lazy(() => import("./pages/Sales.jsx"));
const Customers = lazy(() => import("./pages/Customers.jsx"));
const Expenses = lazy(() => import("./pages/Expenses.jsx"));
const Assets = lazy(() => import("./pages/Assets.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const MeasuringUnits = lazy(() => import("./pages/MeasuringUnits.jsx"));
const Packs = lazy(() => import("./pages/Packs.jsx"));
const SettingsPage = lazy(() => import("./pages/Settings.jsx"));

const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "Live overview of your shop", icon: LayoutDashboard },
  categories: {
    title: "Category DB",
    subtitle: "Categories, sub categories and quality ratings",
    icon: Tags
  },
  products: {
    title: "Product DB",
    subtitle: "Items, pricing, taxes and stock levels",
    icon: Package
  },
  suppliers: {
    title: "Supplier Detail",
    subtitle: "Companies, contacts and the products they supply",
    icon: Truck
  },
  purchases: {
    title: "Supplier Purchased",
    subtitle: "Purchase bills, HSN, tax, discount and bill images",
    icon: Receipt
  },
  sales: {
    title: "Sales",
    subtitle: "Record sales, bills and payments",
    icon: ShoppingCart,
    description: "Ring up sales in seconds, generate numbered receipts, accept cash, card or credit.",
    features: ["Quick billing", "Printed receipts", "Cash / Card / Credit", "Payment status"]
  },
  customers: {
    title: "Customers",
    subtitle: "Customer ledger and outstanding balances",
    icon: Users,
    description: "Keep a tidy ledger of every customer with credit limits and balances updated automatically.",
    features: ["Customer ledger", "Credit limits", "Balance tracking", "Purchase history"]
  },
  expenses: {
    title: "Expenses",
    subtitle: "Rent, utilities, salaries and more",
    icon: Wallet,
    description: "Capture every rupee going out by category so you always know where your money is spent.",
    features: ["Expense by category", "Recurring expenses", "Cash / Bank / Card", "Monthly totals"]
  },
  assets: {
    title: "Assets",
    subtitle: "Hardware, equipment and their value",
    icon: Boxes,
    description: "Log every valuable asset — machinery, vehicles, equipment — with cost and condition.",
    features: ["Asset register", "Current value", "Condition tracking", "Location"]
  },
  reports: {
    title: "Reports",
    subtitle: "Profits, trends and printable summaries",
    icon: BarChart3,
    description: "Daily and monthly profit & loss, best sellers, slow movers — exportable and ready to print.",
    features: ["Profit & Loss", "Best sellers", "Daily / Monthly trends", "Supplier payables"]
  },
  units: {
    title: "Measuring Units",
    subtitle: "Weight, volume, length and piece units with conversions",
    icon: Ruler
  },
  packs: {
    title: "Inventory Packs",
    subtitle: "Track individual packs, remaining quantities and open/close status",
    icon: Package
  },
  settings: {
    title: "Settings",
    subtitle: "Store information used on receipts",
    icon: Settings
  }
};

const PAGES = {
  dashboard: Dashboard,
  categories: Categories,
  products: Products,
  suppliers: Suppliers,
  purchases: SupplierPurchases,
  sales: Sales,
  customers: Customers,
  expenses: Expenses,
  assets: Assets,
  reports: Reports,
  units: MeasuringUnits,
  packs: Packs,
  settings: SettingsPage
};

function PageFallback() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-56 rounded-xl bg-white/70 ring-1 ring-slate-200/70" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-white/70 ring-1 ring-slate-200/70" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-white/70 ring-1 ring-slate-200/70" />
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [quickSearch, setQuickSearch] = useState("");
  const [navSearch, setNavSearch] = useState("");
  const meta = PAGE_META[page] || PAGE_META.dashboard;
  const PageComponent = PAGES[page];

  const consumeAction = () => setAction(null);

  const submitSearch = () => {
    setNavSearch(quickSearch);
    setPage("products");
  };

  const renderPage = () => {
    if (page === "dashboard") {
      return (
        <Dashboard
          onNavigate={setPage}
          onSearchTo={(t) => {
            setNavSearch(t);
            setPage("products");
          }}
        />
      );
    }
    if (page === "products") {
      return (
        <Products
          onNavigate={setPage}
          initialSearch={navSearch}
          action={action}
          onActionConsumed={consumeAction}
        />
      );
    }
    if (page === "sales") {
      return (
        <Sales onNavigate={setPage} action={action} onActionConsumed={consumeAction} />
      );
    }
    if (PageComponent) {
      return <PageComponent onNavigate={setPage} />;
    }
    return (
      <Placeholder
        title={meta.title}
        description={meta.description}
        features={meta.features}
        icon={meta.icon}
      />
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Sidebar */}
      <Sidebar page={page} onNavigate={setPage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          onMenu={() => setSidebarOpen(true)}
          onNewSale={() => {
            setAction({ type: "sale", nonce: Date.now() });
            setPage("sales");
          }}
          onNewProduct={() => {
            setAction({ type: "product", nonce: Date.now() });
            setPage("products");
          }}
          quickSearch={quickSearch}
          onQuickSearch={setQuickSearch}
          onSearchSubmit={submitSearch}
        />

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
          <Suspense fallback={<PageFallback />}>{renderPage()}</Suspense>
        </main>

        <footer className="shrink-0 px-6 pb-4 text-center text-[11px] text-slate-400">
          Royal Spicy Masala · runs fully offline on your device · PostgreSQL backed
        </footer>
      </div>
    </div>
  );
}