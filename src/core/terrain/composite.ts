/**
 * Terrain + buildings surface (bare-earth DTM plus building roofs).
 *
 * `BuildingSurfaceSampler.sample(lat, lon)` = ground + height of the tallest
 * building footprint containing the point. Ground is the terrain at the query
 * point, so a building on a slope has a roof that follows the slope (its
 * height is above the local ground, not above one base level). Buildings are
 * treated as solid columns from the ground to `height`; `minHeight`
 * (building:part overhangs, bridges) is not modelled and only over-estimates
 * obstruction. Trees are not included.
 *
 * Near-field rule: within `nearFieldMeters` of the camera the DTM is not
 * trusted (it smooths streets and podiums into false slopes), so the ground
 * there is the camera's own ground height and only buildings rise above it.
 * Buildings are included at every distance; only bare terrain is dropped.
 *
 * Step size: `resolutionMeters` is min(terrain resolution, 5), so marchRay's
 * existing rule step = max(res/2, 0.002 d) gives 2.5 m steps out to 1.25 km,
 * 4 m at 2 km and 10 m at 5 km (never below 2.5 m, and never above the
 * terrain-only step beyond ~2 km). No change to HorizonOptions was needed.
 *
 * Spatial index: uniform grid of ~50 m cells in lat/lon (scaled by cos(lat)),
 * each footprint registered in every cell its bbox touches; lookup is one
 * cell plus bbox test plus even-odd point-in-polygon per candidate.
 */

import type { Building } from '../../providers/buildings/openFreeMapBuildings'
import type { Bounds } from '../types'
import { deg } from '../units'
import type { Degrees } from '../units'
import type { ElevationSampler, SurfaceKind } from './types'

const CELL_M = 50
const M_PER_DEG_LAT = 111_320
const MAX_CELLS = 4_000_000
export const COMPOSITE_MAX_RESOLUTION_M = 5

export class BuildingIndex {
  readonly count: number
  private readonly minLon: number
  private readonly minLat: number
  private readonly cellLon: number
  private readonly cellLat: number
  private readonly cols: number
  private readonly rows: number
  private readonly cellStart: Int32Array
  private readonly cellItems: Int32Array
  private readonly heights: Float32Array
  /** bbox per building: minLon, minLat, maxLon, maxLat. */
  private readonly boxes: Float64Array
  private readonly ringStart: Int32Array
  /** Flattened ring coordinates, lon,lat pairs. */
  private readonly coords: Float64Array

  constructor(buildings: readonly Building[]) {
    const valid = buildings.filter((b) => b.ring.length >= 3 && b.height > 0)
    this.count = valid.length
    this.heights = new Float32Array(valid.length)
    this.boxes = new Float64Array(valid.length * 4)
    this.ringStart = new Int32Array(valid.length + 1)
    let total = 0
    for (const b of valid) total += b.ring.length
    this.coords = new Float64Array(total * 2)

    let minLon = Infinity
    let minLat = Infinity
    let maxLon = -Infinity
    let maxLat = -Infinity
    let o = 0
    valid.forEach((b, i) => {
      this.heights[i] = b.height
      this.ringStart[i] = o
      let bl = Infinity
      let bs = Infinity
      let br = -Infinity
      let bn = -Infinity
      for (const [lon, lat] of b.ring) {
        this.coords[o * 2] = lon
        this.coords[o * 2 + 1] = lat
        o++
        if (lon < bl) bl = lon
        if (lon > br) br = lon
        if (lat < bs) bs = lat
        if (lat > bn) bn = lat
      }
      this.boxes[i * 4] = bl
      this.boxes[i * 4 + 1] = bs
      this.boxes[i * 4 + 2] = br
      this.boxes[i * 4 + 3] = bn
      if (bl < minLon) minLon = bl
      if (bs < minLat) minLat = bs
      if (br > maxLon) maxLon = br
      if (bn > maxLat) maxLat = bn
    })
    this.ringStart[valid.length] = o

    if (valid.length === 0) {
      this.minLon = 0
      this.minLat = 0
      this.cellLon = 1
      this.cellLat = 1
      this.cols = 1
      this.rows = 1
      this.cellStart = new Int32Array(2)
      this.cellItems = new Int32Array(0)
      return
    }

    const midLat = (minLat + maxLat) / 2
    let cellLat = CELL_M / M_PER_DEG_LAT
    let cellLon = CELL_M / (M_PER_DEG_LAT * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)))
    let cols = Math.floor((maxLon - minLon) / cellLon) + 1
    let rows = Math.floor((maxLat - minLat) / cellLat) + 1
    if (cols * rows > MAX_CELLS) {
      const f = Math.sqrt((cols * rows) / MAX_CELLS)
      cellLat *= f
      cellLon *= f
      cols = Math.floor((maxLon - minLon) / cellLon) + 1
      rows = Math.floor((maxLat - minLat) / cellLat) + 1
    }
    this.minLon = minLon
    this.minLat = minLat
    this.cellLon = cellLon
    this.cellLat = cellLat
    this.cols = cols
    this.rows = rows

    // CSR: count, prefix-sum, fill.
    const counts = new Int32Array(cols * rows + 1)
    const range = (i: number): [number, number, number, number] => [
      Math.floor(((this.boxes[i * 4] as number) - minLon) / cellLon),
      Math.floor(((this.boxes[i * 4 + 1] as number) - minLat) / cellLat),
      Math.floor(((this.boxes[i * 4 + 2] as number) - minLon) / cellLon),
      Math.floor(((this.boxes[i * 4 + 3] as number) - minLat) / cellLat),
    ]
    for (let i = 0; i < valid.length; i++) {
      const [c0, r0, c1, r1] = range(i)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * cols + c + 1]!++
    }
    for (let i = 1; i < counts.length; i++) counts[i] = (counts[i] as number) + (counts[i - 1] as number)
    this.cellStart = counts
    const fill = counts.slice(0, cols * rows)
    this.cellItems = new Int32Array(counts[cols * rows] as number)
    for (let i = 0; i < valid.length; i++) {
      const [c0, r0, c1, r1] = range(i)
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = r * cols + c
          this.cellItems[fill[cell] as number] = i
          fill[cell]!++
        }
      }
    }
  }

  /** Height (m above ground) of the tallest footprint containing the point; 0 if none. */
  heightAt(lat: number, lon: number): number {
    if (this.count === 0) return 0
    const c = Math.floor((lon - this.minLon) / this.cellLon)
    const r = Math.floor((lat - this.minLat) / this.cellLat)
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 0
    const cell = r * this.cols + c
    const end = this.cellStart[cell + 1] as number
    let best = 0
    for (let k = this.cellStart[cell] as number; k < end; k++) {
      const i = this.cellItems[k] as number
      const h = this.heights[i] as number
      if (h <= best) continue
      const b = i * 4
      if (
        lon < (this.boxes[b] as number) ||
        lon > (this.boxes[b + 2] as number) ||
        lat < (this.boxes[b + 1] as number) ||
        lat > (this.boxes[b + 3] as number)
      ) {
        continue
      }
      if (this.contains(i, lat, lon)) best = h
    }
    return best
  }

  private contains(i: number, lat: number, lon: number): boolean {
    const s = this.ringStart[i] as number
    const e = this.ringStart[i + 1] as number
    const cs = this.coords
    let inside = false
    for (let a = s, b = e - 1; a < e; b = a++) {
      const xa = cs[a * 2] as number
      const ya = cs[a * 2 + 1] as number
      const xb = cs[b * 2] as number
      const yb = cs[b * 2 + 1] as number
      if (ya > lat !== yb > lat && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside
    }
    return inside
  }
}

export interface BuildingSurfaceOptions {
  /** Camera position; required for the near-field rule. */
  readonly camera?: { readonly lat: number; readonly lon: number }
  /** Ground height at the camera, metres. Default: terrain at the camera (0 if unavailable). */
  readonly cameraGround?: number
  /** Bare terrain closer than this to the camera is replaced by the camera's ground height. Default 0. */
  readonly nearFieldMeters?: number
}

export class BuildingSurfaceSampler implements ElevationSampler {
  readonly bounds: Bounds
  readonly resolutionMeters: number
  readonly buildingCount: number
  private readonly terrain: ElevationSampler
  private readonly index: BuildingIndex
  private readonly nearM: number
  private readonly camLat: number
  private readonly camLon: number
  private readonly cameraGround: number
  private readonly mPerDegLon: number

  constructor(terrain: ElevationSampler, buildings: readonly Building[] | BuildingIndex, opts: BuildingSurfaceOptions = {}) {
    this.terrain = terrain
    this.index = buildings instanceof BuildingIndex ? buildings : new BuildingIndex(buildings)
    this.buildingCount = this.index.count
    this.bounds = terrain.bounds
    this.resolutionMeters = Math.min(terrain.resolutionMeters, COMPOSITE_MAX_RESOLUTION_M)
    const cam = opts.camera
    this.nearM = cam ? Math.max(0, opts.nearFieldMeters ?? 0) : 0
    this.camLat = cam?.lat ?? 0
    this.camLon = cam?.lon ?? 0
    this.mPerDegLon = M_PER_DEG_LAT * Math.cos((this.camLat * Math.PI) / 180)
    this.cameraGround =
      opts.cameraGround ?? (cam ? (terrain.sample(deg(cam.lat), deg(cam.lon)) ?? 0) : 0)
  }

  private inNearField(lat: number, lon: number): boolean {
    if (this.nearM <= 0) return false
    const dn = (lat - this.camLat) * M_PER_DEG_LAT
    const de = (lon - this.camLon) * this.mPerDegLon
    return de * de + dn * dn < this.nearM * this.nearM
  }

  sample(lat: Degrees, lon: Degrees): number | null {
    const ground = this.terrain.sample(lat, lon)
    if (ground === null) return null
    const base = this.inNearField(lat, lon) ? this.cameraGround : ground
    return base + this.index.heightAt(lat, lon)
  }

  surfaceKindAt(lat: Degrees, lon: Degrees): SurfaceKind {
    return this.index.heightAt(lat, lon) > 0 ? 'building' : 'terrain'
  }
}
