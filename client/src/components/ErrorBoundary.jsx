import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// A render error in one page must not leave the shop staring at a blank screen.
// This boundary keeps the message short and offers the only safe action: reload
// the app (saved data is in PostgreSQL, not in the crashed component).
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("UI crashed:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl ring-1 ring-slate-200">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">Something went wrong</h1>
          <p className="mt-1 text-sm text-slate-500">
            This screen hit an unexpected error. Your saved data is safe — reload to continue.
          </p>
          <p className="mt-3 max-h-24 overflow-auto rounded-lg bg-slate-50 p-2 text-left text-[11px] text-slate-500">
            {String(error?.message || error)}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700"
          >
            <RefreshCw className="h-4 w-4" />
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
