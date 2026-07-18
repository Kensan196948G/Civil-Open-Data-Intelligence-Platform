import Link from "next/link";
import { ERROR_TYPE_MESSAGES } from "@/lib/constants";

export type FetchLogRow = {
  id: string;
  executedAt: Date;
  executionType: string;
  requestUrl: string;
  statusCode: number | null;
  success: boolean;
  responseTimeMs: number | null;
  responseSizeBytes: number | null;
  errorType: string | null;
  errorMessage: string | null;
  dataSource?: { id: string; name: string } | null;
};

export function FetchLogTable({ logs, showSource = true }: { logs: FetchLogRow[]; showSource?: boolean }) {
  if (logs.length === 0) {
    return <p className="py-4 text-sm text-[var(--muted)]">🧾 取得ログはまだありません。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-[12.5px]">
        <caption className="sr-only">取得ログ一覧</caption>
        <thead>
          <tr>
            <th scope="col" className="dc-th">実行日時</th>
            {showSource && <th scope="col" className="dc-th">データソース</th>}
            <th scope="col" className="dc-th">種別</th>
            <th scope="col" className="dc-th">結果</th>
            <th scope="col" className="dc-th">HTTP</th>
            <th scope="col" className="dc-th">応答(ms)</th>
            <th scope="col" className="dc-th">サイズ</th>
            <th scope="col" className="dc-th">エラー</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-[var(--hover)]">
              <th scope="row" className="dc-td whitespace-nowrap text-left font-normal tabular-nums">
                {new Date(log.executedAt).toLocaleString("ja-JP")}
              </th>
              {showSource && (
                <td className="dc-td">
                  {log.dataSource ? (
                    <Link href={`/sources/${log.dataSource.id}`} className="text-[var(--blue)] hover:underline">
                      {log.dataSource.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
              )}
              <td className="dc-td">{log.executionType === "sample" ? "📦 サンプル" : "🔌 疎通"}</td>
              <td className="dc-td font-semibold" style={{ color: log.success ? "var(--green)" : "var(--red)" }}>
                {log.success ? "✅ 成功" : "❌ 失敗"}
              </td>
              <td className="dc-td tabular-nums">{log.statusCode ?? "-"}</td>
              <td className="dc-td tabular-nums">{log.responseTimeMs ?? "-"}</td>
              <td className="dc-td tabular-nums">{formatBytes(log.responseSizeBytes)}</td>
              <td className="dc-td text-[11px] text-[var(--red)]">
                {log.errorType ? (ERROR_TYPE_MESSAGES[log.errorType] ?? log.errorType) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
