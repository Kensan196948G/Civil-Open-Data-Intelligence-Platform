import { statusLabel } from "@/lib/constants";

const STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  unstable: "bg-red-100 text-red-800",
  deprecated: "bg-gray-200 text-gray-600",
  unknown: "bg-amber-100 text-amber-800",
};

const ICONS: Record<string, string> = {
  active: "✅",
  unstable: "❌",
  deprecated: "🚫",
  unknown: "⚠️",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.unknown}`}
    >
      {ICONS[status] ?? "⚠️"} {statusLabel(status)}
    </span>
  );
}
