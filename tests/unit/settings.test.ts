import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: {
      findMany: findManyMock,
      upsert: upsertMock,
    },
  },
}));

import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  PREVIEW_MAX_BYTES,
  STALE_CHECK_DAYS,
} from "@/lib/constants";
import {
  OPERATION_SETTING_DEFS,
  defaultOperationSettings,
  getOperationSettings,
  invalidateOperationSettingsCache,
  isOperationSettingKey,
  parseOperationSettingValue,
  setOperationSetting,
} from "@/lib/settings";

describe("operation settings", () => {
  beforeEach(() => {
    invalidateOperationSettingsCache();
    findManyMock.mockReset();
    upsertMock.mockReset();
  });

  it("uses the same defaults as src/lib/constants", () => {
    expect(defaultOperationSettings()).toEqual({
      timeoutSec: FETCH_TIMEOUT_MS / 1000,
      redirectLimit: MAX_REDIRECTS,
      previewKb: PREVIEW_MAX_BYTES / 1024,
      staleDays: STALE_CHECK_DAYS,
    });
  });

  it("accepts only design-canonical option values", () => {
    expect(parseOperationSettingValue("timeoutSec", 60)).toBe(60);
    expect(parseOperationSettingValue("timeoutSec", "120")).toBe(120);
    expect(parseOperationSettingValue("timeoutSec", 45)).toBeNull();
    expect(parseOperationSettingValue("timeoutSec", -1)).toBeNull();
    expect(parseOperationSettingValue("timeoutSec", Number.NaN)).toBeNull();
    expect(parseOperationSettingValue("redirectLimit", 0)).toBe(0);
    expect(parseOperationSettingValue("redirectLimit", 10)).toBeNull();
    expect(parseOperationSettingValue("previewKb", 16)).toBe(16);
    expect(parseOperationSettingValue("staleDays", 180)).toBe(180);
  });

  it("recognizes only the four setting keys", () => {
    for (const key of Object.keys(OPERATION_SETTING_DEFS)) {
      expect(isOperationSettingKey(key)).toBe(true);
    }
    expect(isOperationSettingKey("readLimitBytes")).toBe(false);
    expect(isOperationSettingKey("__proto__")).toBe(false);
  });

  it("applies stored valid values and ignores invalid or unknown rows", async () => {
    findManyMock.mockResolvedValueOnce([
      { key: "timeoutSec", value: "60" },
      { key: "redirectLimit", value: "999" }, // 選択肢外 → 既定値のまま
      { key: "unknownKey", value: "1" }, // 不明キー → 無視
    ]);

    const settings = await getOperationSettings();
    expect(settings.timeoutSec).toBe(60);
    expect(settings.redirectLimit).toBe(MAX_REDIRECTS);
    expect(settings.staleDays).toBe(STALE_CHECK_DAYS);
  });

  it("falls back to defaults when the settings table is unavailable", async () => {
    findManyMock.mockRejectedValueOnce(new Error("db down"));
    const settings = await getOperationSettings();
    expect(settings).toEqual(defaultOperationSettings());
  });

  it("caches loaded settings and refreshes after invalidation", async () => {
    findManyMock.mockResolvedValue([{ key: "timeoutSec", value: "10" }]);

    await getOperationSettings();
    await getOperationSettings();
    expect(findManyMock).toHaveBeenCalledTimes(1);

    invalidateOperationSettingsCache();
    await getOperationSettings();
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("persists a change and reports previous/next values for auditing", async () => {
    findManyMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue({ key: "timeoutSec", value: "60" });

    const result = await setOperationSetting("timeoutSec", 60);
    expect(result).toEqual({ previous: FETCH_TIMEOUT_MS / 1000, next: 60 });
    expect(upsertMock).toHaveBeenCalledWith({
      where: { key: "timeoutSec" },
      update: { value: "60" },
      create: { key: "timeoutSec", value: "60" },
    });
  });
});
