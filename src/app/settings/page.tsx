import { FETCH_TIMEOUT_MS, MAX_REDIRECTS, PREVIEW_MAX_BYTES, STALE_CHECK_DAYS } from "@/lib/constants";
import { AdminTokenPanel } from "@/components/AdminTokenPanel";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">⚙️ 設定</h1>

      <AdminTokenPanel />

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">🔧 接続確認の動作設定</h2>
        <table className="text-sm">
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-8 text-slate-500">⏱ タイムアウト</td>
              <td className="py-2">{FETCH_TIMEOUT_MS / 1000} 秒</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-8 text-slate-500">🔁 リダイレクト上限</td>
              <td className="py-2">{MAX_REDIRECTS} 回</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pr-8 text-slate-500">📦 プレビュー保存上限</td>
              <td className="py-2">{PREVIEW_MAX_BYTES / 1024} KB</td>
            </tr>
            <tr>
              <td className="py-2 pr-8 text-slate-500">⚠️ 要確認となる未確認期間</td>
              <td className="py-2">{STALE_CHECK_DAYS} 日</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">🔑 APIキーの設定方法</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>プロジェクトルートの <code className="rounded bg-slate-100 px-1">.env</code> ファイルを開く</li>
          <li>
            データソースに設定した環境変数名でキーを記載する（例:{" "}
            <code className="rounded bg-slate-100 px-1">ESTAT_APP_ID=&quot;取得したID&quot;</code>）
          </li>
          <li>開発サーバを再起動する</li>
        </ol>
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          🚫 APIキーの値は画面に表示されず、DB・ログにも保存されません。
          <code className="mx-1">.env</code> は絶対に GitHub へコミットしないでください。
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">🛡️ セキュリティ制約</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>取得対象は登録済みデータソースのURLのみ（任意URL取得は不可）</li>
          <li>localhost・private IP・内部ドメインへのアクセスは拒否</li>
          <li>http / https 以外のスキームは拒否</li>
          <li>リダイレクト先も同じ検証を通過したもののみ追従</li>
        </ul>
      </div>
    </div>
  );
}
