export interface QualityPanelProps {
  readonly quality: {
    grade: string;
    missingRatio: number;
    warnings: string[];
    sourceMix: Record<string, number>;
  };
  readonly provenance: readonly {
    sourceId: string;
    sourceName: string;
    termsUrl: string;
  }[];
}

export function QualityPanel({ quality, provenance }: QualityPanelProps) {
  const usedSources = Object.keys(quality.sourceMix).filter(
    (source) => quality.sourceMix[source] > 0,
  );
  return (
    <section aria-label="品質と出典" className="rounded-lg border border-[var(--line)] p-3">
      <h4 className="mb-2 mt-0 text-[13px] font-semibold">品質と出典</h4>
      <dl className="m-0 grid grid-cols-1 gap-1 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="text-[var(--muted)]">品質グレード</dt>
          <dd className="m-0 font-mono">{quality.grade}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">欠損率</dt>
          <dd className="m-0 font-mono">{(quality.missingRatio * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">使用ソース</dt>
          <dd className="m-0">
            {usedSources.length > 0
              ? usedSources.map((source) => `${source} (${quality.sourceMix[source]}点)`).join(" / ")
              : "—"}
          </dd>
        </div>
      </dl>
      {quality.warnings.length > 0 ? (
        <ul className="m-2 list-disc pl-5 text-[11.5px] text-[var(--amber)]">
          {quality.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {provenance.length > 0 ? (
        <p className="mb-0 mt-2 text-[11px] text-[var(--muted)]">
          出典:{" "}
          {provenance.map((entry, index) => (
            <span key={entry.sourceId}>
              {index > 0 ? " / " : ""}
              <a href={entry.termsUrl} target="_blank" rel="noreferrer" className="text-[var(--blue)] hover:underline">
                {entry.sourceName}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
