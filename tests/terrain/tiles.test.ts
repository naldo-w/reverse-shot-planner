import { describe, expect, it } from 'vitest'
import {
  decodeTerrarium,
  lonLatToTile,
  metersPerPixel,
  tileBounds,
  tilesForBounds,
} from '../../src/core/terrain/tiles'
import { deg } from '../../src/core/units'

describe('tile math', () => {
  it('Lion Rock at z12 (formula verified; brief value 3395/1788 was wrong)', () => {
    // x = floor((114.18707 + 180) / 360 * 4096) = 3347; y = 1786 via Mercator.
    expect(lonLatToTile(114.18707, 22.3531, 12)).toEqual({ x: 3347, y: 1786 })
  })

  it('known references', () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 })
    expect(lonLatToTile(-180, 85, 2)).toEqual({ x: 0, y: 0 })
  })

  it('round-trips: tile bounds contain the point', () => {
    for (const [lon, lat, z] of [
      [114.18707, 22.3531, 12],
      [-73.98, 40.75, 13],
      [151.2, -33.86, 10],
    ] as const) {
      const { x, y } = lonLatToTile(lon, lat, z)
      const b = tileBounds(z, x, y)
      expect(lon).toBeGreaterThanOrEqual(b.west)
      expect(lon).toBeLessThanOrEqual(b.east)
      expect(lat).toBeGreaterThanOrEqual(b.south)
      expect(lat).toBeLessThanOrEqual(b.north)
    }
  })

  it('tilesForBounds covers area and caps at 64 tiles', () => {
    const b = { north: deg(22.4), south: deg(22.3), east: deg(114.25), west: deg(114.15) }
    const tiles = tilesForBounds(b, 12)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.some((t) => t.x === 3347 && t.y === 1786)).toBe(true)
    const big = { north: deg(30), south: deg(20), east: deg(120), west: deg(110) }
    expect(() => tilesForBounds(big, 12)).toThrow(RangeError)
  })

  it('metersPerPixel at z12 equator is about 38 m', () => {
    expect(metersPerPixel(0, 12)).toBeCloseTo(38.2187, 3)
    expect(metersPerPixel(60, 12)).toBeCloseTo(19.109, 2)
  })
})

describe('decodeTerrarium', () => {
  it('decodes known values', () => {
    const px = new Uint8Array([128, 0, 0, 255, 129, 244, 0, 255, 127, 255, 128, 255])
    const out = decodeTerrarium(px, 3, 1)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(500)
    expect(out[2]).toBeCloseTo(-0.5, 5)
  })

  it('handles negative elevations (below sea level)', () => {
    const out = decodeTerrarium(new Uint8ClampedArray([127, 156, 0, 255]), 1, 1)
    expect(out[0]).toBe(-100)
  })
})

import { despike } from '../../src/core/terrain/tiles'
describe('despike', () => {
  it('removes a single-pixel spike and keeps real slopes', () => {
    const size = 8
    const d = new Float32Array(size * size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[y * size + x] = x * 30 // 30 m/pixel slope
    d[3 * size + 4] = 2436
    expect(despike(d, size)).toBe(1)
    expect(d[3 * size + 4]).toBe(120)
    expect(d[3 * size + 6]).toBe(180)
  })
})
