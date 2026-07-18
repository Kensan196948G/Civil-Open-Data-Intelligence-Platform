// デザイン正本の KPI カード (kpis) と同一構成:
// 上段: ラベル + カラードット / 中段: 28px 数値 / 下段: 色付きサブテキスト
export function SummaryCard({
  label,
  value,
  dot,
  sub,
  subColor,
}: {
  label: string;
  value: number | string;
  dot: string;
  sub: string;
  subColor: string;
}) {
  return (
    <div className="dc-card flex flex-col gap-[7px] px-[17px] py-4">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-[var(--muted)]">{label}</span>
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-[3px]"
          style={{ background: dot }}
        ></span>
      </div>
      <div className="text-[28px] font-semibold leading-none tracking-[-0.5px] text-[var(--ink)] tabular-nums">
        {value}
      </div>
      <div className="text-[11px] font-medium" style={{ color: subColor }}>
        {sub}
      </div>
    </div>
  );
}
