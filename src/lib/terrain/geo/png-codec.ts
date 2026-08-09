/**
 * Portable PNG codec for GSI DEM elevation tiles (design spec 8.2).
 *
 * Runs unchanged on Cloudflare Workers, browsers and Node 18+: compression is
 * delegated to the Web-standard CompressionStream/DecompressionStream, and no
 * Node-only API is used. Zero external dependencies, mirroring the repository
 * policy established for every other package.
 *
 * Decoder scope: 8-bit depth, color type 2 (RGB) or 6 (RGBA), no interlacing,
 * any scanline filter (None/Sub/Up/Average/Paeth), any number of IDAT chunks.
 * That covers real GSI DEM PNG tiles, which are libpng-encoded RGB with mixed
 * per-row filters — unlike the fixture codec in tests/fixtures/generate/png.ts
 * which only ever needs filter 0. Anything outside this scope throws so an
 * unexpected upstream format fails loudly instead of decoding garbage.
 *
 * Encoder scope: filter 0, RGB only. It exists so tests (and later the tile
 * proxy) can fabricate tiles without Node's zlib.
 */

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BIT_DEPTH_8 = 8;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;

/**
 * Upper bound on width/height. Every tile this system consumes is 256px;
 * 2048 leaves generous headroom while keeping the worst-case pixel buffer
 * (2048 * (2048*4+1) ≈ 16.8 MB) far below Workers memory limits.
 */
export const MAX_PNG_DIMENSION = 2048;

/** A decoded raster. `data` holds unfiltered samples, row-major. */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Samples per pixel: 3 = RGB, 4 = RGBA. */
  readonly channels: 3 | 4;
  readonly data: Uint8Array;
}

/** Read the RGB triple of one pixel (alpha, when present, is skipped). */
export function rgbAt(png: DecodedPng, x: number, y: number): readonly [number, number, number] {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) {
    throw new RangeError(`pixel (${x}, ${y}) outside ${png.width}x${png.height}`);
  }
  const offset = (y * png.width + x) * png.channels;
  return [
    png.data[offset] as number,
    png.data[offset + 1] as number,
    png.data[offset + 2] as number,
  ];
}

const CRC_TABLE: readonly number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * zlib-container inflate via the Web-standard DecompressionStream. The output
 * is capped at `maxBytes`: a decompression bomb (tiny IDAT expanding into a
 * huge buffer) is aborted mid-stream instead of exhausting memory first.
 */
async function inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`PNG pixel data exceeds the expected ${maxBytes} bytes (bomb?)`);
    }
    parts.push(value);
  }
  return concat(parts);
}

/** zlib-container deflate via the Web-standard CompressionStream. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Reverse PNG scanline filtering in place-order (RFC 2083 §6). `bpp` is bytes
 * per pixel; `prior` is the already-unfiltered previous row (zeros for row 0).
 */
function unfilterRow(
  filter: number,
  row: Uint8Array,
  prior: Uint8Array,
  bpp: number,
  rowIndex: number,
): void {
  switch (filter) {
    case 0:
      return;
    case 1: // Sub
      for (let i = bpp; i < row.length; i++) {
        row[i] = ((row[i] as number) + (row[i - bpp] as number)) & 0xff;
      }
      return;
    case 2: // Up
      for (let i = 0; i < row.length; i++) {
        row[i] = ((row[i] as number) + (prior[i] as number)) & 0xff;
      }
      return;
    case 3: // Average
      for (let i = 0; i < row.length; i++) {
        const left = i >= bpp ? (row[i - bpp] as number) : 0;
        row[i] = ((row[i] as number) + ((left + (prior[i] as number)) >> 1)) & 0xff;
      }
      return;
    case 4: // Paeth
      for (let i = 0; i < row.length; i++) {
        const left = i >= bpp ? (row[i - bpp] as number) : 0;
        const upLeft = i >= bpp ? (prior[i - bpp] as number) : 0;
        row[i] = ((row[i] as number) + paethPredictor(left, prior[i] as number, upLeft)) & 0xff;
      }
      return;
    default:
      throw new Error(`Unsupported PNG scanline filter ${filter} at row ${rowIndex}`);
  }
}

/**
 * Decode PNG bytes into an unfiltered raster. Throws on anything outside the
 * documented scope (see module docs) and on truncated or malformed input.
 */
export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  if (bytes.length < PNG_SIGNATURE.length + 12) {
    throw new Error("Not a PNG (too short)");
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("Not a PNG (bad signature)");
    }
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  let sawIhdr = false;
  let sawIend = false;
  const idatParts: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = readU32be(bytes, offset);
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) {
      throw new Error("Truncated PNG chunk");
    }
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    const data = bytes.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      width = readU32be(data, 0);
      height = readU32be(data, 4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== BIT_DEPTH_8 || interlace !== 0) {
        throw new Error(`Unsupported PNG: bitDepth=${bitDepth} interlace=${interlace}`);
      }
      if (colorType === COLOR_TYPE_RGB) {
        channels = 3;
      } else if (colorType === COLOR_TYPE_RGBA) {
        channels = 4;
      } else {
        throw new Error(`Unsupported PNG color type ${colorType}`);
      }
      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid PNG dimensions ${width}x${height}`);
      }
      if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
        // Reject hostile IHDR dimensions before any pixel buffer is sized.
        throw new Error(
          `PNG dimensions ${width}x${height} exceed the ${MAX_PNG_DIMENSION}px tile limit`,
        );
      }
      sawIhdr = true;
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
    // Ancillary chunks (pHYs, tEXt, ...) are skipped.

    offset = dataStart + length + 4;
  }

  if (!sawIhdr || !sawIend || idatParts.length === 0) {
    throw new Error("Malformed PNG (missing IHDR, IDAT or IEND)");
  }

  const stride = width * channels;
  const expectedRawLength = height * (stride + 1);
  // Cap decompression at the exact size the (already bounded) IHDR promises.
  const raw = await inflate(concat(idatParts), expectedRawLength);
  if (raw.length !== expectedRawLength) {
    throw new Error(
      `PNG pixel data size mismatch: expected ${expectedRawLength}, got ${raw.length}`,
    );
  }

  const data = new Uint8Array(height * stride);
  let prior = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const row = raw.slice(rowStart + 1, rowStart + 1 + stride);
    unfilterRow(raw[rowStart] as number, row, prior, channels, y);
    data.set(row, y * stride);
    prior = row;
  }

  return { width, height, channels, data };
}

/**
 * Encode an RGB raster (`pixels[y][x] = [r, g, b]`) into PNG bytes with
 * filter 0 on every scanline. Counterpart of {@link decodePng} for tests and
 * tile fabrication; deterministic output is not guaranteed across runtimes
 * because the compressor implementation differs.
 */
export async function encodePng(
  pixels: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>,
): Promise<Uint8Array> {
  const height = pixels.length;
  const width = height > 0 ? (pixels[0] as readonly unknown[]).length : 0;
  if (width === 0 || height === 0) {
    throw new Error("encodePng requires a non-empty raster");
  }

  const ihdr = concat([
    u32be(width),
    u32be(height),
    Uint8Array.from([BIT_DEPTH_8, COLOR_TYPE_RGB, 0, 0, 0]),
  ]);

  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: None
    const row = pixels[y] as readonly (readonly [number, number, number])[];
    if (row.length !== width) {
      throw new Error(`Ragged raster: row ${y} has ${row.length} pixels, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      const [r, g, b] = row[x] as readonly [number, number, number];
      const px = rowStart + 1 + x * 3;
      raw[px] = r & 0xff;
      raw[px + 1] = g & 0xff;
      raw[px + 2] = b & 0xff;
    }
  }

  const idat = await deflate(raw);
  return concat([
    PNG_SIGNATURE,
    buildChunk("IHDR", ihdr),
    buildChunk("IDAT", idat),
    buildChunk("IEND", new Uint8Array(0)),
  ]);
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
  const typeAndData = concat([typeBytes, data]);
  return concat([u32be(data.length), typeAndData, u32be(crc32(typeAndData))]);
}
