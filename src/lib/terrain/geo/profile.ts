/**
 * 断面 (縦断) プロファイルの統計 (設計仕様 8.4)。
 *
 * 入力は線に沿った等間隔サンプル列。欠損サンプルは null のまま扱い、
 * **補間しない**: 欠損を跨ぐ区間は勾配・獲得標高の母数から除外し、
 * その事実を validSampleRatio / validSegmentLengthM で明示する
 * (「データなし ≠ 安全」— 欠損を滑らかに繋ぐと危険地形が消える)。
 */

export interface ProfileSample {
  /** 始点からの距離 (m)。単調増加であること。 */
  readonly distanceM: number;
  readonly elevationM: number | null;
}

export interface ProfileStatistics {
  /** 線の全長 (m) = 最終サンプル距離。 */
  readonly totalLengthM: number;
  /** 有効な隣接区間での累積上昇 (m)。 */
  readonly gainM: number;
  /** 有効な隣接区間での累積下降 (m、正の値)。 */
  readonly lossM: number;
  /** 距離加重平均勾配 (度)。有効区間が無ければ null。 */
  readonly meanSlopeDeg: number | null;
  /** 最大勾配 (度)。有効区間が無ければ null。 */
  readonly maxSlopeDeg: number | null;
  /** 有効標高サンプルの比率 0..1。 */
  readonly validSampleRatio: number;
  /** 両端とも有効な隣接区間の距離合計 (m)。 */
  readonly validSegmentLengthM: number;
  readonly sampleCount: number;
}

export function profileStatistics(samples: readonly ProfileSample[]): ProfileStatistics {
  if (samples.length < 2) {
    throw new RangeError("profile requires at least 2 samples");
  }
  const first = samples[0] as ProfileSample;
  const last = samples[samples.length - 1] as ProfileSample;
  const totalLengthM = last.distanceM - first.distanceM;
  if (!(totalLengthM >= 0)) {
    throw new RangeError("sample distances must be monotonically increasing");
  }

  let gainM = 0;
  let lossM = 0;
  let weightedSlopeSum = 0;
  let validSegmentLengthM = 0;
  let maxSlopeDeg: number | null = null;
  let validSamples = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] as ProfileSample;
    if (sample.elevationM !== null) {
      validSamples++;
    }
    if (i === 0) {
      continue;
    }
    const prev = samples[i - 1] as ProfileSample;
    const dd = sample.distanceM - prev.distanceM;
    if (!(dd > 0)) {
      throw new RangeError("sample distances must be strictly increasing");
    }
    if (prev.elevationM === null || sample.elevationM === null) {
      continue; // 欠損を跨ぐ区間は評価しない (補間禁止)。
    }
    const dz = sample.elevationM - prev.elevationM;
    if (dz > 0) {
      gainM += dz;
    } else {
      lossM += -dz;
    }
    const slopeDeg = (Math.atan(Math.abs(dz) / dd) * 180) / Math.PI;
    weightedSlopeSum += slopeDeg * dd;
    validSegmentLengthM += dd;
    if (maxSlopeDeg === null || slopeDeg > maxSlopeDeg) {
      maxSlopeDeg = slopeDeg;
    }
  }

  return {
    totalLengthM,
    gainM,
    lossM,
    meanSlopeDeg: validSegmentLengthM > 0 ? weightedSlopeSum / validSegmentLengthM : null,
    maxSlopeDeg,
    validSampleRatio: validSamples / samples.length,
    validSegmentLengthM,
    sampleCount: samples.length,
  };
}
