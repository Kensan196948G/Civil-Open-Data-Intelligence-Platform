import { describe, expect, it } from "vitest";
import { decodeElevation } from "@/lib/terrain/geo";
import { decodePng, encodePng, rgbAt } from "@/lib/terrain/geo";

/**
 * The tests fabricate PNGs with their own independent chunk writer and
 * *forward* scanline filters, so the decoder's inverse filters are verified
 * against a second implementation rather than against themselves.
 */

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = Uint8Array.from([...[...type].map((c) => c.charCodeAt(0)), ...data]);
  return Uint8Array.from([...u32be(data.length), ...typeAndData, ...u32be(crc32(typeAndData))]);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Apply the FORWARD filter to raw rows (inverse of what the decoder does). */
function forwardFilter(
  raw: readonly Uint8Array[],
  filters: readonly number[],
  bpp: number,
): Uint8Array {
  const stride = (raw[0] as Uint8Array).length;
  const out = new Uint8Array(raw.length * (stride + 1));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < raw.length; y++) {
    const row = raw[y] as Uint8Array;
    const prior = y > 0 ? (raw[y - 1] as Uint8Array) : zero;
    const filter = filters[y] as number;
    out[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const x = row[i] as number;
      const left = i >= bpp ? (row[i - bpp] as number) : 0;
      const up = prior[i] as number;
      const upLeft = i >= bpp ? (prior[i - bpp] as number) : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = x;
          break;
        case 1:
          value = x - left;
          break;
        case 2:
          value = x - up;
          break;
        case 3:
          value = x - ((left + up) >> 1);
          break;
        case 4:
          value = x - paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`test helper: unknown filter ${filter}`);
      }
      out[y * (stride + 1) + 1 + i] = value & 0xff;
    }
  }
  return out;
}

interface BuildPngOptions {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly rawRows: readonly Uint8Array[];
  readonly filters: readonly number[];
  readonly bitDepth?: number;
  readonly interlace?: number;
  readonly splitIdatAt?: number;
}

async function buildPng(options: BuildPngOptions): Promise<Uint8Array> {
  const bpp = options.colorType === 6 ? 4 : 3;
  const ihdr = Uint8Array.from([
    ...u32be(options.width),
    ...u32be(options.height),
    options.bitDepth ?? 8,
    options.colorType,
    0,
    0,
    options.interlace ?? 0,
  ]);
  const compressed = await deflate(forwardFilter(options.rawRows, options.filters, bpp));
  const idatChunks =
    options.splitIdatAt !== undefined
      ? [
          chunk("IDAT", compressed.subarray(0, options.splitIdatAt)),
          chunk("IDAT", compressed.subarray(options.splitIdatAt)),
        ]
      : [chunk("IDAT", compressed)];
  return Uint8Array.from([
    ...SIGNATURE,
    ...chunk("IHDR", ihdr),
    ...idatChunks.flatMap((c) => [...c]),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

/** 3px-wide RGB rows with varied values (0, 255 and mid-range included). */
function sampleRgbRows(): Uint8Array[] {
  return [
    Uint8Array.from([0, 0, 0, 255, 255, 255, 12, 34, 56]),
    Uint8Array.from([200, 100, 50, 0, 128, 0, 255, 0, 255]),
    Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    Uint8Array.from([250, 251, 252, 10, 20, 30, 128, 0, 0]),
    Uint8Array.from([90, 80, 70, 60, 50, 40, 30, 20, 10]),
  ];
}

describe("decodePng", () => {
  it("decodes every scanline filter type against an independent forward filter", async () => {
    const rows = sampleRgbRows();
    const png = await buildPng({
      width: 3,
      height: 5,
      colorType: 2,
      rawRows: rows,
      filters: [0, 1, 2, 3, 4],
    });

    const decoded = await decodePng(png);
    expect(decoded).toMatchObject({ width: 3, height: 5, channels: 3 });
    expect([...decoded.data]).toEqual(rows.flatMap((row) => [...row]));
  });

  it("decodes RGBA and rgbAt skips the alpha channel", async () => {
    const rows = [
      Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 128]),
      Uint8Array.from([70, 80, 90, 0, 100, 110, 120, 64]),
    ];
    const png = await buildPng({
      width: 2,
      height: 2,
      colorType: 6,
      rawRows: rows,
      filters: [4, 2],
    });

    const decoded = await decodePng(png);
    expect(decoded.channels).toBe(4);
    expect(rgbAt(decoded, 0, 0)).toEqual([10, 20, 30]);
    expect(rgbAt(decoded, 1, 1)).toEqual([100, 110, 120]);
  });

  it("concatenates pixel data split across multiple IDAT chunks", async () => {
    const rows = sampleRgbRows();
    const png = await buildPng({
      width: 3,
      height: 5,
      colorType: 2,
      rawRows: rows,
      filters: [0, 0, 0, 0, 0],
      splitIdatAt: 5,
    });

    const decoded = await decodePng(png);
    expect([...decoded.data]).toEqual(rows.flatMap((row) => [...row]));
  });

  it("round-trips the GSI elevation encoding (spec 8.2)", async () => {
    // x = 2^16 R + 2^8 G + B; 12.50 m -> 1250 -> (0, 4, 226); sentinel -> null.
    const pixels: (readonly [number, number, number])[][] = [
      [
        [0, 4, 226],
        [128, 0, 0],
      ],
      [
        [255, 254, 162], // -3.50 m -> x = 2^24 - 350 = 0xFFFEA2
        [0, 0, 0], // 0.00 m
      ],
    ];
    const decoded = await decodePng(await encodePng(pixels));

    expect(decodeElevation(...rgbAt(decoded, 0, 0))).toBe(12.5);
    expect(decodeElevation(...rgbAt(decoded, 1, 0))).toBeNull();
    expect(decodeElevation(...rgbAt(decoded, 0, 1))).toBe(-3.5);
    expect(decodeElevation(...rgbAt(decoded, 1, 1))).toBe(0);
  });

  it("rejects non-PNG bytes and truncated chunks", async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3]))).rejects.toThrow("too short");
    const notPng = new Uint8Array(64);
    await expect(decodePng(notPng)).rejects.toThrow("bad signature");

    const valid = await buildPng({
      width: 3,
      height: 5,
      colorType: 2,
      rawRows: sampleRgbRows(),
      filters: [0, 0, 0, 0, 0],
    });
    // Cut inside the IDAT chunk body (IEND is 12 bytes; -20 also removes part
    // of IDAT's data+CRC) so the chunk header parses but its payload is short.
    await expect(decodePng(valid.subarray(0, valid.length - 20))).rejects.toThrow("Truncated");
  });

  it("rejects unsupported bit depth, color type and interlacing", async () => {
    const rows = [Uint8Array.from([1, 2, 3])];
    await expect(
      buildPng({
        width: 1,
        height: 1,
        colorType: 2,
        rawRows: rows,
        filters: [0],
        bitDepth: 16,
      }).then(decodePng),
    ).rejects.toThrow("bitDepth=16");
    await expect(
      buildPng({ width: 1, height: 1, colorType: 0, rawRows: rows, filters: [0] }).then(decodePng),
    ).rejects.toThrow("color type 0");
    await expect(
      buildPng({
        width: 1,
        height: 1,
        colorType: 2,
        rawRows: rows,
        filters: [0],
        interlace: 1,
      }).then(decodePng),
    ).rejects.toThrow("interlace=1");
  });

  it("rejects an unknown scanline filter and mismatched pixel data size", async () => {
    // Filter byte 5 cannot be produced by forwardFilter, so assemble directly.
    const png = Uint8Array.from([
      ...SIGNATURE,
      ...chunk("IHDR", Uint8Array.from([...u32be(1), ...u32be(1), 8, 2, 0, 0, 0])),
      ...chunk("IDAT", await deflate(Uint8Array.from([5, 1, 2, 3]))),
      ...chunk("IEND", new Uint8Array(0)),
    ]);
    await expect(decodePng(png)).rejects.toThrow("filter 5");

    // Height claims 2 rows but data holds 1.
    const short = Uint8Array.from([
      ...SIGNATURE,
      ...chunk("IHDR", Uint8Array.from([...u32be(1), ...u32be(2), 8, 2, 0, 0, 0])),
      ...chunk("IDAT", await deflate(Uint8Array.from([0, 1, 2, 3]))),
      ...chunk("IEND", new Uint8Array(0)),
    ]);
    await expect(decodePng(short)).rejects.toThrow("size mismatch");
  });

  it("rejects hostile IHDR dimensions before allocating pixel buffers", async () => {
    // 60000x60000 RGB would claim a ~10.8 GB raster; must fail fast at IHDR.
    const png = Uint8Array.from([
      ...SIGNATURE,
      ...chunk("IHDR", Uint8Array.from([...u32be(60000), ...u32be(60000), 8, 2, 0, 0, 0])),
      ...chunk("IDAT", await deflate(Uint8Array.from([0, 1, 2, 3]))),
      ...chunk("IEND", new Uint8Array(0)),
    ]);
    await expect(decodePng(png)).rejects.toThrow(/exceed the \d+px tile limit/);
  });

  it("aborts a decompression bomb instead of inflating it fully", async () => {
    // IHDR claims 1x1 (expects 4 raw bytes) but IDAT expands to 1 MiB.
    const bomb = await deflate(new Uint8Array(1024 * 1024));
    const png = Uint8Array.from([
      ...SIGNATURE,
      ...chunk("IHDR", Uint8Array.from([...u32be(1), ...u32be(1), 8, 2, 0, 0, 0])),
      ...chunk("IDAT", bomb),
      ...chunk("IEND", new Uint8Array(0)),
    ]);
    await expect(decodePng(png)).rejects.toThrow(/exceeds the expected 4 bytes/);
  });

  it("rgbAt rejects out-of-range pixel coordinates", async () => {
    const decoded = await decodePng(await encodePng([[[1, 2, 3]]]));
    expect(() => rgbAt(decoded, 1, 0)).toThrow(RangeError);
    expect(() => rgbAt(decoded, 0, -1)).toThrow(RangeError);
  });
});

describe("encodePng", () => {
  it("rejects an empty or ragged raster", async () => {
    await expect(encodePng([])).rejects.toThrow("non-empty");
    await expect(
      encodePng([
        [[1, 2, 3]],
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
      ] as never),
    ).rejects.toThrow("Ragged");
  });
});
