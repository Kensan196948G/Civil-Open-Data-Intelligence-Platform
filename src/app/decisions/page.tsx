import { WeatherWorkspace } from "@/components/weather/WeatherWorkspace";

export const metadata = {
  title: "施工可否判定",
};

export default function DecisionsPage() {
  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">🧭 施工可否判定</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          コンクリート打設・海上作業などの施工可否を、観測値と閾値ルールから go / caution / stop で提示します。
        </p>
      </div>
      <WeatherWorkspace initialTab="decision" />
    </div>
  );
}
