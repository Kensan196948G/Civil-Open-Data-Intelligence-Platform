import { statusLabel } from "@/lib/constants";

// デザイン正本の STATUS_COLORS と同一
const STYLES: Record<string, { fg: string; bg: string; icon: string }> = {
  active: { fg: "var(--green)", bg: "var(--green-bg)", icon: "✅" },
  unstable: { fg: "var(--red)", bg: "var(--red-bg)", icon: "❌" },
  deprecated: { fg: "var(--ink-2)", bg: "var(--subtle)", icon: "🚫" },
  unknown: { fg: "var(--amber)", bg: "var(--amber-bg)", icon: "⚠️" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = STYLES[status] ?? STYLES.unknown;
  return (
    <span className="dc-badge" style={{ color: c.fg, background: c.bg }}>
      {c.icon} {statusLabel(status)}
    </span>
  );
}
