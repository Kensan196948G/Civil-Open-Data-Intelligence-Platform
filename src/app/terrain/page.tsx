import { TerrainWorkspace } from "@/components/terrain/TerrainWorkspace";

export const metadata = {
  title: "地形分析",
};

export default function TerrainPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">⛰️ 地形分析 (地形・傾斜リスク可視化)</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          国土地理院 DEM 実データから Horn法による傾斜統計・TPI地形分類・断面分析・確認支援カードを計算します。
          <strong> 施工可否・安全性・法令適合は断定しません。最終判断は担当者が行ってください。</strong>
        </p>
      </div>
      <TerrainWorkspace />
    </div>
  );
}
