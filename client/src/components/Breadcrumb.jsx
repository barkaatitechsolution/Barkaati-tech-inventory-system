import { Fragment } from "react";
import { ChevronRight, Home } from "lucide-react";

// The path the user took to get here, oldest first. Clicking an earlier crumb
// walks back to that step, which is what the back button does too.
export default function Breadcrumb({ items = [], onNavigate }) {
  if (!items.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-0.5 overflow-x-auto text-xs text-slate-500 sm:text-[13px]"
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const Icon = i === 0 ? Home : null;
        return (
          <Fragment key={`${item.page}-${i}`}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
            )}
            {last ? (
              <span
                aria-current="page"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 font-semibold text-slate-800"
              >
                {Icon && <Icon className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />}
                {item.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate?.(item.page)}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 font-medium transition hover:bg-slate-100 hover:text-indigo-600"
              >
                {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                {item.label}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
