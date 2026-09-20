import { Hammer } from "lucide-react";
import Card from "./Card.jsx";

export default function Placeholder({ title, description, features, icon: Icon }) {
  return (
    <div className="animate-fade-up">
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
          <Icon className="h-8 w-8 text-white" />
        </div>
        <h2 className="mt-5 text-xl font-bold text-slate-900">{title}</h2>
        <p className="mt-1.5 max-w-md text-sm text-slate-500">{description}</p>
        <div className="mt-6 flex max-w-lg flex-wrap items-center justify-center gap-2">
          {features.map((f) => (
            <span
              key={f}
              className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
            >
              {f}
            </span>
          ))}
        </div>
        <div className="mt-8 flex items-center gap-2 text-xs font-medium text-slate-400">
          <Hammer className="h-4 w-4" />
          This module is next in the build queue — the dashboard is ready now.
        </div>
      </Card>
    </div>
  );
}