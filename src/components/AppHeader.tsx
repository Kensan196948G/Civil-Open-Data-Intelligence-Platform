"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

// デザイン正本の VIEW_META と同一
const VIEW_META: { prefix: string; exact?: boolean; title: string; sub: string }[] = [
  { prefix: "/", exact: true, title: "🏠 ダッシュボード", sub: "登録データソースの状況を一目で確認" },
  { prefix: "/sources/new", title: "➕ データソース新規登録", sub: "公開データ・公開APIを台帳に追加" },
  { prefix: "/sources", title: "📚 データソース一覧", sub: "公開データ・公開APIを検索・絞り込み" },
  { prefix: "/map", title: "🗺️ 地図表示", sub: "地理院タイル・標高取得" },
  { prefix: "/logs", title: "🧾 取得ログ一覧", sub: "接続確認・サンプル取得の実行履歴" },
  { prefix: "/audit", title: "🔍 監査ログ", sub: "操作・イベントの証跡とエクスポート" },
  { prefix: "/tags", title: "🏷️ タグ管理", sub: "データソースの分類タグを管理" },
  { prefix: "/settings", title: "⚙️ 設定", sub: "接続確認の動作設定とセキュリティ制約" },
  // AppSidebar が持つルートは必ずここにも入れる。metaFor() は該当が無いと
  // VIEW_META[0]（ダッシュボード）へ落ちるため、抜けると別画面のタイトルが出る。
  // 対応は tests/unit/app-header-routes.test.ts が強制する。
  { prefix: "/terrain", title: "⛰️ 地形分析", sub: "標高・傾斜・縦断からの現場条件評価" },
  { prefix: "/weather", title: "🌦️ 気象・海象", sub: "観測値・予報と閾値による作業条件の確認" },
  { prefix: "/sites", title: "🚧 現場管理", sub: "現場マスタと観測地点の対応づけ" },
  { prefix: "/decisions", title: "🧭 施工可否判定", sub: "閾値と観測値にもとづく判断と根拠の記録" },
  { prefix: "/reports", title: "📊 レポート", sub: "期間・現場を指定した集計と出力" },
  { prefix: "/watchlist", title: "🔔 ウォッチリスト", sub: "現場・データソースの変化を追跡" },
];

function metaFor(pathname: string) {
  if (pathname === "/") return VIEW_META[0];
  if (/^\/sources\/[^/]+\/edit$/.test(pathname))
    return { title: "✏️ データソース編集", sub: "登録内容を更新" };
  if (/^\/sources\/[^/]+$/.test(pathname) && pathname !== "/sources/new")
    return { title: "📄 データソース詳細", sub: "接続確認・品質評価・取得ログ" };
  const hit = VIEW_META.find((m) => (m.exact ? pathname === m.prefix : pathname.startsWith(m.prefix)));
  return hit ?? VIEW_META[0];
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const meta = metaFor(pathname);

  function submitSearch() {
    const q = query.trim();
    router.push(q ? `/sources?q=${encodeURIComponent(q)}` : "/sources");
  }

  return (
    <header className="flex h-[62px] flex-shrink-0 items-center gap-4 border-b border-[var(--line)] bg-white px-[22px]">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold leading-[1.2] text-[var(--ink)]">{meta.title}</div>
        <div className="truncate text-[11.5px] text-[var(--muted)]">{meta.sub}</div>
      </div>
      <div className="min-w-2 flex-1"></div>
      {/* focus-within で入力フォーカスをコンテナ側に可視化する (CodeRabbit a11y 指摘対応)。
          リング色は白背景に対し 3:1 以上のコントラストを持つ --accent-d を使う */}
      <div className="flex min-w-0 max-w-[240px] flex-shrink items-center gap-[7px] rounded-lg border border-[var(--line)] bg-[var(--subtle)] px-[11px] py-[7px] text-[var(--muted)] focus-within:border-[var(--accent-d)] focus-within:shadow-[0_0_0_2px_var(--accent-d)]">
        <span aria-hidden="true">🔍</span>
        <input
          aria-label="データソースを検索"
          className="w-full min-w-0 border-none bg-transparent text-[12.5px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] lg:w-[190px]"
          placeholder="データソースを検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
          }}
        />
      </div>
      <div className="hidden items-center gap-[6px] rounded-[7px] bg-[var(--green-bg)] px-[10px] py-[6px] text-xs font-semibold text-[var(--green)] md:flex">
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] rounded-full bg-[var(--green-2)] shadow-[0_0_0_3px_rgba(46,158,107,0.18)]"
        ></span>
        公開データのみ
      </div>
    </header>
  );
}
