"use client";

import dynamic from "next/dynamic";

// Leaflet は window に依存するため SSR を無効化して読み込む
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] text-[12.5px] text-[var(--muted)]">
      ⏳ 地図を読み込み中...
    </div>
  ),
});

export function MapPanel() {
  return <MapView />;
}
