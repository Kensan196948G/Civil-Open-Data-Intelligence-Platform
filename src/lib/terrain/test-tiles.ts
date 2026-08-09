import { encodePng } from "./geo";

/**
 * テスト用の合成 DEM タイル生成 (spec 8.2 の逆変換)。
 * 本物の GSI タイルは使わない (テストはネットワークに出ない)。
 */

export function elevationToRgb(elevationM: number): readonly [number, number, number] {
  const x = Math.round(elevationM / 0.01);
  const unsigned = x < 0 ? x + 16777216 : x;
  return [(unsigned >>> 16) & 255, (unsigned >>> 8) & 255, unsigned & 255];
}

/** 全ピクセル同一標高の 256x256 タイル。 */
export async function uniformDemTile(elevationM: number): Promise<Uint8Array> {
  const rgb = elevationToRgb(elevationM);
  const row = new Array<readonly [number, number, number]>(256).fill(rgb);
  const pixels = new Array<ReadonlyArray<readonly [number, number, number]>>(256).fill(row);
  return encodePng(pixels);
}

/** fetch スタブ: URL 部分文字列 → 応答 の対応表。未登録は 404。 */
export type TileResponder = (url: string) => Promise<Response> | Response | null;

export function fakeTileFetch(responder: TileResponder): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const response = await responder(url);
    return response ?? new Response(null, { status: 404 });
  }) as typeof fetch;
}

export function pngResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}
