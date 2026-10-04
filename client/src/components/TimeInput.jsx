import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock, X } from "lucide-react";
import { normalizeTime, timeDigits } from "../lib/hours.js";

// A clock field that works by typing and by clicking.
//
// The native <input type="time"> is only usable if you know to click the tiny
// clock icon in the corner; typing digits into it does nothing, which is why
// attendance times looked unselectable on the shop floor. This accepts
// "930", "09:30" or a click from the list, and shows the current value as
// text rather than as an empty box.

export default function TimeInput({
  value,
  onChange,
  options = [],
  placeholder = "--:--",
  ariaLabel,
  className = ""
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const wrap = useRef(null);
  const inputRef = useRef(null);

  // Follow the stored value whenever it changes from outside (loading a saved
  // day, "Mark all present" clearing it) without stomping on live typing.
  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // Scroll the current value into view so a filled field still opens on the
  // right entry rather than at midnight.
  const listRef = useRef(null);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const picked = listRef.current.querySelector('[data-current="true"]');
    if (picked) picked.scrollIntoView({ block: "center" });
  }, [open]);

  const shown = useMemo(() => {
    if (open && draft) {
      const d = timeDigits(draft);
      return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
    }
    return value || "";
  }, [open, draft, value]);

  const commit = (raw) => {
    const next = normalizeTime(raw);
    // An entry that is not a real time is thrown away, leaving the last good
    // value rather than storing a broken one.
    if (next !== null && next !== "") onChange(next);
    setDraft(next || "");
  };

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <div
        className={`flex items-center gap-1 rounded-xl border bg-white pl-3 pr-1.5 transition ${
          open ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200"
        }`}
      >
        <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(timeDigits(e.target.value));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className={`w-full bg-transparent py-2.5 text-sm tabular-nums outline-none ${
            shown ? "text-slate-800" : "text-slate-400"
          }`}
        />
        {shown ? (
          <button
            type="button"
            aria-label="Clear time"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setDraft("");
              inputRef.current?.focus();
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Pick a time"
            aria-expanded={open}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-[11px] text-slate-400">Type a time, e.g. 930</li>
          )}
          {options.map((t) => (
            <li key={t}>
              <button
                type="button"
                data-current={t === value ? "true" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(t);
                  setDraft(t);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm tabular-nums transition hover:bg-indigo-50 hover:text-indigo-700 ${
                  t === value ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700"
                }`}
              >
                <span>{t}</span>
                {t === value && <span className="text-[10px] font-bold uppercase">set</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}