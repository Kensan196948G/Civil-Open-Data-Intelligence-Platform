import { WeatherWorkspace } from "@/components/weather/WeatherWorkspace";

export const metadata = {
  title: "気象・海象",
};

export default function WeatherPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">🌦️ 気象・海象 (WMCDSS 統合)</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          AMeDAS 気象観測・Open-Meteo Marine 参考情報・施工可否判定・現場管理・レポートを一体で提供します。
          <strong> 判定は確認支援であり、施工可否・安全性・法令適合を断定しません。</strong>
        </p>
      </div>
      <WeatherWorkspace initialTab="weather" />
    </div>
  );
}
