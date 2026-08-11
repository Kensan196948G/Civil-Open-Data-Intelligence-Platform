import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// deploy 経路が子プロセスを起こさないことを観測するための差し替え。
// 実体の spawnSync を残すと、結線が壊れた場合に本物の npx / wrangler が走る。
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

import {
  EVIDENCE_ENV_KEYS,
  main,
  resolveEvidenceEnv,
} from "../../scripts/deploy/deploy-production.mjs";
import { EVIDENCE_FORMATS } from "../../scripts/tools/production-evidence-report.js";

/**
 * 本番 deploy の証跡変数が fail-closed であることの証明 (T-B7)。
 *
 * 主張は「新実装が通る」ではなく「**旧実装では deploy が進んでしまった状態で、
 * 新実装は停止する**」である。緑のテストは fail-closed 化を何も証明しないため、
 * 各ケースで旧実装 (legacyResolveEvidenceEnv) が値を返していたことを併せて表明する。
 * 旧実装をテスト内に据え置いてあるので、この証明は実行のたびに再現される
 * (source を書き換えて確認する手順型の mutation と違い、退行しない)。
 *
 * 隣接テストとの役割分担:
 *   - tests/unit/production-evidence-report.test.ts (Issue #128): 与えられた値の
 *     **形が** 実在する回答として妥当か。
 *   - 本ファイル: そもそも値が **与えられていること** を deploy が要求するか。
 *     #128 は「ok の 2 文字では通らない」を保証したが、値が無いときに deploy
 *     スクリプト自身が既定値を差し込む経路は塞いでいなかった。
 */

/**
 * T-B7 以前の scripts/deploy/deploy-production.mjs が持っていた既定値を逐語で保存したもの。
 *
 * ⚠ これは仕様ではない。「何が自動的に埋められていたか」を再現するための参照であり、
 *   本番経路からは既に外れている。ここを新実装に合わせて更新してはならない。
 *
 * CODIP_CLOUDFLARE_ACCESS_EVIDENCE の既定値が「未設定」と述べながら、これを受け取る
 * 証跡ゲートが ✅ を出していた。ゲートが反転していた実物がこれである。
 */
const LEGACY_EVIDENCE_DEFAULTS: Record<string, string> = {
  CODIP_CLOUDFLARE_ACCESS_EVIDENCE:
    "Cloudflare Access未設定 (ユーザー手動設定を予定)。管理系はCODIP_TRUST_PROXY_SECRET必須のfail-closed全拒否で公開。Access設定後にsecret rotationを実施",
  CODIP_MONITORING_CONTACTS: "GitHub owner Kensan196948G (repo issues / registered email)",
  CODIP_CLOUDFLARE_ALERT_POLICY:
    "初期リリースはWorkers observability (wrangler.jsonc enabled=true) のみ。専用alert policyは未設定でIssue #63系で追跡",
  CODIP_CLOUDFLARE_LOGS_EVIDENCE:
    "Workers observability enabled=true。query_worker_observability (MCP) で照会可能",
  CODIP_NEON_MONITORING_EVIDENCE:
    "Neon console monitoring + MCP list_slow_queries。history retention 24h (Issue #63で拡張検討)",
  CODIP_SMOKE_MONITORING_SCHEDULE:
    "release:post-release-status をリリース直後 + 月-土の自律セッションで実行",
  CODIP_ROLLBACK_OWNER: "human: kensan (AIによる自動rollback禁止 — docs/runbooks/rollback.md)",
  CODIP_BACKUP_RESTORE_EVIDENCE:
    "Neon backup branch backup-prerelease-v0.1.0-20260720 (br-shiny-pond-afwbww1h, LSN 0/24D2000)",
};

/** 旧実装の解決規則: 環境変数が空なら既定値で埋め、deploy はそのまま続行した。 */
function legacyResolveEvidenceEnv(env: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(LEGACY_EVIDENCE_DEFAULTS).map(([key, fallback]) => [
      key,
      env[key]?.trim() || fallback,
    ]),
  );
}

/** 実在しうる証跡値の一式。形式そのものの妥当性は #128 のテストが担当する。 */
function completeEvidenceEnv(): Record<string, string> {
  return {
    CODIP_CLOUDFLARE_ACCESS_EVIDENCE:
      "Cloudflare Access application on odip.mirai-dx-platform.com, policy verified 2026-08-10",
    CODIP_MONITORING_CONTACTS: "oncall:codip-platform",
    CODIP_CLOUDFLARE_ALERT_POLICY:
      "Workers error-rate alert policy codip-prod-5xx, notifies oncall:codip-platform, reviewed 2026-08-10",
    CODIP_CLOUDFLARE_LOGS_EVIDENCE:
      "Workers observability enabled for odip.mirai-dx-platform.com, retention 7d, checked 2026-08-10",
    CODIP_NEON_MONITORING_EVIDENCE:
      "Neon project monitoring for odip.mirai-dx-platform.com, slow-query review 2026-08-10",
    CODIP_SMOKE_MONITORING_SCHEDULE: "per-release, last success 2026-08-10, owner oncall:codip-platform",
    CODIP_ROLLBACK_OWNER: "kensan196948G",
    CODIP_BACKUP_RESTORE_EVIDENCE:
      "restore drill 2026-08-10 outcome success, verified by kensan196948G on odip.mirai-dx-platform.com",
  };
}

function envWithout(key: string): Record<string, string> {
  const env = completeEvidenceEnv();
  delete env[key];
  return env;
}

describe("本番 deploy の証跡変数 fail-closed 化 (T-B7)", () => {
  it("8 変数すべてが設定されていれば、その値をそのまま返す", () => {
    const env = completeEvidenceEnv();
    expect(resolveEvidenceEnv(env)).toEqual(env);
  });

  it("返る鍵は 8 変数ちょうどで、余計な値を作らない", () => {
    // 既定値が 1 つでも復活すれば、入力に無い鍵が返って落ちる。
    expect(Object.keys(resolveEvidenceEnv(completeEvidenceEnv())).sort()).toEqual(
      [...EVIDENCE_ENV_KEYS].sort(),
    );
  });

  it("前提の確認: 旧実装は 8 変数すべてを既定値で埋めていた", () => {
    const legacy = legacyResolveEvidenceEnv({});
    expect(Object.keys(legacy).sort()).toEqual([...EVIDENCE_ENV_KEYS].sort());
    for (const key of EVIDENCE_ENV_KEYS) {
      expect(legacy[key]).toBeTruthy();
    }
  });

  describe("1 変数だけ未設定のとき", () => {
    it.each([...EVIDENCE_ENV_KEYS])("%s: 旧実装は既定値で埋めて deploy を続行した", (key) => {
      const resolved = legacyResolveEvidenceEnv(envWithout(key));
      expect(resolved[key]).toBe(LEGACY_EVIDENCE_DEFAULTS[key]);
    });

    it.each([...EVIDENCE_ENV_KEYS])("%s: 新実装は deploy を止める", (key) => {
      expect(() => resolveEvidenceEnv(envWithout(key))).toThrow(
        new RegExp(`missing required production evidence env: ${key}`),
      );
    });
  });

  it("空白だけの値は未設定として扱う", () => {
    const env = { ...completeEvidenceEnv(), CODIP_ROLLBACK_OWNER: "   \t " };
    expect(() => resolveEvidenceEnv(env)).toThrow(/CODIP_ROLLBACK_OWNER/);
  });

  it("値の前後の空白は落として返す", () => {
    const env = { ...completeEvidenceEnv(), CODIP_ROLLBACK_OWNER: "  kensan196948G  " };
    expect(resolveEvidenceEnv(env).CODIP_ROLLBACK_OWNER).toBe("kensan196948G");
  });

  it("未設定が複数あれば 1 回でまとめて報告する", () => {
    const env = completeEvidenceEnv();
    delete env.CODIP_ROLLBACK_OWNER;
    delete env.CODIP_MONITORING_CONTACTS;
    try {
      resolveEvidenceEnv(env);
      expect.unreachable("resolveEvidenceEnv should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("CODIP_MONITORING_CONTACTS");
      expect(message).toContain("CODIP_ROLLBACK_OWNER");
      // 手で実行する deploy なので、1 回に 1 変数ずつ落とすと 8 往復かかる。
      expect(message).toContain("docs/security/production-evidence-format.md");
    }
  });

  it("何も設定されていなければ 8 変数すべてを挙げて止まる", () => {
    for (const key of EVIDENCE_ENV_KEYS) {
      expect(() => resolveEvidenceEnv({})).toThrow(new RegExp(key));
    }
  });

  describe("反転していたゲートそのもの", () => {
    it("旧実装は「Access未設定」と述べる値を証跡として供給していた", () => {
      const supplied = legacyResolveEvidenceEnv({}).CODIP_CLOUDFLARE_ACCESS_EVIDENCE;
      expect(supplied).toContain("未設定");
      // 監査対象が自分で証跡を書いていた。この値のまま証跡ゲートは ✅ を出していた。
    });

    it("新実装はこの値を自分では作らない", () => {
      expect(() => resolveEvidenceEnv({})).toThrow(/CODIP_CLOUDFLARE_ACCESS_EVIDENCE/);
    });
  });

  it("要求する 8 変数は production-evidence-report.js の形式定義と一致する", () => {
    // 形式定義に 9 件目を足しながら deploy 側の必須集合を更新し忘れる、の逆も同様に
    // ここで落ちる。「検査する変数」と「無ければ止める変数」がずれないための結線。
    expect([...EVIDENCE_ENV_KEYS].sort()).toEqual(Object.keys(EVIDENCE_FORMATS).sort());
  });
});

/**
 * ゲートが「正しいこと」と「呼ばれていること」は別の主張である (T-B12)。
 *
 * 上のブロックは resolveEvidenceEnv() が fail-closed であることを証明するが、
 * main() がそれを呼ぶことは見ていない。実測: deploy-production.mjs の
 * `const evidenceEnv = skipDeploy ? {} : resolveEvidenceEnv();` を
 * `const evidenceEnv = {};` へ置き換えても、64 files 704 tests は全て緑だった。
 * 関数を fail-closed に直しても、呼び出しを外せば元の状態に戻る。
 *
 * ここでは main() を実際に走らせ、証跡変数が無いときに
 *   1. 停止すること
 *   2. remote 読み取り (fetch) にも子プロセス (spawnSync) にも到達していないこと
 * を測る。source の文字列照合ではないので、関数の改名や行の移動では欺けない。
 *
 * ⚠ 測っていないこと:
 *   - 観測点は fetch と spawnSync の 2 つだけである。この 2 つを経由しない副作用
 *     （ファイル書き込み等）より前であることは主張していない。現状の main() が
 *     ゲートより後に持つ副作用はこの 2 種類だけだが、増えたら観測点も足すこと。
 *   - `--skip-deploy` は argv 由来の module 定数なので、この経路 (skipDeploy=false)
 *     だけを測っている。ゲートを常に skip 側へ倒す改変はここで落ちる。
 */
describe("証跡ゲートの deploy 経路への結線 (T-B12)", () => {
  /** ゲートより前で main() が要求する変数。値そのものは使われない。 */
  const PREGATE_ENV_KEYS = ["NEON_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of [...PREGATE_ENV_KEYS, ...EVIDENCE_ENV_KEYS]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // 実値ではない。requiredEnv を通すためだけの合成値。
    for (const key of PREGATE_ENV_KEYS) {
      process.env[key] = ["unit", "test", key.toLowerCase()].join("-");
    }
    fetchMock = vi.fn(() => Promise.reject(new Error("remote call must not be reached")));
    vi.stubGlobal("fetch", fetchMock);
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it("対照: 2 つの観測点が実際に差し替わっている", async () => {
    // これが落ちるなら、下 2 件の not.toHaveBeenCalled() は「呼ばれていない」
    // ではなく「観測していない」を意味する。空虚な合格を防ぐための対照。
    const { spawnSync } = await import("node:child_process");
    expect(spawnSync).toBe(spawnSyncMock);
    expect(globalThis.fetch).toBe(fetchMock);
  });

  it("証跡変数が無ければ main() は停止する", async () => {
    await expect(main()).rejects.toThrow(/missing required production evidence env/);
  });

  it("その停止は remote 読み取りにも子プロセスにも到達する前に起きる", async () => {
    await expect(main()).rejects.toThrow();
    expect(
      fetchMock,
      "Neon/Cloudflare API を呼んでからゲートが動いている (順序が逆転した)",
    ).not.toHaveBeenCalled();
    expect(
      spawnSyncMock,
      "prisma/wrangler を起動してからゲートが動いている (順序が逆転した)",
    ).not.toHaveBeenCalled();
  });
});
