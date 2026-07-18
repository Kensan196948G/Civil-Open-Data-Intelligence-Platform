// デザイン正本の qualityColor と同一の閾値・配色
function qualityColor(score: number): { fg: string; bg: string } {
  if (score >= 80) return { fg: "var(--green)", bg: "var(--green-bg)" };
  if (score >= 60) return { fg: "var(--blue)", bg: "var(--blue-bg)" };
  if (score >= 40) return { fg: "var(--amber)", bg: "var(--amber-bg)" };
  return { fg: "var(--red)", bg: "var(--red-bg)" };
}

export function QualityScoreBadge({ score }: { score: number }) {
  const c = qualityColor(score);
  return (
    <span
      className="dc-badge"
      style={{ color: c.fg, background: c.bg }}
      aria-label={`品質スコア ${score}/100`}
    >
      ⭐ {score}
    </span>
  );
}

export function TrustLevelBadge({ level }: { level: number }) {
  return (
    <span
      className="dc-badge"
      style={{ color: "var(--amber)", background: "transparent", letterSpacing: "1px" }}
      aria-label={`信頼度 ${level}/5`}
    >
      {"★".repeat(level)}
      {"☆".repeat(Math.max(0, 5 - level))}
    </span>
  );
}
