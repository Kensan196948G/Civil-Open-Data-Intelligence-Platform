import { describe, expect, it } from "vitest";
import {
  MAX_MERCATOR_LATITUDE,
  coordinateToTileXY,
  lonLatToTilePixel,
  lonLatToTileXY,
} from "@/lib/terrain/geo";

describe("lonLatToTileXY", () => {
  it("maps the whole world to tile (0, 0) at zoom 0", () => {
    expect(lonLatToTileXY(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(lonLatToTileXY(139.767125, 35.681236, 0)).toEqual({ x: 0, y: 0 });
    expect(lonLatToTileXY(-122.4194, 37.7749, 0)).toEqual({ x: 0, y: 0 });
  });

  it("places the (0, 0) center at the middle tile for each zoom", () => {
    expect(lonLatToTileXY(0, 0, 1)).toEqual({ x: 1, y: 1 });
    expect(lonLatToTileXY(0, 0, 2)).toEqual({ x: 2, y: 2 });
    expect(lonLatToTileXY(0, 0, 10)).toEqual({ x: 512, y: 512 });
  });

  it("returns integer indices within the valid grid range", () => {
    const zoom = 5;
    const n = 2 ** zoom;
    const { x, y } = lonLatToTileXY(139.767125, 35.681236, zoom);
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(n);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(n);
  });

  it("separates northern and southern hemispheres across the equator", () => {
    const zoom = 4;
    const n = 2 ** zoom;
    const north = lonLatToTileXY(0, 45, zoom);
    const south = lonLatToTileXY(0, -45, zoom);
    expect(north.y).toBeLessThan(n / 2);
    expect(south.y).toBeGreaterThanOrEqual(n / 2);
  });

  it("clamps latitudes beyond the Web Mercator bound", () => {
    const zoom = 5;
    // Past the pole clamps to the bound, so both inputs yield the same tile.
    expect(lonLatToTileXY(0, 90, zoom)).toEqual(lonLatToTileXY(0, MAX_MERCATOR_LATITUDE, zoom));
    expect(lonLatToTileXY(0, -90, zoom)).toEqual(lonLatToTileXY(0, -MAX_MERCATOR_LATITUDE, zoom));
  });

  it("does not produce NaN for extreme latitudes", () => {
    const { x, y } = lonLatToTileXY(0, 89.999, 8);
    expect(Number.isNaN(x)).toBe(false);
    expect(Number.isNaN(y)).toBe(false);
  });

  it("maps the north-west origin to tile (0, 0)", () => {
    expect(lonLatToTileXY(-180, 85, 2)).toEqual({ x: 0, y: 0 });
  });

  it("clamps lon=180 onto the last column instead of x = 2^zoom (issue #3)", () => {
    for (const zoom of [1, 5, 14]) {
      const n = 2 ** zoom;
      expect(lonLatToTileXY(180, 0, zoom)).toEqual({ x: n - 1, y: n / 2 });
    }
  });

  it("keeps clamped polar latitudes inside the grid (issue #3)", () => {
    for (const zoom of [1, 5, 14]) {
      const n = 2 ** zoom;
      const north = lonLatToTileXY(0, 89, zoom);
      const south = lonLatToTileXY(0, -89, zoom);
      expect(north.y).toBeGreaterThanOrEqual(0);
      expect(south.y).toBeLessThan(n);
    }
  });

  it("rejects fractional, negative and oversized zoom levels (issue #3)", () => {
    expect(() => lonLatToTileXY(0, 0, 5.5)).toThrow(RangeError);
    expect(() => lonLatToTileXY(0, 0, -1)).toThrow(RangeError);
    expect(() => lonLatToTileXY(0, 0, 25)).toThrow(RangeError);
    expect(() => lonLatToTileXY(0, 0, Number.NaN)).toThrow(RangeError);
  });
});

describe("lonLatToTilePixel", () => {
  it("returns the tile and an in-range pixel for an interior point", () => {
    const { tile, px, py } = lonLatToTilePixel(139.767125, 35.681236, 14);
    expect(tile).toEqual(lonLatToTileXY(139.767125, 35.681236, 14));
    expect(px).toBeGreaterThanOrEqual(0);
    expect(px).toBeLessThan(256);
    expect(py).toBeGreaterThanOrEqual(0);
    expect(py).toBeLessThan(256);
  });

  it("pins the north-west corner of a tile to pixel (0, 0)", () => {
    // lon=-180 is exactly the left edge of tile x=0 at any zoom.
    const { tile, px } = lonLatToTilePixel(-180, 0, 3);
    expect(tile.x).toBe(0);
    expect(px).toBe(0);
  });

  it("clamps the right world edge into the last pixel of the last tile", () => {
    const zoom = 3;
    const n = 2 ** zoom;
    const { tile, px } = lonLatToTilePixel(180, 0, zoom);
    expect(tile.x).toBe(n - 1);
    expect(px).toBe(255);
  });

  it("rejects a non-positive or fractional tile size", () => {
    expect(() => lonLatToTilePixel(0, 0, 3, 0)).toThrow(RangeError);
    expect(() => lonLatToTilePixel(0, 0, 3, 255.5)).toThrow(RangeError);
  });
});

describe("coordinateToTileXY", () => {
  it("matches lonLatToTileXY for the same location", () => {
    const coordinate = { lat: 35.681236, lon: 139.767125 };
    expect(coordinateToTileXY(coordinate, 12)).toEqual(
      lonLatToTileXY(coordinate.lon, coordinate.lat, 12),
    );
  });
});
