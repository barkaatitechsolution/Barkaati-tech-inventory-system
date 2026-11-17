import { BadgeCheck, Barcode, PlusCircle, Printer, ShoppingCart } from "lucide-react";
import BarcodeSvg from "./BarcodeSvg.jsx";
import { SCAN_COMMANDS } from "../lib/salesCommands.js";

const ICONS = {
  sale: PlusCircle,
  create: ShoppingCart,
  print: Printer,
  paid: BadgeCheck
};

export default function SalesCommandStrip({ lastSaleLabel, onPrintCard, onPrintCommand }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Barcode className="h-4 w-4 shrink-0 text-indigo-500" />
          <p className="text-sm font-semibold text-slate-700">Scan commands</p>
          <span className="truncate text-[11px] text-slate-400">
            {lastSaleLabel ? `Print: ${lastSaleLabel}` : "Print: no bill selected"}
          </span>
        </div>
        <button
          type="button"
          onClick={onPrintCard}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
        >
          <Printer className="h-3.5 w-3.5" /> Print command card
        </button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SCAN_COMMANDS.map((command) => {
          const Icon = ICONS[command.id] || Barcode;
          return (
            <div key={command.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2">
              <div className="flex items-center justify-between gap-1.5 text-[11px] font-semibold text-slate-600">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{command.label}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onPrintCommand?.(command)}
                  className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-indigo-600"
                  title={`Print ${command.label} barcode`}
                  aria-label={`Print ${command.label} barcode`}
                >
                  <Printer className="h-3.5 w-3.5" />
                </button>
              </div>
              <BarcodeSvg
                value={command.code}
                height={34}
                width={1.1}
                fontSize={9}
                className="mt-1 block h-9 w-full [&>svg]:h-full [&>svg]:w-full"
              />
              <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">{command.code}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        New Sale opens a fresh bill in a new tab from anywhere. Customer and product barcodes work anywhere in the New Sale
        form. Create and Paid work while a bill is open; Print reprints the last bill on the 58mm printer. Use
        each label's print icon to print that barcode separately.
      </p>
    </div>
  );
}
