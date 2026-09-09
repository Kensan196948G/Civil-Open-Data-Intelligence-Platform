import { describe, expect, it } from "vitest";
import type { Neighborhood3x3 } from "@/lib/terrain/geo";
import { calculateSlopeDeg } from "@/lib/terrain/geo";

/**
 * Metamorphic Test (Gate 2) — 地形勾配計算の不変条件。
 *
 * 実地形の「正しい勾配」は DEM の測定精度に依存して正確な期待値を作りにくいため、
 * 入力変換に対する不変条件で検証する (docs/quality/TOLERANCE_SPEC.md 2.3):
 *
 *   MR-SLOPE-1  全セル標高に定数 c を加算しても勾配は不変 (オフセット不変)
 *   MR-SLOPE-2  同一傾斜の東向き勾配と北向き勾配は同一角度 (等方性)
 *   MR-SLOPE-3  セル欠損は null のまま伝播し、補間で埋めない (無データの事実化禁止)
 *
 * 許容差: 1e-9 (同一 DEM 入力の決定論的三角法演算、誤差は浮動小数丸めのみ)
 */

function flat(z: number): Neighborhood3x3 {
  return { z1: z, z2: z, z3: z, z4: z, z5: z, z6: z, z7: z, z8: z, z9: z };
}

/** 東向き (x 方向) に 1:1 の勾配を持つ 3x3 */
function eastGradient(z0: number): Neighborhood3x3 {
  return {
    z1: z0, z2: z0 + 10, z3: z0 + 20,
    z4: z0, z5: z0 + 10, z6: z0 + 20,
    z7: z0, z8: z0 + 10, z9: z0 + 20,
  };
}

/** 北向き (y 方向) に 1:1 の勾配を持つ 3x3 (セル 10m につき 10m 上昇) */
function northGradient(z0: number): Neighborhood3x3 {
  return {
    z1: z0, z2: z0, z3: z0,
    z4: z0 + 10, z5: z0 + 10, z6: z0 + 10,
    z7: z0 + 20, z8: z0 + 20, z9: z0 + 20,
  };
}

function shifted(n: Neighborhood3x3, c: number): Neighborhood3x3 {
  // MR-SLOPE-1 の入力は欠損なしの近傍であることが呼び出し側で保証される
  const cells = [n.z1, n.z2, n.z3, n.z4, n.z5, n.z6, n.z7, n.z8, n.z9] as number[];
  const [z1, z2, z3, z4, z5, z6, z7, z8, z9] = cells.map((z) => z + c);
  return { z1, z2, z3, z4, z5, z6, z7, z8, z9 };
}

describe("metamorphic terrain slope invariants", () => {
  it("MR-SLOPE-1: adding a constant offset to every cell does not change the slope", () => {
    const base = eastGradient(50);
    const expected = calculateSlopeDeg(base, 10, 10) as number;
    expect(expected).toBeCloseTo(45, 9);
    for (const c of [-30, 137.5, 9000]) {
      expect(calculateSlopeDeg(shifted(base, c), 10, 10)).toBeCloseTo(expected, 9);
    }
  });

  it("MR-SLOPE-2: equal east-facing and north-facing gradients have the same angle", () => {
    const east = calculateSlopeDeg(eastGradient(50), 10, 10) as number;
    const north = calculateSlopeDeg(northGradient(50), 10, 10);
    expect(north).toBeCloseTo(east, 9);
    // 逆勾配 (下り坂) も同じ絶対角度になる (傾斜方向によらず急峻さは等しい)
    const eastDown = calculateSlopeDeg(eastGradient(52), 10, 10);
    expect(eastDown).toBeCloseTo(east, 9);
  });

  it("MR-SLOPE-2b: an opposite (downhill) gradient has the same steepness", () => {
    const west: Neighborhood3x3 = {
      z1: 70, z2: 60, z3: 50,
      z4: 70, z5: 60, z6: 50,
      z7: 70, z8: 60, z9: 50,
    };
    const east = calculateSlopeDeg(eastGradient(50), 10, 10) as number;
    expect(calculateSlopeDeg(west, 10, 10)).toBeCloseTo(east, 9);
  });

  it("MR-SLOPE-3: missing cells stay null instead of being interpolated away", () => {
    const holeEdge = { ...flat(100), z1: null } as unknown as Neighborhood3x3;
    expect(calculateSlopeDeg(holeEdge, 10, 10)).toBeNull();
    const holeCenter = { ...flat(100), z5: null } as unknown as Neighborhood3x3;
    expect(calculateSlopeDeg(holeCenter, 10, 10)).toBeNull();
    // 欠損なしの平坦地は 0 度 (null ではない)
    expect(calculateSlopeDeg(flat(100), 10, 10)).toBeCloseTo(0, 10);
  });
});
