import { Component } from "react";
import { AlertTriangle } from "lucide-react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Store UI crashed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl ring-1 ring-slate-200/70">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-900">Something went wrong</h1>
            <p className="mt-1 text-sm text-slate-500">
              The page could not be displayed. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
