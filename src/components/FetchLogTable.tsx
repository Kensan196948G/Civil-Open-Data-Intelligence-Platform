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
    return <p className="py-4 text-sm text-slate-500">🧾 取得ログはまだありません。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <caption className="sr-only">取得ログ一覧</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th scope="col" className="px-2 py-2">実行日時</th>
            {showSource && <th scope="col" className="px-2 py-2">データソース</th>}
            <th scope="col" className="px-2 py-2">種別</th>
            <th scope="col" className="px-2 py-2">結果</th>
            <th scope="col" className="px-2 py-2">HTTP</th>
            <th scope="col" className="px-2 py-2">応答(ms)</th>
            <th scope="col" className="px-2 py-2">サイズ</th>
            <th scope="col" className="px-2 py-2">エラー</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
              <th scope="row" className="px-2 py-2 text-left whitespace-nowrap">
                {new Date(log.executedAt).toLocaleString("ja-JP")}
              </th>
              {showSource && (
                <td className="px-2 py-2">
                  {log.dataSource ? (
                    <Link href={`/sources/${log.dataSource.id}`} className="text-blue-600 hover:underline">
                      {log.dataSource.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
              )}
              <td className="px-2 py-2">{log.executionType === "sample" ? "📦 サンプル" : "🔌 疎通"}</td>
              <td className="px-2 py-2">{log.success ? "✅ 成功" : "❌ 失敗"}</td>
              <td className="px-2 py-2">{log.statusCode ?? "-"}</td>
              <td className="px-2 py-2">{log.responseTimeMs ?? "-"}</td>
              <td className="px-2 py-2">{formatBytes(log.responseSizeBytes)}</td>
              <td className="px-2 py-2 text-xs text-red-600">
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
