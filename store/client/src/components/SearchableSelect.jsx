import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X } from "lucide-react";

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  required = false,
  disabled = false,
  className = ""
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);
  const searchRef = useRef(null);

  const normalizedValue = value === null || value === undefined ? "" : String(value);

  const selectedLabel = useMemo(() => {
    const opt = options.find((o) => String(o.value) === normalizedValue);
    return opt ? opt.label : "";
  }, [options, normalizedValue]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const timer = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSelect = (optVal) => {
    const strVal = String(optVal);
    setOpen(false);
    const event = { target: { value: strVal } };
    onChange(event);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    setOpen(false);
    onChange({ target: { value: "" } });
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm transition
          ${disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : "cursor-pointer hover:border-slate-300"}
          ${open ? "border-indigo-400 ring-2 ring-indigo-100" : ""}
          ${!selectedLabel ? "text-slate-400" : "text-slate-800"}`}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel || placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {selectedLabel && !disabled && (
            <span
              onClick={handleClear}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">No options found</div>
            ) : (
              filtered.map((opt) => {
                const isSelected = String(opt.value) === normalizedValue;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelect(opt.value);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-indigo-50
                      ${isSelected ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    {isSelected && (
                      <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}