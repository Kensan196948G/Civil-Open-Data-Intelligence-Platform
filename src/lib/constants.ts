export const CATEGORIES = [
  { value: "gis", label: "国土・GIS" },
  { value: "3d-city", label: "3D都市" },
  { value: "road", label: "道路" },
  { value: "map-elevation", label: "地図・標高" },
  { value: "weather", label: "気象・防災" },
  { value: "statistics", label: "統計" },
  { value: "map", label: "地図情報" },
  { value: "municipality", label: "自治体" },
  { value: "research", label: "研究" },
  { value: "construction", label: "建設関連" },
] as const;

export const DATA_FORMATS = [
  "JSON",
  "XML",
  "CSV",
  "GeoJSON",
  "HTML",
  "PDF",
  "CityGML",
  "PNG",
  "Shapefile",
  "other",
] as const;

export const ACCESS_TYPES = ["API", "download", "tile", "web", "manual"] as const;

export const SOURCE_STATUSES = [
  { value: "active", label: "接続成功" },
  { value: "unstable", label: "接続不安定" },
  { value: "deprecated", label: "非推奨" },
  { value: "unknown", label: "未確認" },
] as const;

export const COMMERCIAL_USE_OPTIONS = [
  { value: "allowed", label: "商用利用可" },
  { value: "restricted", label: "制限あり" },
  { value: "unknown", label: "要確認" },
] as const;

export const ERROR_TYPE_MESSAGES: Record<string, string> = {
  timeout: "接続がタイムアウトしました",
  network: "ネットワーク接続に失敗しました",
  invalid_url: "URL形式が正しくありません",
  auth_required: "APIキーまたは認証が必要です",
  parse_error: "レスポンス形式を判定できませんでした",
  rate_limited: "アクセス制限の可能性があります",
  blocked_url: "取得が許可されていないURLです",
  unsupported_runtime: "この実行環境では安全な外部取得を実行できません",
  unknown: "不明なエラーが発生しました",
};

/** 接続確認のタイムアウト (30秒) */
export const FETCH_TIMEOUT_MS = 30_000;
/** リダイレクト回数上限 */
export const MAX_REDIRECTS = 3;
/** サンプルプレビュー保存上限 (バイト) */
export const PREVIEW_MAX_BYTES = 4_096;
/** レスポンス読み込み上限 (バイト)。これを超えたら打ち切る */
export const READ_LIMIT_BYTES = 512 * 1024;
/** 最終確認日がこの日数を超えたら要確認 */
export const STALE_CHECK_DAYS = 90;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function statusLabel(value: string): string {
  return SOURCE_STATUSES.find((s) => s.value === value)?.label ?? value;
}
