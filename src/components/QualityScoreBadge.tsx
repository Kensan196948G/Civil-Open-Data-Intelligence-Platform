export function QualityScoreBadge({ score }: { score: number }) {
  const style =
    score >= 80
      ? "bg-green-100 text-green-800"
      : score >= 60
        ? "bg-blue-100 text-blue-800"
        : score >= 40
          ? "bg-amber-100 text-amber-800"
          : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      ⭐ {score}
    </span>
  );
}

export function TrustLevelBadge({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
      {"★".repeat(level)}
      {"☆".repeat(Math.max(0, 5 - level))}
    </span>
  );
}
