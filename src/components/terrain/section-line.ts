import { haversineDistanceM } from "@/lib/terrain/geo/geodesy";
import type { SectionLineState } from "./MapView";

/**
 * 断面線の実長 (m)。始点・終点が揃っていない間は null。
 *
 * ■ なぜ関数として切り出すか
 *
 * 元の実装は JSX 内で `sectionLine?.start !== null && sectionLine?.end !== null`
 * と書いていた。`sectionLine` が null のとき `sectionLine?.start` は undefined に
 * なるため、この式は `undefined !== null` すなわち **常に true** で、断面線が
 * 未指定でも「指定済み」の分岐へ入っていた。案内文
 * 「断面線は30m〜20kmで指定できます」は到達不能な死んだ分岐だった。
 *
 * optional chaining と null 比較の組み合わせは目視で誤りに気づきにくい。判定を
 * 純粋関数に閉じ込め、undefined と null の双方を単体テストで固定する。
 */
export function sectionLineLengthM(line: SectionLineState | null | undefined): number | null {
  const start = line?.start;
  const end = line?.end;
  if (!start || !end) return null;
  return haversineDistanceM(start, end);
}
