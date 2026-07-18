import { FETCH_TIMEOUT_MS, MAX_REDIRECTS, PREVIEW_MAX_BYTES, STALE_CHECK_DAYS } from "@/lib/constants";
import { AdminTokenPanel } from "@/components/AdminTokenPanel";

export default function SettingsPage() {
  return (
    <div className="flex max-w-[640px] flex-col gap-[14px]">
      <h1 className="m-0 text-[1.4rem] font-semibold">⚙️ 設定</h1>

      <AdminTokenPanel />

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">🔧 接続確認の動作設定</h2>
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
          <table className="w-full border-collapse text-left">
            <tbody>
              <tr>
                <th scope="row" className="dc-th w-[55%]">
                  ⏱ タイムアウト
                </th>
                <td className="dc-td text-[var(--ink)]">{FETCH_TIMEOUT_MS / 1000} 秒</td>
              </tr>
              <tr>
                <th scope="row" className="dc-th">
                  🔁 リダイレクト上限
                </th>
                <td className="dc-td text-[var(--ink)]">{MAX_REDIRECTS} 回</td>
              </tr>
              <tr>
                <th scope="row" className="dc-th">
                  📦 プレビュー保存上限
                </th>
                <td className="dc-td text-[var(--ink)]">{PREVIEW_MAX_BYTES / 1024} KB</td>
              </tr>
              <tr>
                <th scope="row" className="dc-th">
                  ⚠️ 要確認となる未確認期間
                </th>
                <td className="dc-td text-[var(--ink)]">{STALE_CHECK_DAYS} 日</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">🔑 APIキーの設定方法</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-[var(--ink-2)]">
          <li>
            プロジェクトルートの{" "}
            <code className="rounded bg-[var(--subtle)] px-1 font-mono text-[12px]">.env</code>{" "}
            ファイルを開く
          </li>
          <li>
            データソースに設定した環境変数名でキーを記載する（例:{" "}
            <code className="rounded bg-[var(--subtle)] px-1 font-mono text-[12px]">
              ESTAT_APP_ID=&quot;取得したID&quot;
            </code>
            ）
          </li>
          <li>開発サーバを再起動する</li>
        </ol>
        <p className="mt-3 rounded-lg bg-[var(--red-bg)] px-3 py-2.5 text-[11.5px] text-[var(--red)]">
          🚫 APIキーの値は画面に表示されず、DB・ログにも保存されません。
          <code className="mx-1 font-mono">.env</code> は絶対に GitHub へコミットしないでください。
        </p>
      </div>

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">🛡️ セキュリティ制約</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-[var(--ink-2)]">
          <li>取得対象は登録済みデータソースのURLのみ（任意URL取得は不可）</li>
          <li>localhost・private IP・内部ドメインへのアクセスは拒否</li>
          <li>http / https 以外のスキームは拒否</li>
          <li>リダイレクト先も同じ検証を通過したもののみ追従</li>
        </ul>
      </div>
    </div>
  );
}
