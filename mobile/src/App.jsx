import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Home, Menu, Package, ReceiptText, ShoppingCart } from "lucide-react";
import { api } from "./api.js";
import { hasPin, lock } from "./lib/auth.js";
import { initFileRoot } from "./lib/files.js";
import { startAutoSync, stopAutoSync } from "./lib/sync.js";
import { Spinner, Toaster, cx } from "./components/ui.jsx";
import AuthScreen from "./screens/Auth.jsx";
import Dashboard from "./screens/Dashboard.jsx";
import Pos from "./screens/Pos.jsx";
import Products from "./screens/Products.jsx";
import Sales from "./screens/Sales.jsx";
import Customers from "./screens/Customers.jsx";
import Purchases from "./screens/Purchases.jsx";
import Expenses from "./screens/Expenses.jsx";
import NonSaleInventory from "./screens/NonSaleInventory.jsx";
import Reports from "./screens/Reports.jsx";
import More from "./screens/More.jsx";
import Settings from "./screens/Settings.jsx";
import Reminders from "./screens/Reminders.jsx";
import Assets from "./screens/Assets.jsx";
import Cheques from "./screens/Cheques.jsx";
import Tasks from "./screens/Tasks.jsx";
import CallNotes from "./screens/CallNotes.jsx";
import BusinessDocs from "./screens/BusinessDocs.jsx";
import Brokers from "./screens/Brokers.jsx";
import Vouchers from "./screens/Vouchers.jsx";
import Employees from "./screens/Employees.jsx";
import EmployeeAttendanceSheet from "./screens/EmployeeAttendanceSheet.jsx";
import EmployeeReports from "./screens/EmployeeReports.jsx";
import Returns from "./screens/Returns.jsx";
import Quotation from "./screens/Quotation.jsx";
import Prices from "./screens/Prices.jsx";
import StockLevels from "./screens/StockLevels.jsx";
import StockRemoval from "./screens/StockRemoval.jsx";
import Packs from "./screens/Packs.jsx";
import Suppliers from "./screens/Suppliers.jsx";
import OnlineOrders from "./screens/OnlineOrders.jsx";
import CustomerPayments from "./screens/CustomerPayments.jsx";
import CompletedBills from "./screens/CompletedBills.jsx";
import Broadcast from "./screens/Broadcast.jsx";
import SmsEmailBroadcast from "./screens/SmsEmailBroadcast.jsx";
import Categories from "./screens/Categories.jsx";
import MeasuringUnits from "./screens/MeasuringUnits.jsx";
import WeightBarcodes from "./screens/WeightBarcodes.jsx";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/pos", label: "Sell", icon: ShoppingCart },
  { to: "/products", label: "Products", icon: Package },
  { to: "/sales", label: "Sales", icon: ReceiptText },
  { to: "/more", label: "More", icon: Menu }
];

function BottomNav() {
  return (
    <nav className="safe-bottom z-30 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold",
                isActive ? "text-brand-700" : "text-slate-400"
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  const [phase, setPhase] = useState("loading");
  const [store, setStore] = useState(null);
  const [version, setVersion] = useState(0);

  const bump = () => setVersion((v) => v + 1);
  const reloadStore = async () => {
    const info = await api.storeInfo();
    setStore(info);
    return info;
  };

  useEffect(() => {
    (async () => {
      await initFileRoot();
      setPhase((await hasPin()) ? "locked" : "setup");
    })();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let sub;
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (window.__barkaatiScanning) {
        window.dispatchEvent(new Event("barkaati-scan-cancel"));
        return;
      }
      if (canGoBack) window.history.back();
      else CapApp.exitApp();
    }).then((s) => {
      sub = s;
    });
    return () => {
      sub?.remove?.();
    };
  }, []);

  const unlock = async () => {
    try {
      await reloadStore();
      setPhase("unlocked");
      startAutoSync().catch(() => {});
    } catch (e) {
      console.error(e);
      setPhase("locked");
    }
  };

  const lockApp = async () => {
    stopAutoSync();
    await lock();
    setPhase("locked");
  };

  if (phase === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-brand-800 text-white">
        <Spinner className="h-7 w-7" />
        <p className="text-sm font-medium text-white/70">Opening shop…</p>
      </div>
    );
  }

  if (phase === "setup" || phase === "locked") {
    return (
      <>
        <AuthScreen mode={phase} onUnlocked={unlock} />
        <Toaster />
      </>
    );
  }

  return (
    <AppContext.Provider value={{ store, setStore, reloadStore, version, bump, lockApp }}>
      <div className="flex h-full flex-col bg-slate-100">
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pos" element={<Pos />} />
            <Route path="/products" element={<Products />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/non-sale" element={<NonSaleInventory />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/more" element={<More />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/cheques" element={<Cheques />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/call-notes" element={<CallNotes />} />
            <Route path="/business-docs" element={<BusinessDocs />} />
            <Route path="/brokers" element={<Brokers />} />
            <Route path="/vouchers" element={<Vouchers />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/attendance-sheet" element={<EmployeeAttendanceSheet />} />
            <Route path="/employee-reports" element={<EmployeeReports />} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/quotation" element={<Quotation />} />
            <Route path="/prices" element={<Prices />} />
            <Route path="/stock-levels" element={<StockLevels />} />
            <Route path="/stock-removal" element={<StockRemoval />} />
            <Route path="/packs" element={<Packs />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/online-orders" element={<OnlineOrders />} />
            <Route path="/customer-payments" element={<CustomerPayments />} />
            <Route path="/completed-bills" element={<CompletedBills />} />
            <Route path="/broadcast" element={<Broadcast />} />
            <Route path="/sms-email" element={<SmsEmailBroadcast />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/measuring-units" element={<MeasuringUnits />} />
            <Route path="/weight-barcodes" element={<WeightBarcodes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
      <Toaster />
    </AppContext.Provider>
  );
}
