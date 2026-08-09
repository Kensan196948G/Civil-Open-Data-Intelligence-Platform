/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 気象・海象・施工判定のデモシード (統合: wmcdss db/migrations/0002_seed_demo.sql)。
 * 東京湾周辺のデモ現場6件と、コンクリート/クレーン/海上揚重/潜水/海上輸送の
 * 既定閾値を登録する。実行は冪等。
 */

export type SeedPrisma = {
  constructionSite: { upsert(args: any): Promise<any> };
  weatherThreshold: { upsert(args: any): Promise<any> };
};

const DEMO_SITES = [
  { code: "TYO-01", name: "東京港臨海現場", kind: "marine", lat: 35.645, lon: 139.77, jmaStationId: "44132", address: "東京都港区" },
  { code: "TYO-02", name: "羽田D滑走路工事", kind: "marine", lat: 35.5494, lon: 139.7798, jmaStationId: "44132", address: "東京都大田区" },
  { code: "TYO-03", name: "横浜本牧埠頭改修", kind: "marine", lat: 35.4225, lon: 139.681, jmaStationId: "46106", address: "神奈川県横浜市中区" },
  { code: "TYO-04", name: "千葉袖ケ浦海上工事", kind: "marine", lat: 35.415, lon: 139.952, jmaStationId: "45148", address: "千葉県袖ケ浦市" },
  { code: "TYO-05", name: "木更津陸上ヤード", kind: "land", lat: 35.3792, lon: 139.92, jmaStationId: "45148", address: "千葉県木更津市" },
  { code: "TYO-06", name: "川崎港岸壁築造", kind: "both", lat: 35.518, lon: 139.716, jmaStationId: "44132", address: "神奈川県川崎市" },
] as const;

const DEFAULT_THRESHOLDS = [
  { workType: "concrete", metric: "precipMm1h", op: ">=", value: 3, severity: "warn", note: "コンクリート打設: 1時間降雨 3mm 以上で注意" },
  { workType: "concrete", metric: "precipMm1h", op: ">=", value: 10, severity: "stop", note: "コンクリート打設: 1時間降雨 10mm 以上で中止推奨" },
  { workType: "concrete", metric: "temperatureC", op: "<", value: 4, severity: "warn", note: "コンクリート打設: 4℃未満で養生条件注意" },
  { workType: "concrete", metric: "temperatureC", op: ">=", value: 30, severity: "warn", note: "コンクリート打設: 30℃以上で暑中コンクリート対応" },
  { workType: "crane", metric: "windSpeedMs", op: ">=", value: 10, severity: "warn", note: "クレーン作業: 平均風速 10m/s 以上で注意" },
  { workType: "crane", metric: "windSpeedMs", op: ">=", value: 15, severity: "stop", note: "クレーン作業: 平均風速 15m/s 以上で中止" },
  { workType: "marineLift", metric: "sigWaveHM", op: ">=", value: 1, severity: "warn", note: "海上揚重: 有義波高 1.0m 以上で注意" },
  { workType: "marineLift", metric: "sigWaveHM", op: ">=", value: 1.5, severity: "stop", note: "海上揚重: 有義波高 1.5m 以上で中止" },
  { workType: "marineLift", metric: "windSpeedMs", op: ">=", value: 12, severity: "stop", note: "海上揚重: 風速 12m/s 以上で中止" },
  { workType: "marineDive", metric: "sigWaveHM", op: ">=", value: 0.5, severity: "stop", note: "潜水作業: 有義波高 0.5m 以上で中止" },
  { workType: "marineTransport", metric: "sigWaveHM", op: ">=", value: 2, severity: "stop", note: "海上輸送: 有義波高 2.0m 以上で中止" },
] as const;

export async function seedWeatherDemo(prisma: SeedPrisma): Promise<void> {
  for (const site of DEMO_SITES) {
    await prisma.constructionSite.upsert({
      where: { code: site.code },
      update: { name: site.name, kind: site.kind, lat: site.lat, lon: site.lon, jmaStationId: site.jmaStationId, address: site.address },
      create: { code: site.code, name: site.name, kind: site.kind, lat: site.lat, lon: site.lon, jmaStationId: site.jmaStationId, address: site.address },
    });
  }
  for (const t of DEFAULT_THRESHOLDS) {
    const id = `seed-threshold-${t.workType}-${t.metric}-${t.op}-${t.value}`;
    await prisma.weatherThreshold.upsert({
      where: { id },
      update: { value: t.value, severity: t.severity, note: t.note },
      create: { id, siteId: null, workType: t.workType, metric: t.metric, op: t.op, value: t.value, severity: t.severity, note: t.note },
    });
  }
}
