import { MapPanel } from "@/components/MapPanel";

export const metadata = {
  title: "地図表示",
};

// デザイン正本 (map view: 3007-3160 行) と同一。出典表記は MapView 側 (地図直下) に置く
export default function MapPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">🗺️ 地図表示</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          OpenStreetMapによる地図表示。地図をクリックすると標高の目安を表示します（シミュレーション値）。
        </p>
      </div>
      <MapPanel />
    </div>
  );
}
