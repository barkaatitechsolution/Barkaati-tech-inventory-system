// Page chunks are imported lazily so the first paint only ships the shell.
// Keeping the loader functions in one place lets the sidebar warm a page as
// soon as the pointer or keyboard focus lands on it, which makes navigation
// feel instant without making the initial bundle any larger.

export const pageLoaders = {
  dashboard: () => import("../pages/Dashboard.jsx"),
  reminders: () => import("../pages/Reminders.jsx"),
  categories: () => import("../pages/Categories.jsx"),
  products: () => import("../pages/Products.jsx"),
  stock: () => import("../pages/StockLevels.jsx"),
  stockRemoval: () => import("../pages/StockRemoval.jsx"),
  nonSale: () => import("../pages/NonSaleInventory.jsx"),
  suppliers: () => import("../pages/Suppliers.jsx"),
  purchases: () => import("../pages/SupplierPurchases.jsx"),
  sales: () => import("../pages/Sales.jsx"),
  customers: () => import("../pages/Customers.jsx"),
  pointPrograms: () => import("../pages/PointPrograms.jsx"),
  customerPayments: () => import("../pages/CustomerPayments.jsx"),
  completedBills: () => import("../pages/CompletedBills.jsx"),
  callNotes: () => import("../pages/CallNotes.jsx"),
  expenses: () => import("../pages/Expenses.jsx"),
  assets: () => import("../pages/Assets.jsx"),
  reports: () => import("../pages/Reports.jsx"),
  units: () => import("../pages/MeasuringUnits.jsx"),
  packs: () => import("../pages/Packs.jsx"),
  prices: () => import("../pages/Prices.jsx"),
  onlineOrders: () => import("../pages/OnlineOrders.jsx"),
  broadcast: () => import("../pages/Broadcast.jsx"),
  broadcastSmsEmail: () => import("../pages/SmsEmailBroadcast.jsx"),
  quotation: () => import("../pages/Quotation.jsx"),
  vouchers: () => import("../pages/Vouchers.jsx"),
  cheques: () => import("../pages/Cheques.jsx"),
  tasks: () => import("../pages/Tasks.jsx"),
  documents: () => import("../pages/BusinessDocs.jsx"),
  returns: () => import("../pages/Returns.jsx"),
  brokers: () => import("../pages/Brokers.jsx"),
  settings: () => import("../pages/Settings.jsx"),
  employees: () => import("../pages/Employees.jsx"),
  employeeAttendance: () => import("../pages/EmployeeAttendance.jsx"),
  employeeAttendanceSheet: () => import("../pages/EmployeeAttendanceSheet.jsx"),
  employeePayroll: () => import("../pages/EmployeePayroll.jsx"),
  employeePayments: () => import("../pages/EmployeePayments.jsx"),
  employeeDocuments: () => import("../pages/EmployeeDocuments.jsx"),
  employeeReports: () => import("../pages/EmployeeReports.jsx")
};

export function preloadPage(key) {
  const loader = pageLoaders[key];
  if (!loader) return;
  // A prefetch that fails must stay silent -- the real navigation will retry
  // and surface the error in the page's own error state.
  loader().catch(() => {});
}

// The handful of screens the shop opens most often. They are warmed while the
// browser is idle, but not on a metered/slow connection where the extra
// requests would cost more than they save.
const IDLE_PREFETCH = ["sales", "products", "customers", "completedBills"];

export function prefetchLikelyPages() {
  const connection = typeof navigator !== "undefined" ? navigator.connection : null;
  if (connection?.saveData) return () => {};
  if (/^(slow-)?2g$/.test(connection?.effectiveType || "")) return () => {};

  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    for (const key of IDLE_PREFETCH) preloadPage(key);
  };
  const idle =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback.bind(window)
      : (fn) => window.setTimeout(fn, 1200);
  const id = idle(run, { timeout: 4000 });
  return () => {
    cancelled = true;
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(id);
    else clearTimeout(id);
  };
}
