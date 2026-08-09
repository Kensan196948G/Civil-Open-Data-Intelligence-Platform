import { WeatherWorkspace } from "@/components/weather/WeatherWorkspace";

export const metadata = {
  title: "現場管理",
};

export default function SitesPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">🚧 現場管理</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          現場の一覧・登録・観測対象設定 (AMeDAS局番等) を管理します。
        </p>
      </div>
      <WeatherWorkspace initialTab="sites" />
    </div>
  );
}
