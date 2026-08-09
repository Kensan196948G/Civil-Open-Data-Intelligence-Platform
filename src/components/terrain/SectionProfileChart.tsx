import type { ProfileSample } from "@/lib/terrain/geo";

export interface SectionProfileChartProps {
  readonly samples: readonly ProfileSample[];
}

const VIEW_W = 380;
const VIEW_H = 190;
const PAD_TOP = 12;
const PAD_BOTTOM = 14;

export function SectionProfileChart({ samples }: SectionProfileChartProps) {
  const valid = samples.filter(
    (sample): sample is ProfileSample & { elevationM: number } => sample.elevationM !== null,
  );
  const first = samples[0];
  const last = samples[samples.length - 1];
  const totalLength = first !== undefined && last !== undefined ? last.distanceM - first.distanceM : 0;

  if (valid.length === 0 || totalLength <= 0) {
    return <p className="m-0 text-[12px] text-[var(--muted)]">描画できる有効サンプルがありません (判定不能)。</p>;
  }

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const sample of valid) {
    if (sample.elevationM < minElev) minElev = sample.elevationM;
    if (sample.elevationM > maxElev) maxElev = sample.elevationM;
  }
  const span = Math.max(maxElev - minElev, 1);

  const xOf = (distanceM: number): number => (distanceM / totalLength) * VIEW_W;
  const yOf = (elevationM: number): number =>
    VIEW_H - PAD_BOTTOM - ((elevationM - minElev) / span) * (VIEW_H - PAD_TOP - PAD_BOTTOM);

  const segments: string[] = [];
  let current: string[] = [];
  for (const sample of samples) {
    if (sample.elevationM === null) {
      if (current.length > 1) {
        segments.push(current.join(" "));
      }
      current = [];
      continue;
    }
    current.push(`${xOf(sample.distanceM).toFixed(1)},${yOf(sample.elevationM).toFixed(1)}`);
  }
  if (current.length > 1) {
    segments.push(current.join(" "));
  }

  const hasGap = valid.length !== samples.length;
  const description =
    `始点から${totalLength >= 1000 ? `${(totalLength / 1000).toFixed(2)}km` : `${totalLength.toFixed(0)}m`}の断面。` +
    `標高 ${minElev.toFixed(0)}m〜${maxElev.toFixed(0)}m。` +
    (hasGap ? " 一部区間はデータ欠損のため描画していません。" : "");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`断面プロファイル。${description}`}
        className="h-auto w-full"
      >
        <line x1="0" y1={VIEW_H - PAD_BOTTOM} x2={VIEW_W} y2={VIEW_H - PAD_BOTTOM} stroke="var(--line)" />
        {segments.map((points) => (
          <polyline key={points} points={points} fill="none" stroke="var(--blue)" strokeWidth="2" />
        ))}
      </svg>
      <figcaption className="text-[11px] text-[var(--muted)]">
        {description}
        {hasGap ? <strong> 欠損区間は安全を意味しません。</strong> : null}
      </figcaption>
    </figure>
  );
}
