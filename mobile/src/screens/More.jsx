import { Link } from "react-router-dom";
import {
  BadgePercent,
  BarChart3,
  Barcode,
  BellRing,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Globe,
  Handshake,
  Lock,
  Mail,
  MessageCircle,
  PackageMinus,
  PhoneCall,
  ReceiptText,
  Ruler,
  Settings as SettingsIcon,
  ShieldCheck,
  Tags,
  Ticket,
  Truck,
  Undo2,
  Users,
  Wallet
} from "lucide-react";
import { useApp } from "../App.jsx";
import { PageHeader } from "../components/ui.jsx";

const GROUPS = [
  {
    title: "Shop",
    links: [
      { to: "/customers", label: "Customers", description: "Bills, balances and payments", icon: Users, tone: "bg-purple-50 text-purple-700" },
      { to: "/suppliers", label: "Suppliers", description: "Supplier directory and dues", icon: Truck, tone: "bg-sky-50 text-sky-700" },
      { to: "/purchases", label: "Purchases", description: "Suppliers and stock buying", icon: Truck, tone: "bg-sky-50 text-sky-700" },
      { to: "/categories", label: "Categories", description: "Product categories and subcategories", icon: FolderTree, tone: "bg-violet-50 text-violet-700" },
      { to: "/measuring-units", label: "Measuring units", description: "kg, litre, dozen and packs", icon: Ruler, tone: "bg-teal-50 text-teal-700" },
      { to: "/weight-barcodes", label: "Weight barcodes", description: "Generic 250g, 500g and kg labels", icon: Barcode, tone: "bg-amber-50 text-amber-700" },
      { to: "/prices", label: "Customer prices", description: "Special prices by category", icon: Tags, tone: "bg-indigo-50 text-indigo-700" },
      { to: "/stock-levels", label: "Stock levels", description: "Low stock and inventory value", icon: Boxes, tone: "bg-amber-50 text-amber-700" },
      { to: "/stock-removal", label: "Stock removal", description: "Write off damaged or lost stock", icon: PackageMinus, tone: "bg-rose-50 text-rose-700" },
      { to: "/packs", label: "Inventory packs", description: "Open packs and remaining units", icon: Boxes, tone: "bg-cyan-50 text-cyan-700" },
      { to: "/online-orders", label: "Online orders", description: "Confirm or cancel web orders", icon: Globe, tone: "bg-brand-50 text-brand-700" },
      { to: "/non-sale", label: "Non-sale stock", description: "Supplies, packaging and usage", icon: Boxes, tone: "bg-rose-50 text-rose-700" },
      { to: "/expenses", label: "Expenses", description: "Shop costs and spending", icon: CircleDollarSign, tone: "bg-amber-50 text-amber-700" }
    ]
  },
  {
    title: "Sales & marketing",
    links: [
      { to: "/quotation", label: "Quotation", description: "Build and share a quote", icon: FileSpreadsheet, tone: "bg-blue-50 text-blue-700" },
      { to: "/returns", label: "Returns", description: "Refund items and restock inventory", icon: Undo2, tone: "bg-rose-50 text-rose-700" },
      { to: "/vouchers", label: "Discount vouchers", description: "Campaigns and voucher codes", icon: BadgePercent, tone: "bg-fuchsia-50 text-fuchsia-700" },
      { to: "/customer-payments", label: "Customer payments", description: "Payments received from customers", icon: Wallet, tone: "bg-emerald-50 text-emerald-700" },
      { to: "/completed-bills", label: "Completed bills", description: "Fully settled bills", icon: ReceiptText, tone: "bg-emerald-50 text-emerald-700" },
      { to: "/broadcast", label: "WhatsApp broadcast", description: "Message customers on WhatsApp", icon: MessageCircle, tone: "bg-emerald-50 text-emerald-700" },
      { to: "/sms-email", label: "SMS & email", description: "Reach customers by SMS or email", icon: Mail, tone: "bg-brand-50 text-brand-700" }
    ]
  },
  {
    title: "Team",
    links: [
      { to: "/employees", label: "Employees", description: "Staff, attendance, payroll, documents", icon: CalendarCheck, tone: "bg-indigo-50 text-indigo-700" },
      { to: "/attendance-sheet", label: "Attendance sheet", description: "Monthly employee day-by-day grid", icon: CalendarDays, tone: "bg-teal-50 text-teal-700" },
      { to: "/employee-reports", label: "Employee reports", description: "Staff, attendance, payroll and payments", icon: ClipboardList, tone: "bg-indigo-50 text-indigo-700" }
    ]
  },
  {
    title: "Records",
    links: [
      { to: "/reminders", label: "Reminders", description: "Dues, cheques, tasks and call backs", icon: BellRing, tone: "bg-red-50 text-red-700" },
      { to: "/tasks", label: "Tasks", description: "Shop chores and follow-ups", icon: FileText, tone: "bg-slate-100 text-slate-700" },
      { to: "/call-notes", label: "Call back notes", description: "Customers to call back", icon: PhoneCall, tone: "bg-emerald-50 text-emerald-700" },
      { to: "/business-docs", label: "Business documents", description: "Licences, GST and agreements", icon: FileText, tone: "bg-amber-50 text-amber-700" },
      { to: "/assets", label: "Assets", description: "Equipment and valuables", icon: Building2, tone: "bg-indigo-50 text-indigo-700" },
      { to: "/cheques", label: "Cheques", description: "Pending and cleared cheques", icon: Ticket, tone: "bg-sky-50 text-sky-700" },
      { to: "/brokers", label: "Brokers", description: "Stock enquiries on WhatsApp", icon: Handshake, tone: "bg-teal-50 text-teal-700" }
    ]
  },
  {
    title: "Insights",
    links: [
      { to: "/reports", label: "Reports", description: "Profit, sales and low stock", icon: BarChart3, tone: "bg-emerald-50 text-emerald-700" },
      { to: "/settings", label: "Settings", description: "Store, printer, PIN and backups", icon: SettingsIcon, tone: "bg-slate-100 text-slate-700" }
    ]
  }
];

export default function More() {
  const { store, lockApp } = useApp();
  return (
    <div className="pb-24">
      <PageHeader title="More" subtitle={store?.name || "Barkaati"} />

      <div className="px-4">
        <div className="mb-3 rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold">Offline & encrypted</p>
              <p className="text-[11px] text-white/60">Your shop data stays on this device.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group.title}</p>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                {group.links.map(({ to, label, description, icon: Icon, tone }) => (
                  <Link
                    key={to}
                    to={to}
                    className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 active:bg-slate-50"
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      <span className="block text-[11px] text-slate-400">{description}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={lockApp}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-semibold text-red-600 shadow-sm active:bg-red-50"
        >
          <Lock className="h-4 w-4" /> Lock app
        </button>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Barkaati Inventory · Offline edition
        </p>
      </div>
    </div>
  );
}
