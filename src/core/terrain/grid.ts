/**
 * In-memory elevation samplers.
 */

import type { Bounds } from '../types'
import { deg } from '../units'
import type { Degrees } from '../units'
import type { ElevationSampler } from './types'
import { lonLatToTileFraction, metersPerPixel, tileBounds } from './tiles'

export interface DecodedTile {
  readonly z: number
  readonly x: number
  readonly y: number
  readonly data: Float32Array
  readonly size: number
}

/**
 * Bilinear sampler over decoded Web Mercator tiles of a single zoom level.
 * Pixel values are treated as located at pixel centres. Returns null outside
 * the loaded tiles.
 */
export class TileGridSampler implements ElevationSampler {
  readonly bounds: Bounds
  readonly resolutionMeters: number
  private readonly z: number
  private readonly size: number
  private readonly tiles = new Map<string, DecodedTile>()

  constructor(tiles: readonly DecodedTile[]) {
    const first = tiles[0]
    if (!first) throw new RangeError('TileGridSampler needs at least one tile')
    this.z = first.z
    this.size = first.size
    let north = -90
    let south = 90
    let east = -180
    let west = 180
    for (const t of tiles) {
      if (t.z !== this.z || t.size !== this.size) {
        throw new RangeError('All tiles must share one zoom level and size')
      }
      if (t.data.length !== t.size * t.size) {
        throw new RangeError('Tile data length does not match size')
      }
      this.tiles.set(`${t.x}/${t.y}`, t)
      const b = tileBounds(t.z, t.x, t.y)
      north = Math.max(north, b.north)
      south = Math.min(south, b.south)
      east = Math.max(east, b.east)
      west = Math.min(west, b.west)
    }
    this.bounds = { north: deg(north), south: deg(south), east: deg(east), west: deg(west) }
    this.resolutionMeters = metersPerPixel((north + south) / 2, this.z, this.size)
  }

  /** Elevation of the global pixel (px, py), or null if its tile is not loaded. */
  private pixel(px: number, py: number): number | null {
    const size = this.size
    const n = 2 ** this.z * size
    const wx = ((px % n) + n) % n
    if (py < 0 || py >= n) return null
    const tile = this.tiles.get(`${Math.floor(wx / size)}/${Math.floor(py / size)}`)
    if (!tile) return null
    return tile.data[(py % size) * size + (wx % size)] ?? null
  }

  sample(lat: Degrees, lon: Degrees): number | null {
    const f = lonLatToTileFraction(lon, lat, this.z)
    const gx = f.x * this.size - 0.5
    const gy = f.y * this.size - 0.5
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    // The pixel containing the point must be loaded.
    const centre = this.pixel(Math.floor(gx + 0.5), Math.floor(gy + 0.5))
    if (centre === null) return null
    const tx = gx - x0
    const ty = gy - y0
    const v00 = this.pixel(x0, y0) ?? centre
    const v10 = this.pixel(x0 + 1, y0) ?? centre
    const v01 = this.pixel(x0, y0 + 1) ?? centre
    const v11 = this.pixel(x0 + 1, y0 + 1) ?? centre
    const top = v00 + (v10 - v00) * tx
    const bottom = v01 + (v11 - v01) * tx
    return top + (bottom - top) * ty
  }
}

/** Wraps an analytic (lat, lon) => metres function. For tests and mocks only. */
export class AnalyticSampler implements ElevationSampler {
  readonly bounds: Bounds
  readonly resolutionMeters: number
  private readonly fn: (lat: number, lon: number) => number

  constructor(
    fn: (lat: number, lon: number) => number,
    bounds: Bounds = { north: deg(90), south: deg(-90), east: deg(180), west: deg(-180) },
    resolutionMeters = 30,
  ) {
    this.fn = fn
    this.bounds = bounds
    this.resolutionMeters = resolutionMeters
  }

  sample(lat: Degrees, lon: Degrees): number | null {
    const b = this.bounds
    if (lat > b.north || lat < b.south || lon > b.east || lon < b.west) return null
    return this.fn(lat, lon)
  }
}
