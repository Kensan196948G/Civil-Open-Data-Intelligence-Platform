import { prisma } from "@/lib/db";
import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  PREVIEW_MAX_BYTES,
  STALE_CHECK_DAYS,
} from "@/lib/constants";
import { TtlCache } from "@/lib/ttl-cache";

/**
 * 接続確認の動作設定 (デザイン正本 settings view と同一の4項目)。
 * 値は app_settings テーブルへ永続化し、未設定時は src/lib/constants の
 * 既定値へフォールバックする。選択肢はデザイン正本のセレクトと同一で、
 * それ以外の値は保存・採用のいずれも拒否する。
 */
export type OperationSettings = {
  timeoutSec: number;
  redirectLimit: number;
  previewKb: number;
  staleDays: number;
};

type OperationSettingDef = {
  label: string;
  unit: string;
  options: readonly number[];
  defaultValue: number;
};

export const OPERATION_SETTING_DEFS: Record<keyof OperationSettings, OperationSettingDef> = {
  timeoutSec: {
    label: "タイムアウト",
    unit: "秒",
    options: [10, 30, 60, 120],
    defaultValue: FETCH_TIMEOUT_MS / 1000,
  },
  redirectLimit: {
    label: "リダイレクト上限",
    unit: "回",
    options: [0, 1, 3, 5],
    defaultValue: MAX_REDIRECTS,
  },
  previewKb: {
    label: "プレビュー保存上限",
    unit: "KB",
    options: [1, 4, 8, 16],
    defaultValue: PREVIEW_MAX_BYTES / 1024,
  },
  staleDays: {
    label: "要確認となる未確認期間",
    unit: "日",
    options: [30, 60, 90, 180],
    defaultValue: STALE_CHECK_DAYS,
  },
};

export type OperationSettingKey = keyof OperationSettings;

export function isOperationSettingKey(key: string): key is OperationSettingKey {
  return Object.hasOwn(OPERATION_SETTING_DEFS, key);
}

/** 選択肢に含まれる値のみ受理する。不正値は null */
export function parseOperationSettingValue(key: OperationSettingKey, raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) return null;
  return OPERATION_SETTING_DEFS[key].options.includes(value) ? value : null;
}

export function defaultOperationSettings(): OperationSettings {
  return {
    timeoutSec: OPERATION_SETTING_DEFS.timeoutSec.defaultValue,
    redirectLimit: OPERATION_SETTING_DEFS.redirectLimit.defaultValue,
    previewKb: OPERATION_SETTING_DEFS.previewKb.defaultValue,
    staleDays: OPERATION_SETTING_DEFS.staleDays.defaultValue,
  };
}

const CACHE_KEY = "operation-settings";
const settingsCache = new TtlCache<OperationSettings>(1, 10_000);

export function invalidateOperationSettingsCache(): void {
  // TtlCache に delete API はないため、即時失効値で上書きする
  settingsCache.set(CACHE_KEY, defaultOperationSettings(), Number.NEGATIVE_INFINITY);
}

/**
 * 現在の動作設定を返す。DBに保存済みの妥当な値のみ採用し、
 * 未設定・不正値・DB障害時は既定値へフォールバックする
 * (設定読み込みの失敗で取得系機能を止めない)。
 */
export async function getOperationSettings(): Promise<OperationSettings> {
  const cached = settingsCache.get(CACHE_KEY);
  if (cached) return cached;

  const settings = defaultOperationSettings();
  try {
    const rows = await prisma.appSetting.findMany();
    for (const row of rows) {
      if (!isOperationSettingKey(row.key)) continue;
      const value = parseOperationSettingValue(row.key, row.value);
      if (value !== null) settings[row.key] = value;
    }
    settingsCache.set(CACHE_KEY, settings);
  } catch (error) {
    // 障害中も既定値を短時間キャッシュし、呼び出しごとのDB再試行とログ増幅を防ぐ
    console.error("[settings] failed to load app_settings; using defaults", error);
    settingsCache.set(CACHE_KEY, settings);
  }
  return settings;
}

/**
 * 設定を保存し、変更前後の値を返す。
 * 値が変わる場合は「設定変更」監査イベントを同一トランザクションで記録し、
 * 設定だけ変更されて証跡が欠落する状態を防ぐ (CodeRabbit指摘)。
 */
export async function setOperationSetting(
  key: OperationSettingKey,
  value: number,
): Promise<{ previous: number; next: number }> {
  const current = await getOperationSettings();
  const previous = current[key];
  const def = OPERATION_SETTING_DEFS[key];
  const upsert = prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
  if (previous !== value) {
    await prisma.$transaction([
      upsert,
      prisma.auditLog.create({
        data: {
          actor: "管理者",
          action: "設定変更",
          target: def.label,
          detail: `${previous}${def.unit} → ${value}${def.unit}`,
          level: "info",
        },
      }),
    ]);
  } else {
    await upsert;
  }
  invalidateOperationSettingsCache();
  return { previous, next: value };
}
