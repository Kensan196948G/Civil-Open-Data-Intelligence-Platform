import { MapPanel } from "@/components/MapPanel";

export const metadata = {
  title: "地図表示",
};

export default function MapPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">🗺️ 地図表示</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          地理院タイルによる地図表示。地図をクリックすると標高を取得します（台帳登録済みの国土地理院
          標高API経由）。
        </p>
      </div>
      <MapPanel />
      <p className="text-[11px] text-[var(--faint)]">
        🏷️ 出典: 地図タイル・標高データは
        <a
          href="https://maps.gsi.go.jp/development/ichiran.html"
          target="_blank"
          rel="noopener noreferrer"
          className="mx-1 text-[var(--blue)] hover:underline"
        >
          国土地理院
        </a>
        のコンテンツを利用しています（国土地理院コンテンツ利用規約に基づく出典表記）。
      </p>
    </div>
  );
}
