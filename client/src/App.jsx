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
  Coins,
  PhoneCall,
  CheckCircle2,
  CalendarDays,
  FileSpreadsheet,
  Barcode
} from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Placeholder from "./components/Placeholder.jsx";
import ExitDialog from "./components/ExitDialog.jsx";
import PasswordPrompt from "./components/PasswordPrompt.jsx";
import { api, onPeerChange } from "./api.js";
import { loadStoreInfo, useStoreInfo } from "./lib/storeInfo.js";
import { hasDirtyDrafts, subscribeDirtyDrafts } from "./lib/formDraft.js";
import { useNavigation } from "./lib/navigation.js";
import { closeAllOverlays, closeTopOverlay, hasOpenOverlays } from "./lib/overlays.js";
import { matchGlobalScanCommand } from "./lib/salesCommands.js";
import useScannerCapture from "./lib/useScannerCapture.js";
import { isSalesTab, requestSalesTab, useSalesTab } from "./lib/salesTab.js";
import { pageLoaders, preloadPage, prefetchLikelyPages } from "./lib/pageLoaders.js";

const Dashboard = lazy(pageLoaders.dashboard);
const Reminders = lazy(pageLoaders.reminders);
const Categories = lazy(pageLoaders.categories);
const Products = lazy(pageLoaders.products);
const WeightBarcodes = lazy(pageLoaders.weightBarcodes);
const StockLevels = lazy(pageLoaders.stock);
const StockRemoval = lazy(pageLoaders.stockRemoval);
const NonSaleInventory = lazy(pageLoaders.nonSale);
const Suppliers = lazy(pageLoaders.suppliers);
const SupplierPurchases = lazy(pageLoaders.purchases);
const Sales = lazy(pageLoaders.sales);
const Customers = lazy(pageLoaders.customers);
const PointPrograms = lazy(pageLoaders.pointPrograms);
const CustomerPayments = lazy(pageLoaders.customerPayments);
const CompletedBills = lazy(pageLoaders.completedBills);
const CallNotes = lazy(pageLoaders.callNotes);
const Expenses = lazy(pageLoaders.expenses);
const Assets = lazy(pageLoaders.assets);
const Reports = lazy(pageLoaders.reports);
const MeasuringUnits = lazy(pageLoaders.units);
const Packs = lazy(pageLoaders.packs);
const Prices = lazy(pageLoaders.prices);
const OnlineOrders = lazy(pageLoaders.onlineOrders);
const Broadcast = lazy(pageLoaders.broadcast);
const SmsEmailBroadcast = lazy(pageLoaders.broadcastSmsEmail);
const Quotation = lazy(pageLoaders.quotation);
const Vouchers = lazy(pageLoaders.vouchers);
const Cheques = lazy(pageLoaders.cheques);
const Tasks = lazy(pageLoaders.tasks);
const BusinessDocs = lazy(pageLoaders.documents);
const Returns = lazy(pageLoaders.returns);
const Brokers = lazy(pageLoaders.brokers);
const SettingsPage = lazy(pageLoaders.settings);
const Employees = lazy(pageLoaders.employees);
const EmployeeAttendance = lazy(pageLoaders.employeeAttendance);
const EmployeeAttendanceSheet = lazy(pageLoaders.employeeAttendanceSheet);
const EmployeePayroll = lazy(pageLoaders.employeePayroll);
const EmployeePayments = lazy(pageLoaders.employeePayments);
const EmployeeDocuments = lazy(pageLoaders.employeeDocuments);
const EmployeeReports = lazy(pageLoaders.employeeReports);

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
  weightBarcodes: {
    title: "Weight Barcodes",
    subtitle: "Create and print generic weight barcodes",
    icon: Barcode,
    description:
      "Make weight labels that work with any item. Select the item in a bill, then scan a label to set its quantity.",
    features: ["500 g, 250 g, 1.5 kg and more", "Works with the selected item", "Print labels at the counter"]
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
  nonSale: {
    title: "Non-Sale Inventory",
    subtitle: "Carry bags, packaging and other materials bought for the shop",
    icon: Boxes,
    description:
      "Materials you buy for the shop that are not for resale — carry bags, packaging, wrap. The purchase is added to your expenses automatically.",
    features: ["Name, size & unit", "Quantity and amount", "Stock remaining", "Auto expense entry"]
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
  onlineOrders: {
    title: "Online Orders",
    subtitle: "Confirm or cancel bookings placed on the public store",
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
  pointPrograms: {
    title: "Point Programs",
    subtitle: "Loyalty programmes — earn rates, point values and redemption history",
    icon: Coins,
    description:
      "Run one loyalty programme at a time. Set how much customers must spend to earn a point and what each point is worth when they redeem it.",
    features: ["Earn rate", "Redemption value", "Date ranges", "Point history"]
  },
  customerPayments: {
    title: "Customer Payments",
    subtitle: "Collect money against a bill, in full or in parts",
    icon: HandCoins,
    description:
      "Take part payments against customer bills. Every rupee received is recorded against the invoice, so the balance and the reminders badge stay correct.",
    features: ["Part payments", "Payment methods", "Bill-wise ledger", "Reverse a mistake"]
  },
  completedBills: {
    title: "Completed Bills",
    subtitle: "Fully paid bills and every payment received against them",
    icon: CheckCircle2,
    description:
      "Browse every bill that has been fully settled, with the customer, mobile number and all part payments recorded against it.",
    features: ["Fully settled bills", "Payment breakdown", "Search by mobile", "Sort by date, name or amount"]
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
    subtitle: "Track work items, priority and status",
    icon: ClipboardList,
    description: "Keep a simple list of work items and watch them get done.",
    features: ["Priority & due date", "Pending / In Progress / Completed", "Overdue tracking"]
  },
  employees: {
    title: "Employees",
    subtitle: "Staff directory, pay basis and balances",
    icon: Users
  },
  employeeAttendance: {
    title: "Employee Attendance",
    subtitle: "Daily marks and monthly summaries",
    icon: CalendarDays
  },
  employeeAttendanceSheet: {
    title: "Attendance Sheet",
    subtitle: "Date-by-date attendance for each employee, ready for Excel",
    icon: FileSpreadsheet
  },
  employeePayroll: {
    title: "Employee Payroll",
    subtitle: "Draft from attendance, finalize and pay",
    icon: Wallet
  },
  employeePayments: {
    title: "Employee Payments",
    subtitle: "Salary, advances, bonuses and deductions",
    icon: HandCoins
  },
  employeeDocuments: {
    title: "Employee Documents",
    subtitle: "ID proofs, contracts and other staff files",
    icon: FolderOpen
  },
  employeeReports: {
    title: "Employee Reports",
    subtitle: "Staff, attendance, payroll, payments and documents",
    icon: BarChart3
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
  weightBarcodes: WeightBarcodes,
  stock: StockLevels,
  stockRemoval: StockRemoval,
  nonSale: NonSaleInventory,
  suppliers: Suppliers,
  purchases: SupplierPurchases,
  sales: Sales,
  returns: Returns,
  onlineOrders: OnlineOrders,
  broadcast: Broadcast,
  broadcastSmsEmail: SmsEmailBroadcast,
  quotation: Quotation,
  vouchers: Vouchers,
  customers: Customers,
  pointPrograms: PointPrograms,
  customerPayments: CustomerPayments,
  completedBills: CompletedBills,
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
  settings: SettingsPage,
  employees: Employees,
  employeeAttendance: EmployeeAttendance,
  employeeAttendanceSheet: EmployeeAttendanceSheet,
  employeePayroll: EmployeePayroll,
  employeePayments: EmployeePayments,
  employeeDocuments: EmployeeDocuments,
  employeeReports: EmployeeReports
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

const NEW_SALE_TAB_PARAM = "newSale";

const isNewSaleTab = () => {
  try {
    return new URL(window.location.href).searchParams.get(NEW_SALE_TAB_PARAM) === "1";
  } catch {
    return false;
  }
};

const newSaleTabURL = () => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(NEW_SALE_TAB_PARAM, "1");
  return url.toString();
};

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
  const [bootNewSale] = useState(isNewSaleTab);
  const [salesTab] = useState(isSalesTab);
  const [action, setAction] = useState(() =>
    bootNewSale ? { type: "sale", nonce: Date.now() } : null
  );
  const [quickSearch, setQuickSearch] = useState("");
  const [navSearch, setNavSearch] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const pendingRefreshRef = useRef(false);
  const mainRef = useRef(null);
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
    initialPage: bootNewSale ? "sales" : "dashboard",
    onExit: requestExit,
    beforeBack
  });

  // The marker is only a one-shot instruction for the freshly opened tab.
  // Remove it before the user reloads so a reload does not open another bill.
  useEffect(() => {
    if (!bootNewSale) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(NEW_SALE_TAB_PARAM);
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    } catch {
      /* the URL is not ours to change -- the form is already open */
    }
  }, [bootNewSale]);

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

  // Warm the most-used page chunks once the browser is idle, so opening Sales,
  // Products or Customers does not wait on a fresh download.
  useEffect(() => prefetchLikelyPages(), []);

  // The <title> in index.html is static; keep it in step with the saved name
  // and the page on screen, so browser tabs and history are recognisable.
  useEffect(() => {
    if (!store.name) return;
    document.title =
      page === "dashboard" ? `${store.name} — Shop Manager` : `${meta.title} — ${store.name}`;
  }, [store.name, page, meta.title]);

  // A page is always opened at its top. Without this the previous page's
  // scroll offset carries over and the new screen appears to start halfway
  // down.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [page]);

  // Another tab (or another device) saved something: drop our cached reads,
  // re-read the shop details, and remount the page so it refetches. Keying on a
  // Fragment rather than a wrapper div keeps the DOM and page layout identical.
  // A form with unsaved entries defers the remount: remounting is what used to
  // wipe a half-filled form. The refresh runs as soon as that form is saved,
  // discarded or closed.
  useEffect(
    () =>
      onPeerChange(() => {
        loadStoreInfo({ force: true });
        if (hasDirtyDrafts()) {
          pendingRefreshRef.current = true;
          return;
        }
        setRefreshToken((n) => n + 1);
      }),
    []
  );

  useEffect(
    () =>
      subscribeDirtyDrafts((count) => {
        if (count === 0 && pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          setRefreshToken((n) => n + 1);
        }
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

  const openNewSaleHere = useCallback(() => {
    // Keep a bill or dialog that is already open in the reusable Sales tab.
    // The tab has already been brought forward; do not stack a second form.
    if (page === "sales" && hasOpenOverlays()) return;
    setAction({ type: "sale", nonce: Date.now() });
    navigate("sales");
  }, [navigate, page]);

  useSalesTab({ enabled: salesTab, onOpenSale: openNewSaleHere });

  // A global command barcode works from any page or dialog. The first scan
  // opens one named Sales tab; later scans reuse it and leave the scanning tab
  // alone. The Sales page keeps the bill-level commands; this listener only
  // claims CMD: codes, so CT/BT scans still reach the focused scan field.
  const handleGlobalScan = useCallback(
    async (code) => {
      if (!matchGlobalScanCommand(code)) return;
      if (salesTab) {
        openNewSaleHere();
        return;
      }
      if (await requestSalesTab(newSaleTabURL())) return;

      // Already working in a bill in this tab (for example, popups were
      // blocked earlier): bring the form forward instead of resetting it.
      if (page === "sales" && hasOpenOverlays()) {
        openNewSaleHere();
        return;
      }

      // Popup blocked. Fall back to this tab, but do not silently throw away
      // a half-finished form on the page the operator was using.
      if (
        hasDirtyDrafts() &&
        !window.confirm(
          "The browser blocked the new tab. You have unsaved changes. Open New Sale in this tab and leave them?"
        )
      ) {
        return;
      }

      closeAllOverlays();
      setSidebarOpen(false);
      openNewSaleHere();
    },
    [openNewSaleHere, salesTab]
  );

  useScannerCapture({ prefixes: ["CMD:"], onScan: handleGlobalScan });

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
      {/* Keyboard users can jump straight past the menu. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      {/* Sidebar */}
      <Sidebar
        page={page}
        onNavigate={navigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
        onPrefetch={preloadPage}
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
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 outline-none sm:px-6"
        >
          <Suspense fallback={<PageFallback />}>
            <Fragment key={refreshToken}>{renderPage()}</Fragment>
          </Suspense>
        </main>

        <footer className="shrink-0 px-6 pb-4 text-center text-[11px] text-slate-400">
          {store.name} · runs fully offline on your device · PostgreSQL backed
        </footer>
      </div>

      <PasswordPrompt />

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