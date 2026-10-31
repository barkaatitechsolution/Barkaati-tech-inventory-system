export default function Card({ children, className = "", ...props }) {
  return (
    <div
      className={`min-w-0 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}