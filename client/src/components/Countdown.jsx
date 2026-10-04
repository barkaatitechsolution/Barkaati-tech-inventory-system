import { useEffect, useState } from "react";

// Ticks down to a wall-clock moment rather than counting seconds itself, so the
// number stays right even when the tab was throttled in the background or the
// machine slept through part of the wait.
export default function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, until - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);

  return (
    <span className="tabular-nums font-bold text-indigo-700">
      {m}m {String(s).padStart(2, "0")}s
    </span>
  );
}