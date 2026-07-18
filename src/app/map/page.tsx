import { MapPanel } from "@/components/MapPanel";

export const metadata = {
  title: "地図表示 | Civil Open Data Intelligence Platform",
};

export default function MapPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">🗺️ 地図表示</h1>
        <p className="mt-1 text-sm text-slate-500">
          地理院タイルによる地図表示。地図をクリックすると標高を取得します（台帳登録済みの国土地理院
          標高API経由）。
        </p>
      </div>
      <MapPanel />
      <p className="text-xs text-slate-600">
        🏷️ 出典: 地図タイル・標高データは
        <a
          href="https://maps.gsi.go.jp/development/ichiran.html"
          target="_blank"
          rel="noopener noreferrer"
          className="mx-1 text-blue-500 hover:underline"
        >
          国土地理院
        </a>
        のコンテンツを利用しています（国土地理院コンテンツ利用規約に基づく出典表記）。
      </p>
    </div>
  );
}
