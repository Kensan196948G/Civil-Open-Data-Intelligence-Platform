import { WeatherWorkspace } from "@/components/weather/WeatherWorkspace";

export const metadata = {
  title: "レポート",
};

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">📊 レポート</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          日次・週次・月次・判定履歴・海象・年次レポートを CSV / Markdown で出力します。
        </p>
      </div>
      <WeatherWorkspace initialTab="reports" />
    </div>
  );
}
