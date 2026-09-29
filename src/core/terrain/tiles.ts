/**
 * Web Mercator XYZ tile math and Terrarium PNG decoding.
 */

import type { Bounds } from '../types'
import { deg } from '../units'
import type { Degrees } from '../units'

export interface TileId {
  readonly z: number
  readonly x: number
  readonly y: number
}

/** Maximum tiles a single area request may cover. */
export const MAX_TILES = 64

/** Web Mercator latitude limit, degrees. */
const MAX_LAT = 85.0511287798066
const EARTH_CIRCUMFERENCE = 40075016.68557849

function clampLat(lat: number): number {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
}

/** Fractional tile coordinates (not floored). */
export function lonLatToTileFraction(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z
  const latRad = (clampLat(lat) * Math.PI) / 180
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

/** Integer XYZ tile containing a point. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const f = lonLatToTileFraction(lon, lat, z)
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(f.x))),
    y: Math.min(n - 1, Math.max(0, Math.floor(f.y))),
  }
}

function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI
}

export function tileBounds(z: number, x: number, y: number): Bounds {
  return {
    north: deg(tileYToLat(y, z)),
    south: deg(tileYToLat(y + 1, z)),
    west: deg(tileXToLon(x, z)),
    east: deg(tileXToLon(x + 1, z)),
  }
}

/**
 * Tiles covering `bounds` at zoom `z`. A box crossing the antimeridian
 * (west > east) wraps. Throws RangeError beyond MAX_TILES.
 */
export function tilesForBounds(bounds: Bounds, z: number): TileId[] {
  const n = 2 ** z
  const nw = lonLatToTile(bounds.west, bounds.north, z)
  const se = lonLatToTile(bounds.east, bounds.south, z)
  const wraps = bounds.west > bounds.east
  const cols = wraps ? se.x + n - nw.x + 1 : se.x - nw.x + 1
  const rows = se.y - nw.y + 1
  if (cols < 1 || rows < 1) return []
  if (cols * rows > MAX_TILES) {
    throw new RangeError(
      `Area needs ${cols * rows} tiles at zoom ${z}; the limit is ${MAX_TILES}. Reduce the radius or zoom.`,
    )
  }
  const out: TileId[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ z, x: (nw.x + c) % n, y: nw.y + r })
    }
  }
  return out
}

/** Ground resolution of one pixel (Web Mercator, at latitude), metres. */
export function metersPerPixel(lat: Degrees | number, z: number, tileSize = 256): number {
  const latRad = (clampLat(lat) * Math.PI) / 180
  return (Math.cos(latRad) * EARTH_CIRCUMFERENCE) / (tileSize * 2 ** z)
}

/** Decode Terrarium RGBA pixels to elevation in metres: (R*256 + G + B/256) - 32768. */
export function decodeTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const count = width * height
  if (rgba.length < count * 4) {
    throw new RangeError(`RGBA buffer too small: ${rgba.length} < ${count * 4}`)
  }
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    out[i] = (rgba[o] ?? 0) * 256 + (rgba[o + 1] ?? 0) + (rgba[o + 2] ?? 0) / 256 - 32768
  }
  return out
}

/**
 * Remove isolated single-pixel spikes/pits (data artefacts seen in Terrarium,
 * e.g. a 2,436 m pixel near Sha Tin). A pixel differing from the median of its
 * 8 neighbours by more than `threshold` metres is replaced by that median.
 * Real terrain at ~35 m/pixel does not change by hundreds of metres in one pixel.
 */
export function despike(data: Float32Array, size: number, threshold = 250): number {
  let fixed = 0
  const src = data.slice()
  const nb: number[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      nb.length = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue
          nb.push(src[yy * size + xx] as number)
        }
      }
      nb.sort((a, b) => a - b)
      const med = nb[nb.length >> 1] as number
      const i = y * size + x
      if (Math.abs((src[i] as number) - med) > threshold) {
        data[i] = med
        fixed++
      }
    }
  }
  return fixed
}
