import type { Coordinate, DemSource, Provenance } from "./domain";
import {
  DEFAULT_DEM_PRIORITY,
  GSI_DEM_SOURCES,
  GSI_TERMS_URL,
  GSI_TILE_BASE_URL,
  buildGsiDemTileUrl,
  pointQualityFor,
} from "./adapters";
import { decodeElevation, decodePng, lonLatToTilePixel, rgbAt } from "./geo";
import type { DecodedPng } from "./geo";

/**
 * GSI DEM タイルのブラウザ直取得サンプラー (多点解析用)。
 *
 * サーバ側 adapters/lookupElevation と同じ安全セマンティクスを踏襲する:
 * - 404/204 = そのソースにデータが無い (正当な不在) → 次ソースへ
 * - fetch失敗/5xx/復号失敗 = 不在を断定できない → failed として記録
 *   (値が見つからず failed があるサンプルは「欠損」ではなく「判定不能」)
 *
 * URL は adapters の定数テーブル + 整数タイル座標のみから構築され、ユーザー
 * 入力で行き先を操作できない (SSRF-safe by construction)。地図タイルと同様に
 * ブラウザから GSI へ直接アクセスする (CORS 対応済み・帰属は地図に常設)。
 *
 * タイルは fetch も decode も URL 単位で Promise キャッシュし、多点サンプル時の
 * 二重取得・二重復号を防ぐ。
 */

type TileState =
  | { readonly kind: "ok"; readonly png: DecodedPng }
  | { readonly kind: "absent" }
  | { readonly kind: "failed" };

/** GSI 応答が滞留しても解析全体が固まらないためのタイル取得上限。 */
const TILE_FETCH_TIMEOUT_MS = 15000;

export class DemTileStore {
  private readonly tiles = new Map<string, Promise<TileState>>();
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    // window.fetch はプロパティ経由の呼び出し (this=DemTileStore) だと
    // "Illegal invocation" を投げる。globalThis へ束縛して保持する。
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  get(source: DemSource, x: number, y: number): Promise<TileState> {
    const url = buildGsiDemTileUrl(source, x, y).toString();
    const cached = this.tiles.get(url);
    if (cached !== undefined) {
      return cached;
    }
    const loading = this.load(url);
    this.tiles.set(url, loading);
    return loading;
  }

  private async load(url: string): Promise<TileState> {
    let response: Response;
    try {
      // タイムアウト (abort) は fetch 失敗と同じ「不在を断定できない」扱い。
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
      });
    } catch {
      return { kind: "failed" };
    }
    if (response.status === 404 || response.status === 204) {
      return { kind: "absent" };
    }
    if (!response.ok) {
      return { kind: "failed" };
    }
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { kind: "ok", png: await decodePng(bytes) };
    } catch {
      return { kind: "failed" };
    }
  }
}

export interface SampleOutcome {
  readonly elevationM: number | null;
  /** 値を得たソース。値なしなら null。 */
  readonly source: DemSource | null;
  /** true = 取得失敗があり、不在を断定できない (判定不能)。 */
  readonly failed: boolean;
}

/** 1座標をソース優先度順に解決する。 */
export async function sampleElevation(
  store: DemTileStore,
  coordinate: Coordinate,
  priority: readonly DemSource[] = DEFAULT_DEM_PRIORITY,
): Promise<SampleOutcome> {
  let failed = false;
  for (const source of priority) {
    const spec = GSI_DEM_SOURCES[source];
    const { tile, px, py } = lonLatToTilePixel(coordinate.lon, coordinate.lat, spec.zoom);
    const state = await store.get(source, tile.x, tile.y);
    if (state.kind === "failed") {
      failed = true;
      continue;
    }
    if (state.kind === "absent") {
      continue;
    }
    let elevationM: number | null;
    try {
      elevationM = decodeElevation(...rgbAt(state.png, px, py));
    } catch {
      // タイルは取得できたが画素参照に失敗 (想定外の寸法など上流異常)。
      // 1タイルの異常で解析全体を落とさず、不在を断定できない failed とする。
      failed = true;
      continue;
    }
    if (elevationM === null) {
      continue; // No-data sentinel — 次のソースへ。
    }
    return { elevationM, source, failed: false };
  }
  return { elevationM: null, source: null, failed };
}

export interface SampleSetSummary {
  readonly total: number;
  readonly valid: number;
  /** 値なしかつ取得失敗も無い (真の不在)。 */
  readonly absent: number;
  /** 値なしで取得失敗あり (不在を断定できない)。 */
  readonly failed: number;
  readonly sourceMix: Readonly<Record<DemSource, number>>;
  readonly usedSources: readonly DemSource[];
}

export function summarizeSamples(outcomes: readonly SampleOutcome[]): SampleSetSummary {
  const sourceMix: Record<DemSource, number> = {
    DEM1A: 0,
    DEM5A: 0,
    DEM5B: 0,
    DEM5C: 0,
    DEM10B: 0,
  };
  let valid = 0;
  let absent = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.elevationM !== null && outcome.source !== null) {
      valid++;
      sourceMix[outcome.source]++;
    } else if (outcome.failed) {
      failed++;
    } else {
      absent++;
    }
  }
  const usedSources = (Object.keys(sourceMix) as DemSource[]).filter((s) => sourceMix[s] > 0);
  return { total: outcomes.length, valid, absent, failed, sourceMix, usedSources };
}

const GRADE_ORDER = ["A", "B", "C", "D"] as const;

/** 使用ソースの中で最も低い (保守的な) グレードを返す。 */
export function worstGradeOf(sources: readonly DemSource[]): "A" | "B" | "C" | "D" | "UNKNOWN" {
  let worst: "A" | "B" | "C" | "D" | null = null;
  for (const source of sources) {
    const grade = pointQualityFor(source).grade;
    if (grade === "UNKNOWN") {
      return "UNKNOWN";
    }
    if (worst === null || GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(worst)) {
      worst = grade;
    }
  }
  return worst ?? "UNKNOWN";
}

/** エリア/断面解析の代表出典 (ソース単位)。個別タイルURLではなくベースを示す。 */
export function provenanceFor(sources: readonly DemSource[], retrievedAt: string): Provenance[] {
  return sources.map((source) => {
    const spec = GSI_DEM_SOURCES[source];
    return {
      sourceId: `gsi_${spec.path}`,
      sourceName: spec.name,
      sourceUrl: `${GSI_TILE_BASE_URL}${spec.path}/`,
      termsUrl: GSI_TERMS_URL,
      retrievedAt,
      resolutionM: spec.resolutionM,
      processed: true,
      processingNote: "GSI標高タイルPNGをspec 8.2の式で標高値へ復号し、多点サンプリング",
    };
  });
}
