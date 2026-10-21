import { lazy, Suspense, useEffect, useState, useRef, useCallback, Fragment } from "react";
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
  BellRing,
  PackageMinus,
  HandCoins,
  PhoneCall
} from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Placeholder from "./components/Placeholder.jsx";
import ExitDialog from "./components/ExitDialog.jsx";
import { api, onPeerChange } from "./api.js";
import { loadStoreInfo, useStoreInfo } from "./lib/storeInfo.js";
import { useNavigation } from "./lib/navigation.js";
import { closeTopOverlay } from "./lib/overlays.js";

const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Reminders = lazy(() => import("./pages/Reminders.jsx"));
const Categories = lazy(() => import("./pages/Categories.jsx"));
const Products = lazy(() => import("./pages/Products.jsx"));
const StockLevels = lazy(() => import("./pages/StockLevels.jsx"));
const StockRemoval = lazy(() => import("./pages/StockRemoval.jsx"));
const Suppliers = lazy(() => import("./pages/Suppliers.jsx"));
const SupplierPurchases = lazy(() => import("./pages/SupplierPurchases.jsx"));
const Sales = lazy(() => import("./pages/Sales.jsx"));
const Customers = lazy(() => import("./pages/Customers.jsx"));
const CustomerPayments = lazy(() => import("./pages/CustomerPayments.jsx"));
const CallNotes = lazy(() => import("./pages/CallNotes.jsx"));
const Expenses = lazy(() => import("./pages/Expenses.jsx"));
const Assets = lazy(() => import("./pages/Assets.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const MeasuringUnits = lazy(() => import("./pages/MeasuringUnits.jsx"));
const Packs = lazy(() => import("./pages/Packs.jsx"));
const Prices = lazy(() => import("./pages/Prices.jsx"));
const Store = lazy(() => import("./pages/Store.jsx"));
const Broadcast = lazy(() => import("./pages/Broadcast.jsx"));
const SmsEmailBroadcast = lazy(() => import("./pages/SmsEmailBroadcast.jsx"));
const Quotation = lazy(() => import("./pages/Quotation.jsx"));
const Vouchers = lazy(() => import("./pages/Vouchers.jsx"));
const Cheques = lazy(() => import("./pages/Cheques.jsx"));
const Tasks = lazy(() => import("./pages/Tasks.jsx"));
const BusinessDocs = lazy(() => import("./pages/BusinessDocs.jsx"));
const Returns = lazy(() => import("./pages/Returns.jsx"));
const Brokers = lazy(() => import("./pages/Brokers.jsx"));
const SettingsPage = lazy(() => import("./pages/Settings.jsx"));

const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "Live overview of your shop", icon: LayoutDashboard },
  reminders: {
    title: "Reminders",
    subtitle: "Payments, cheques and tasks that are due",
    icon: BellRing
  },
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
  stock: {
    title: "Stock Levels",
    subtitle: "How much of every product is left in hand",
    icon: Layers
  },
  stockRemoval: {
    title: "Stock Removal",
    subtitle: "Write off damaged, expired or personally used stock",
    icon: PackageMinus,
    description:
      "Stock that leaves the shelf without being sold — a broken pack, an expired batch, something taken home. Record it here so the inventory stays honest.",
    features: ["Reason for every write-off", "Stock taken off the shelf", "Value at cost", "Undo a mistake"]
  },
  prices: {
    title: "Prices",
    subtitle: "Selling price, market price and money saved for customers",
    icon: CircleDollarSign
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
  brokers: {
    title: "Brokers",
    subtitle: "Ask brokers for stock and send the enquiry on WhatsApp",
    icon: UserRound,
    description: "Reach out to brokers for products you cannot source from regular suppliers.",
    features: ["Broker directory", "Product-wise quantity", "WhatsApp enquiry", "Order tracking"]
  },
  sales: {
    title: "Sales",
    subtitle: "Record sales, bills and payments",
    icon: ShoppingCart,
    description: "Ring up sales in seconds, generate numbered receipts, accept cash, card or credit.",
    features: ["Quick billing", "Printed receipts", "Cash / Card / Credit", "Payment status"]
  },
  returns: {
    title: "Returns",
    subtitle: "Return sold items, refund and restock inventory",
    icon: Undo2
  },
  store: {
    title: "Online Store",
    subtitle: "Browse products with photos and book orders",
    icon: ShoppingBag
  },
  broadcast: {
    title: "WhatsApp Broadcast",
    subtitle: "Send offers & events news to your customers",
    icon: Megaphone
  },
  broadcastSmsEmail: {
    title: "SMS & Email Broadcast",
    subtitle: "Same message over SMS or email, from your own phone and mail apps",
    icon: MessageSquare,
    description: "Reach customers who do not use WhatsApp — the message goes out from your own number or mail account.",
    features: ["SMS & email", "Personalised per customer", "Pending-bill reminders", "Voucher details"]
  },
  quotation: {
    title: "Quotation",
    subtitle: "Build a quotation bill for a client, preview, print or send",
    icon: FileText
  },
  vouchers: {
    title: "Vouchers",
    subtitle: "Issue festival discount vouchers to clients — per-month Rs off, plus ongoing discount",
    icon: TicketPercent
  },
  customers: {
    title: "Customers",
    subtitle: "Customer ledger and outstanding balances",
    icon: Users,
    description: "Keep a tidy ledger of every customer with credit limits and balances updated automatically.",
    features: ["Customer ledger", "Credit limits", "Balance tracking", "Purchase history"]
  },
  customerPayments: {
    title: "Customer Payments",
    subtitle: "Collect money against a bill, in full or in parts",
    icon: HandCoins,
    description:
      "Take part payments against customer bills. Every rupee received is recorded against the invoice, so the balance and the reminders badge stay correct.",
    features: ["Part payments", "Payment methods", "Bill-wise ledger", "Reverse a mistake"]
  },
  callNotes: {
    title: "Call Back Notes",
    subtitle: "What was said, and when to call back",
    icon: PhoneCall,
    description:
      "Write down what a customer, supplier or client said on the phone, and set the date and time to call them back.",
    features: ["What was said", "Call-back date & time", "Priority", "Mark as called back"]
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
  cheques: {
    title: "Cheques",
    subtitle: "Cheque number, amount, clearing date and status",
    icon: Banknote,
    description: "Track every cheque — number, bank, amounts and clearing dates.",
    features: ["Cheque number", "Clearing date", "Supplier / customer payee", "Pending / Cleared / Bounced"]
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
  tasks: {
    title: "Tasks",
    subtitle: "Assign tasks to staff and track their status",
    icon: ClipboardList,
    description: "Divide work among your staff and watch it get done.",
    features: ["Assigned employee", "Priority & due date", "Pending / In Progress / Completed", "Overdue tracking"]
  },
  documents: {
    title: "Business Documents",
    subtitle: "Store licences, invoices, images and PDFs in one place",
    icon: FolderOpen,
    description: "Upload and organise every important business file securely.",
    features: ["Images & PDFs", "Word / Excel files", "Categories", "Open & download anytime"]
  },
  settings: {
    title: "Settings",
    subtitle: "Store information used on receipts",
    icon: Settings
  }
};

const PAGES = {
  dashboard: Dashboard,
  reminders: Reminders,
  categories: Categories,
  products: Products,
  stock: StockLevels,
  stockRemoval: StockRemoval,
  suppliers: Suppliers,
  purchases: SupplierPurchases,
  sales: Sales,
  returns: Returns,
  store: Store,
  broadcast: Broadcast,
  broadcastSmsEmail: SmsEmailBroadcast,
  quotation: Quotation,
  vouchers: Vouchers,
  customers: Customers,
  customerPayments: CustomerPayments,
  callNotes: CallNotes,
  expenses: Expenses,
  assets: Assets,
  cheques: Cheques,
  reports: Reports,
  units: MeasuringUnits,
  packs: Packs,
  brokers: Brokers,
  tasks: Tasks,
  documents: BusinessDocs,
  prices: Prices,
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

// A native build (Capacitor) can close itself. Detected at runtime rather than
// imported so the web build stays free of the plugin.
const nativeApp = () => {
  try {
    return window.Capacitor?.Plugins?.App || null;
  } catch {
    return null;
  }
};

const nativeExit = () => !!nativeApp()?.exitApp;

// Leaving the app for good.
const quitApp = () => {
  const app = nativeApp();
  if (app?.exitApp) {
    app.exitApp();
    return;
  }
  // A browser tab can only be closed by script when it was opened by one. Try
  // it, and fall back to blanking the page, which at least gets the user out
  // of the app.
  try {
    window.close();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    if (!document.hidden) window.location.href = "about:blank";
  }, 150);
};

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [quickSearch, setQuickSearch] = useState("");
  const [navSearch, setNavSearch] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [attentionCount, setAttentionCount] = useState(0);
  const [exitOpen, setExitOpen] = useState(false);
  const store = useStoreInfo();

  // The drawer and the quit prompt are read from the back handler, which
  // lives outside React's render cycle, so they are mirrored into refs.
  const sidebarOpenRef = useRef(false);
  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  const exitOpenRef = useRef(false);
  const requestExit = useCallback(() => {
    // A back press while the prompt is already up means "dismiss it", not
    // "ask again".
    if (exitOpenRef.current) {
      exitOpenRef.current = false;
      setExitOpen(false);
      return;
    }
    exitOpenRef.current = true;
    setExitOpen(true);
  }, []);

  // The back button closes what is on screen before it moves between pages.
  const beforeBack = useCallback(() => {
    if (closeTopOverlay()) return true;
    if (sidebarOpenRef.current) {
      setSidebarOpen(false);
      return true;
    }
    return false;
  }, []);

  const { page, trail, navigate, goBack } = useNavigation({
    initialPage: "dashboard",
    onExit: requestExit,
    beforeBack
  });

  const meta = PAGE_META[page] || PAGE_META.dashboard;
  const PageComponent = PAGES[page];

  // The breadcrumb is the path the user took to reach this page.
  const breadcrumbs = trail.map((step) => ({
    page: step.page,
    label: PAGE_META[step.page]?.title || step.page
  }));

  // Store details live in the database, so they have to be pulled once at boot.
  useEffect(() => {
    loadStoreInfo();
  }, []);

  // The <title> in index.html is static; keep it in step with the saved name.
  useEffect(() => {
    if (store.name) document.title = `${store.name} — Shop Manager`;
  }, [store.name]);

  // Another tab (or another device) saved something: drop our cached reads,
  // re-read the shop details, and remount the page so it refetches. Keying on a
  // Fragment rather than a wrapper div keeps the DOM and page layout identical.
  useEffect(
    () =>
      onPeerChange(() => {
        loadStoreInfo({ force: true });
        setRefreshToken((n) => n + 1);
      }),
    []
  );

  // ─── Reminder badge ────────────────────────────────────────────────
  // The sidebar carries a count of what is late or due today, so the shop sees
  // there is something waiting without having to open the page. Re-read on every
  // peer change, because marking a cheque cleared in another tab is exactly what
  // should make this number drop. Failures are swallowed: a missing badge must
  // never stop the rest of the app from loading.
  useEffect(() => {
    let alive = true;
    api
      .reminders()
      .then((data) => {
        if (alive) setAttentionCount(Number(data?.summary?.needs_attention) || 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  const consumeAction = () => setAction(null);

  const submitSearch = () => {
    setNavSearch(quickSearch);
    navigate("products");
  };

  const renderPage = () => {
    if (page === "dashboard") {
      return (
        <Dashboard
          onNavigate={navigate}
          onSearchTo={(t) => {
            setNavSearch(t);
            navigate("products");
          }}
        />
      );
    }
    if (page === "products") {
      return (
        <Products
          onNavigate={navigate}
          initialSearch={navSearch}
          action={action}
          onActionConsumed={consumeAction}
        />
      );
    }
    if (page === "sales") {
      return <Sales onNavigate={navigate} action={action} onActionConsumed={consumeAction} />;
    }
    if (page === "customers") {
      return (
        <Customers
          onNavigate={navigate}
          onCollect={(customerId) => {
            setAction({ type: "payment", customer_id: customerId, nonce: Date.now() });
            navigate("customerPayments");
          }}
        />
      );
    }
    if (page === "customerPayments") {
      return <CustomerPayments action={action} onActionConsumed={consumeAction} />;
    }
    if (PageComponent) {
      return <PageComponent onNavigate={navigate} />;
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
      <Sidebar
        page={page}
        onNavigate={navigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        badges={{ reminders: attentionCount }}
      />

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          breadcrumbs={breadcrumbs}
          onNavigate={navigate}
          onBack={goBack}
          onMenu={() => setSidebarOpen(true)}
          onNewSale={() => {
            setAction({ type: "sale", nonce: Date.now() });
            navigate("sales");
          }}
          onNewProduct={() => {
            setAction({ type: "product", nonce: Date.now() });
            navigate("products");
          }}
          quickSearch={quickSearch}
          onQuickSearch={setQuickSearch}
          onSearchSubmit={submitSearch}
        />

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
          <Suspense fallback={<PageFallback />}>
            <Fragment key={refreshToken}>{renderPage()}</Fragment>
          </Suspense>
        </main>

        <footer className="shrink-0 px-6 pb-4 text-center text-[11px] text-slate-400">
          {store.name} · runs fully offline on your device · PostgreSQL backed
        </footer>
      </div>

      <ExitDialog
        open={exitOpen}
        appName={store.name || "the app"}
        note={
          nativeExit()
            ? undefined
            : "This browser does not let the app close itself — close the tab to quit."
        }
        onCancel={() => {
          exitOpenRef.current = false;
          setExitOpen(false);
        }}
        onConfirm={quitApp}
      />
    </div>
  );
}