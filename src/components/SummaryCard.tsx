export function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: string;
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">
        {icon} {label}
      </div>
      <div className={`mt-1 text-3xl font-bold ${accent ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}
