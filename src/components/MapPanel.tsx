"use client";

import dynamic from "next/dynamic";

// Leaflet は window に依存するため SSR を無効化して読み込む
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500">
      ⏳ 地図を読み込み中...
    </div>
  ),
});

export function MapPanel() {
  return <MapView />;
}
