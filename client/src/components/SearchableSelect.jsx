import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { exactOption, filterOptions, looksLikeBarcode } from "../lib/optionSearch.js";

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  required = false,
  disabled = false,
  onBarcode = null,
  className = "",
  loadOptions = null,
  selectedLabel: selectedLabelProp = null,
  loadingLabel = "Searching...",
  emptyLabel = "No options found",
  minChars = 0
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [remoteOptions, setRemoteOptions] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const loadOptionsRef = useRef(loadOptions);
  loadOptionsRef.current = loadOptions;
  const hasLoader = !!loadOptions;
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const normalizedValue = value === null || value === undefined ? "" : String(value);

  const allOptions = useMemo(
    () => (loadOptions ? [...options, ...remoteOptions] : options),
    [loadOptions, options, remoteOptions]
  );

  const selectedLabel = useMemo(() => {
    if (selectedLabelProp) return selectedLabelProp;
    const opt = allOptions.find((o) => String(o.value) === normalizedValue);
    return opt ? opt.label : "";
  }, [allOptions, normalizedValue, selectedLabelProp]);

  const filtered = useMemo(
    () => (loadOptions ? remoteOptions : filterOptions(options, search)),
    [loadOptions, remoteOptions, options, search]
  );

  useEffect(() => {
    if (!open || !hasLoader) return undefined;
    const query = String(search || "").trim();
    if (query.length < minChars) {
      setRemoteOptions([]);
      setRemoteLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRemoteLoading(true);
    const timer = setTimeout(async () => {
      try {
        const next = await loadOptionsRef.current(query);
        if (!cancelled) setRemoteOptions(Array.isArray(next) ? next : []);
      } catch {
        if (!cancelled) setRemoteOptions([]);
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, minChars, hasLoader]);

  useEffect(() => {
    if (!open) setRemoteOptions([]);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setActiveIndex(-1);
      return;
    }
    const timer = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  // Start on the current value (or the first result) and keep the highlighted
  // row inside the visible part of the list while arrowing through it.
  useEffect(() => {
    if (!open) return;
    const selected = filtered.findIndex((o) => String(o.value) === normalizedValue);
    setActiveIndex(selected >= 0 ? selected : filtered.length ? 0 : -1);
  }, [search, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActiveIndex((i) => (i >= filtered.length ? filtered.length - 1 : i));
  }, [filtered.length]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

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

  const chooseOption = (raw) => {
    const matches = loadOptions ? filtered : filterOptions(options, raw);
    const opt = exactOption(loadOptions ? allOptions : options, raw) || matches[activeIndex] || matches[0];
    if (opt) {
      handleSelect(opt.value);
      return;
    }
    const code = String(raw ?? "").trim();
    if (onBarcode && looksLikeBarcode(code)) {
      setOpen(false);
      setSearch("");
      onBarcode(code);
    }
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
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
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
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    chooseOption(e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    setOpen(false);
                  }
                }}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div ref={listRef} className="max-h-60 overflow-y-auto scrollbar-thin">
            {remoteLoading && filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">{loadingLabel}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">{emptyLabel}</div>
            ) : (
              filtered.map((opt, index) => {
                const isSelected = String(opt.value) === normalizedValue;
                const isActive = index === activeIndex;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelect(opt.value);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm transition
                      ${isSelected ? "font-medium text-indigo-700" : "text-slate-700"}
                      ${isActive ? "bg-indigo-50" : "hover:bg-indigo-50"}`}
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