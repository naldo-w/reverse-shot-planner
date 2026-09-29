/**
 * Accessible, unobstructed camera spots inside the fan cells.
 *
 * Pipeline (all pure; the worker supplies terrain, OSM features and buildings):
 *  1. collectCandidates  - inside every geometric cell, points that a person can
 *     plausibly stand on: every ~25 m along qualifying lines (paths, minor roads,
 *     roads; bridges count, tunnels never do), a ~40 m grid plus the centroid of
 *     park / open-space polygons, and named viewpoint / park POIs. Points in water
 *     (unless on a bridge) are dropped. At most 8 per cell, best priority first,
 *     spread out (farthest-point picking, at most half of the slots per tier).
 *  2. evaluateCandidates - the alignment is recomputed at the exact point (same
 *     prepared day tracks, terrain ground + eye height); |error| <= tolerance
 *     survives. Cells are sampled at their centre, so a point elsewhere in the
 *     cell can gain or lose up to ~0.3 deg: this pass is what makes it exact.
 *     At most MAX_EVALUATED candidates, best geometric cell error first.
 *  3. filterVisible - points inside a building footprint are dropped; the rest
 *     get a terrain + building line of sight to the landmark top
 *     (BuildingSurfaceSampler, bare terrain within the near-field radius
 *     replaced by the camera's own ground, buildings at every distance).
 *
 * Priority (lower is better): viewpoint 0, park / open space 1, path 2,
 * minor road 3, road 4. Accessibility is inferred from OSM tags only.
 */

import { destinationPoint, vincentyInverse } from '../geometry/geodesy'
import { lonLatToTile } from '../terrain/tiles'
import type { TileId } from '../terrain/tiles'
import { BuildingIndex, BuildingSurfaceSampler } from '../terrain/composite'
import { rayVisibility } from '../terrain/horizon'
import type { ElevationSampler } from '../terrain/types'
import type { Coordinate, GeodeticPosition } from '../types'
import { deg, m } from '../units'
import { DEFAULT_REFRACTION_K } from '../planner/types'
import { illuminationCache, matchCamera, sectorDistances, servingTracks, cellPolygon, DEFAULT_TOLERANCE } from './sectors'
import type { PreparedSector, SectorBest, SectorCell, SectorQuery } from './sectors'
import type { CelestialEngine } from '../astronomy'

export type AccessKind = 'viewpoint' | 'park' | 'path' | 'minor-road' | 'road'

export const ACCESS_PRIORITY: Readonly<Record<AccessKind, number>> = {
  viewpoint: 0,
  park: 1,
  path: 2,
  'minor-road': 3,
  road: 4,
}

export type LonLat = readonly [number, number]

export interface AccessLine {
  readonly kind: 'path' | 'minor-road' | 'road'
  /** brunnel = bridge: kept as accessible; tunnels are never loaded. */
  readonly bridge: boolean
  readonly coords: readonly LonLat[]
}

/** Polygon = its rings (outer first, then holes); containment is even-odd across the rings. */
export interface AccessArea {
  readonly name?: string
  readonly rings: readonly (readonly LonLat[])[]
}

export interface AccessPoi {
  readonly kind: 'viewpoint' | 'park'
  readonly name?: string
  readonly lon: number
  readonly lat: number
}

export interface NamedLine {
  readonly name: string
  readonly coords: readonly LonLat[]
}

export interface AccessFeatures {
  readonly lines: readonly AccessLine[]
  /** Public open space polygons (parks, recreation grounds, leisure grass). */
  readonly areas: readonly AccessArea[]
  readonly water: readonly AccessArea[]
  readonly pois: readonly AccessPoi[]
  readonly names: readonly NamedLine[]
}

export const EMPTY_FEATURES: AccessFeatures = { lines: [], areas: [], water: [], pois: [], names: [] }

export const LINE_SPACING_M = 25
export const AREA_SPACING_M = 40
export const MAX_PER_CELL = 8
export const MAX_EVALUATED = 4000
export const FEATURE_TILE_CAP = 200
export const BUILDING_TILE_CAP = 200
/** Buildings farther than this from every candidate are not loaded (see buildingTilesNear). */
export const BUILDING_RADIUS_M = 1500

const M_PER_DEG = 111_320
const RAD = Math.PI / 180

export interface Candidate {
  readonly lat: number
  readonly lon: number
  readonly kind: AccessKind
  readonly bridge: boolean
  readonly name?: string
  /** Index into the cell array. */
  readonly cell: number
}

// ---------------------------------------------------------------- polygons

function ringContains(ring: readonly LonLat[], lon: number, lat: number): boolean {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const pa = ring[a] as LonLat
    const pb = ring[b] as LonLat
    if (pa[1] > lat !== pb[1] > lat && lon < ((pb[0] - pa[0]) * (lat - pa[1])) / (pb[1] - pa[1]) + pa[0]) inside = !inside
  }
  return inside
}

interface IndexedArea {
  readonly rings: readonly (readonly LonLat[])[]
  readonly name?: string
  readonly minLon: number
  readonly minLat: number
  readonly maxLon: number
  readonly maxLat: number
}

function indexArea(a: AccessArea): IndexedArea | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  const outer = a.rings[0]
  if (!outer || outer.length < 3) return null
  for (const [lon, lat] of outer) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { rings: a.rings, ...(a.name === undefined ? {} : { name: a.name }), minLon, minLat, maxLon, maxLat }
}

function areaContains(a: IndexedArea, lon: number, lat: number): boolean {
  if (lon < a.minLon || lon > a.maxLon || lat < a.minLat || lat > a.maxLat) return false
  let inside = false
  for (const r of a.rings) if (ringContains(r, lon, lat)) inside = !inside
  return inside
}

/** Area-weighted centroid of the outer ring, [lon, lat]. */
function centroid(ring: readonly LonLat[]): LonLat | null {
  let a2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i] as LonLat
    const q = ring[j] as LonLat
    const f = q[0] * p[1] - p[0] * q[1]
    a2 += f
    cx += (q[0] + p[0]) * f
    cy += (q[1] + p[1]) * f
  }
  if (Math.abs(a2) < 1e-18) return null
  return [cx / (3 * a2), cy / (3 * a2)]
}

// ------------------------------------------------------------ cell locator

export interface CellGridSpec {
  readonly target: Coordinate
  readonly bearingStep: number
  readonly minDistance: number
  readonly maxDistance: number
  readonly distanceSteps: number
}

/** Maps a ground point to the fan cell containing it (same bearing / log-distance grid as computeSectorField). */
export class CellLocator {
  private readonly count: number
  private readonly outer: number[]
  private readonly cellAt = new Map<number, number>()
  private readonly spec: CellGridSpec
  private readonly cosLat: number

  constructor(cells: readonly SectorCell[], spec: CellGridSpec) {
    this.spec = spec
    this.count = Math.round(360 / spec.bearingStep)
    this.outer = sectorDistances(spec.minDistance, spec.maxDistance, spec.distanceSteps).outer
    this.cosLat = Math.cos(spec.target.lat * RAD)
    const inner = sectorDistances(spec.minDistance, spec.maxDistance, spec.distanceSteps).centre
    cells.forEach((c, i) => {
      const bi = Math.round(c.bearing / spec.bearingStep) % this.count
      let di = 0
      let best = Infinity
      inner.forEach((d, k) => {
        const e = Math.abs(d - c.distance)
        if (e < best) {
          best = e
          di = k
        }
      })
      this.cellAt.set(bi * 65536 + di, i)
    })
  }

  /** Cell index containing the point, or -1. */
  locate(lat: number, lon: number): number {
    const s = this.spec
    const dn = (lat - s.target.lat) * M_PER_DEG
    const de = (lon - s.target.lon) * M_PER_DEG * this.cosLat
    const rough = Math.hypot(de, dn)
    if (rough < s.minDistance * 0.98 || rough > s.maxDistance * 1.02) return -1
    const inv = vincentyInverse(s.target, { lat: deg(lat), lon: deg(lon) })
    // 1 m of slack so cell centres at exactly min / max distance locate themselves.
    if (!inv || inv.distance < s.minDistance - 1 || inv.distance > s.maxDistance + 1) return -1
    let lo = 0
    let hi = this.outer.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (inv.distance < (this.outer[mid] as number)) hi = mid
      else lo = mid + 1
    }
    const bi = Math.round(inv.initialBearing / s.bearingStep) % this.count
    return this.cellAt.get(bi * 65536 + lo) ?? -1
  }
}

// -------------------------------------------------------------- candidates

const KIND_PRIORITY = (k: AccessKind): number => ACCESS_PRIORITY[k]

function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const cos = Math.cos(((aLat + bLat) / 2) * RAD)
  return Math.hypot((bLat - aLat) * M_PER_DEG, (bLon - aLon) * M_PER_DEG * cos)
}

/** Greedy farthest-point selection, best priority first, at most half of the slots per tier on the first pass. */
export function selectSpread(list: readonly Candidate[], max: number, centre: Coordinate): Candidate[] {
  if (list.length <= max) return [...list]
  const tiers = new Map<number, Candidate[]>()
  for (const c of list) {
    const p = KIND_PRIORITY(c.kind)
    const t = tiers.get(p)
    if (t) t.push(c)
    else tiers.set(p, [c])
  }
  const order = [...tiers.keys()].sort((a, b) => a - b)
  const chosen: Candidate[] = []
  const left = new Map<number, Candidate[]>(order.map((p) => [p, [...(tiers.get(p) as Candidate[])]]))
  const pick = (pool: Candidate[], n: number): void => {
    for (let i = 0; i < n && pool.length > 0 && chosen.length < max; i++) {
      let bestIdx = 0
      let bestScore = -Infinity
      pool.forEach((c, idx) => {
        const score =
          chosen.length === 0
            ? -metresBetween(centre.lat, centre.lon, c.lat, c.lon)
            : Math.min(...chosen.map((o) => metresBetween(o.lat, o.lon, c.lat, c.lon)))
        if (score > bestScore) {
          bestScore = score
          bestIdx = idx
        }
      })
      chosen.push(pool.splice(bestIdx, 1)[0] as Candidate)
    }
  }
  const perTier = Math.ceil(max / 2)
  for (const p of order) pick(left.get(p) as Candidate[], perTier)
  for (const p of order) pick(left.get(p) as Candidate[], max)
  return chosen
}

export interface CandidateOptions {
  readonly lineSpacing?: number
  readonly areaSpacing?: number
  readonly perCell?: number
}

export interface CandidateSet {
  /** Parallel to the cells. */
  readonly byCell: Candidate[][]
  readonly total: number
  /** Cells that have no accessible candidate. */
  readonly noAccess: number
}

interface RawPoint {
  readonly lat: number
  readonly lon: number
  readonly kind: AccessKind
  readonly bridge: boolean
  readonly name?: string
}

/** Points along a polyline every `spacing` metres (first vertex included). */
function* alongLine(coords: readonly LonLat[], spacing: number): Generator<LonLat> {
  let carry = 0
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i] as LonLat
    const b = coords[i + 1] as LonLat
    const len = metresBetween(a[1], a[0], b[1], b[0])
    if (len === 0) continue
    while (carry <= len) {
      const f = carry / len
      yield [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
      carry += spacing
    }
    carry -= len
  }
}

export function collectCandidates(
  cells: readonly SectorCell[],
  grid: CellGridSpec,
  features: AccessFeatures,
  opts: CandidateOptions = {},
): CandidateSet {
  const lineSpacing = opts.lineSpacing ?? LINE_SPACING_M
  const areaSpacing = opts.areaSpacing ?? AREA_SPACING_M
  const perCell = opts.perCell ?? MAX_PER_CELL
  const byCell: Candidate[][] = cells.map(() => [])
  if (cells.length === 0) return { byCell, total: 0, noAccess: 0 }
  const locator = new CellLocator(cells, grid)
  const water = features.water.map(indexArea).filter((a): a is IndexedArea => a !== null)
  const inWater = (lat: number, lon: number): boolean => water.some((w) => areaContains(w, lon, lat))

  // Fan box (cell centres + 2.5 km): rejects far-away features cheaply.
  let bMinLat = Infinity
  let bMaxLat = -Infinity
  let bMinLon = Infinity
  let bMaxLon = -Infinity
  for (const c of cells) {
    bMinLat = Math.min(bMinLat, c.lat)
    bMaxLat = Math.max(bMaxLat, c.lat)
    bMinLon = Math.min(bMinLon, c.lon)
    bMaxLon = Math.max(bMaxLon, c.lon)
  }
  const padLat = 2500 / M_PER_DEG
  const padLon = 2500 / (M_PER_DEG * Math.cos(grid.target.lat * RAD))
  bMinLat -= padLat
  bMaxLat += padLat
  bMinLon -= padLon
  bMaxLon += padLon
  const touchesFan = (minLon: number, minLat: number, maxLon: number, maxLat: number): boolean =>
    !(maxLon < bMinLon || minLon > bMaxLon || maxLat < bMinLat || minLat > bMaxLat)

  const seen: Map<string, number>[] = cells.map(() => new Map())
  const raw: RawPoint[][] = cells.map(() => [])
  const add = (lat: number, lon: number, p: Omit<RawPoint, 'lat' | 'lon'>): void => {
    const ci = locator.locate(lat, lon)
    if (ci < 0) return
    if (!p.bridge && inWater(lat, lon)) return
    // Adjacent tiles repeat features in their buffers: one point per ~6 m.
    const key = `${Math.round((lat * M_PER_DEG) / 6)},${Math.round((lon * M_PER_DEG * Math.cos(lat * RAD)) / 6)}`
    const map = seen[ci] as Map<string, number>
    const list = raw[ci] as RawPoint[]
    const old = map.get(key)
    if (old !== undefined) {
      if (KIND_PRIORITY(p.kind) < KIND_PRIORITY((list[old] as RawPoint).kind)) list[old] = { lat, lon, ...p }
      return
    }
    map.set(key, list.length)
    list.push({ lat, lon, ...p })
  }

  for (const line of features.lines) {
    let minLon = Infinity
    let minLat = Infinity
    let maxLon = -Infinity
    let maxLat = -Infinity
    for (const [lon, lat] of line.coords) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    if (!touchesFan(minLon, minLat, maxLon, maxLat)) continue
    for (const [lon, lat] of alongLine(line.coords, lineSpacing)) add(lat, lon, { kind: line.kind, bridge: line.bridge })
  }

  for (const a of features.areas) {
    const ia = indexArea(a)
    if (!ia || !touchesFan(ia.minLon, ia.minLat, ia.maxLon, ia.maxLat)) continue
    const name = a.name === undefined ? {} : { name: a.name }
    const midLat = (ia.minLat + ia.maxLat) / 2
    const dLat = areaSpacing / M_PER_DEG
    const dLon = areaSpacing / (M_PER_DEG * Math.cos(midLat * RAD))
    // Grid phase is global so polygons split across tiles produce the same points.
    const lat0 = Math.max(ia.minLat, bMinLat)
    const lat1 = Math.min(ia.maxLat, bMaxLat)
    const lon0 = Math.max(ia.minLon, bMinLon)
    const lon1 = Math.min(ia.maxLon, bMaxLon)
    if (lat0 > lat1 || lon0 > lon1) continue
    const rows = Math.ceil((lat1 - lat0) / dLat) + 1
    const cols = Math.ceil((lon1 - lon0) / dLon) + 1
    if (rows * cols > 400_000) continue
    for (let la = Math.ceil(lat0 / dLat) * dLat; la <= lat1; la += dLat) {
      for (let lo = Math.ceil(lon0 / dLon) * dLon; lo <= lon1; lo += dLon) {
        if (areaContains(ia, lo, la)) add(la, lo, { kind: 'park', bridge: false, ...name })
      }
    }
    const c = centroid(ia.rings[0] as readonly LonLat[])
    if (c && areaContains(ia, c[0], c[1])) add(c[1], c[0], { kind: 'park', bridge: false, ...name })
  }

  for (const p of features.pois) add(p.lat, p.lon, { kind: p.kind, bridge: false, ...(p.name === undefined ? {} : { name: p.name }) })

  let total = 0
  let noAccess = 0
  cells.forEach((cell, i) => {
    const points = raw[i] as RawPoint[]
    if (points.length === 0) {
      noAccess++
      return
    }
    const cands: Candidate[] = points.map((p) => ({ ...p, cell: i }))
    const chosen = selectSpread(cands, perCell, cell)
    byCell[i] = chosen
    total += chosen.length
  })
  return { byCell, total, noAccess }
}

// -------------------------------------------------------------- evaluation

export interface EvaluatedCandidate extends Candidate {
  readonly groundHeight: number
  readonly bearing: number
  readonly distance: number
  readonly best: SectorBest
}

export interface EvaluationResult {
  readonly survivors: EvaluatedCandidate[]
  readonly evaluated: number
  readonly outOfTolerance: number
  readonly noGround: number
  /** True when more than MAX_EVALUATED candidates existed and the worst cells were skipped. */
  readonly capped: boolean
}

export function evaluateCandidates(
  engine: CelestialEngine,
  q: SectorQuery,
  prep: PreparedSector,
  cells: readonly SectorCell[],
  byCell: readonly (readonly Candidate[])[],
  maxEvaluated = MAX_EVALUATED,
  onProgress?: (fraction: number) => void,
): EvaluationResult {
  const tol = q.tolerance ?? DEFAULT_TOLERANCE
  const k = q.refractionK ?? DEFAULT_REFRACTION_K
  const all: Candidate[] = byCell.flat()
  const cellErr = (c: Candidate): number => Math.abs((cells[c.cell] as SectorCell).best.offsetError)
  all.sort((a, b) => cellErr(a) - cellErr(b) || KIND_PRIORITY(a.kind) - KIND_PRIORITY(b.kind))
  const capped = all.length > maxEvaluated
  const list = capped ? all.slice(0, maxEvaluated) : all
  const illumination = illuminationCache(engine)
  const survivors: EvaluatedCandidate[] = []
  let outOfTolerance = 0
  let noGround = 0
  const tick = Math.max(1, Math.floor(list.length / 100))
  list.forEach((c, n) => {
    const ground = q.groundHeight(c.lat, c.lon)
    if (ground === null) {
      noGround++
      return
    }
    const inv = vincentyInverse(q.target, { lat: deg(c.lat), lon: deg(c.lon) })
    if (!inv) {
      noGround++
      return
    }
    const camera: GeodeticPosition = { lat: deg(c.lat), lon: deg(c.lon), height: m(ground + q.eyeHeight) }
    const hit = matchCamera(q, prep, servingTracks(prep, inv.initialBearing), camera, tol, k)
    if (!hit) {
      outOfTolerance++
    } else {
      survivors.push({
        ...c,
        groundHeight: ground,
        bearing: inv.initialBearing,
        distance: inv.distance,
        best: {
          time: new Date(hit.ms),
          offsetError: deg(hit.err),
          bodyAzimuth: deg(hit.az),
          bodyApparentAltitude: deg(hit.app),
          targetApparentAltitude: deg(hit.targetApparentAltitude),
          direction: hit.rising ? 'rising' : 'setting',
          ...(q.body === 'moon' ? { illumination: illumination(hit.ms) } : {}),
        },
      })
    }
    if (onProgress && n % tick === 0) onProgress(n / list.length)
  })
  onProgress?.(1)
  return { survivors, evaluated: list.length, outOfTolerance, noGround, capped }
}

// ----------------------------------------------------------------- tiles

const RING_POINTS = 16

function tileKey(t: { x: number; y: number }): string {
  return `${t.x}/${t.y}`
}

function keepMostUsed(counts: Map<string, { tile: TileId; n: number }>, cap: number): { tiles: TileId[]; restricted: boolean } {
  const all = [...counts.values()]
  if (all.length <= cap) return { tiles: all.map((e) => e.tile), restricted: false }
  all.sort((a, b) => b.n - a.n)
  return { tiles: all.slice(0, cap).map((e) => e.tile), restricted: true }
}

/** z14 tiles touched by the cells (centre + ring vertices): where OSM features are needed. */
export function featureTilesForCells(
  cells: readonly SectorCell[],
  target: Coordinate,
  cap = FEATURE_TILE_CAP,
  zoom = 14,
): { tiles: TileId[]; restricted: boolean } {
  const counts = new Map<string, { tile: TileId; n: number }>()
  const touch = (lon: number, lat: number): void => {
    const t = lonLatToTile(lon, lat, zoom)
    const key = tileKey(t)
    const e = counts.get(key)
    if (e) e.n++
    else counts.set(key, { tile: { z: zoom, x: t.x, y: t.y }, n: 1 })
  }
  for (const c of cells) {
    touch(c.lon, c.lat)
    for (const [lon, lat] of cellPolygon(c, target)) touch(lon, lat)
  }
  return keepMostUsed(counts, cap)
}

/**
 * z14 tiles within `radiusM` of any point (centre + 16 ring samples per point):
 * the only tiles whose buildings are loaded for occlusion. Buildings farther
 * than 1.5 km from every candidate camera are therefore ignored; terrain still
 * covers the whole ray. Over the cap, the tiles serving most points are kept.
 */
export function buildingTilesNear(
  points: readonly { readonly lat: number; readonly lon: number }[],
  radiusM = BUILDING_RADIUS_M,
  cap = BUILDING_TILE_CAP,
  zoom = 14,
): { tiles: TileId[]; restricted: boolean } {
  const counts = new Map<string, { tile: TileId; n: number }>()
  for (const p of points) {
    const own = new Set<string>()
    const touch = (lon: number, lat: number): void => {
      const t = lonLatToTile(lon, lat, zoom)
      const key = tileKey(t)
      if (own.has(key)) return
      own.add(key)
      const e = counts.get(key)
      if (e) e.n++
      else counts.set(key, { tile: { z: zoom, x: t.x, y: t.y }, n: 1 })
    }
    touch(p.lon, p.lat)
    for (let i = 0; i < RING_POINTS; i++) {
      const q = destinationPoint({ lat: deg(p.lat), lon: deg(p.lon) }, deg((360 * i) / RING_POINTS), m(radiusM))
      touch(q.lon, q.lat)
    }
  }
  return keepMostUsed(counts, cap)
}

// ------------------------------------------------------------ visibility

export interface AccessPoint {
  readonly lat: number
  readonly lon: number
  readonly kind: AccessKind
  readonly name?: string
  /** Index of the geometric cell this point belongs to. */
  readonly cellRef: number
  readonly bearing: number
  readonly distance: number
  readonly groundHeight: number
  /** ACCESS_PRIORITY of `kind`. */
  readonly priority: number
  readonly best: SectorBest
  readonly visible: true
}

export interface AccessSummary {
  /** Geometric fan cells. */
  readonly cells: number
  /** Candidates generated (<= 8 per cell). */
  readonly candidates: number
  readonly evaluated: number
  readonly outOfTolerance: number
  readonly insideBuilding: number
  readonly blockedByBuilding: number
  readonly blockedByTerrain: number
  /** Cells with no accessible candidate at all. */
  readonly noAccess: number
  readonly visible: number
  /** Candidate list was cut at MAX_EVALUATED. */
  readonly capped: boolean
  /** False when the building tiles could not be loaded (terrain-only line of sight). */
  readonly buildingsLoaded: boolean
  /** Building tile set was cut at the cap. */
  readonly buildingTilesRestricted: boolean
}

export interface VisibilityDeps {
  readonly terrain: ElevationSampler
  readonly index: BuildingIndex
  readonly target: GeodeticPosition
  readonly eyeHeight: number
  readonly refractionK?: number
  /** Bare terrain within this radius of the camera is replaced by the camera's own ground. Default 200. */
  readonly nearFieldMeters?: number
}

export interface VisibilityResult {
  readonly points: AccessPoint[]
  readonly insideBuilding: number
  readonly blockedByBuilding: number
  readonly blockedByTerrain: number
}

export function filterVisible(
  survivors: readonly EvaluatedCandidate[],
  d: VisibilityDeps,
  onProgress?: (fraction: number) => void,
): VisibilityResult {
  const k = d.refractionK ?? DEFAULT_REFRACTION_K
  const near = d.nearFieldMeters ?? 200
  const points: AccessPoint[] = []
  let insideBuilding = 0
  let blockedByBuilding = 0
  let blockedByTerrain = 0
  const tick = Math.max(1, Math.floor(survivors.length / 100))
  survivors.forEach((c, n) => {
    if (d.index.heightAt(c.lat, c.lon) > 0) {
      insideBuilding++
    } else {
      const sampler = new BuildingSurfaceSampler(d.terrain, d.index, {
        camera: { lat: c.lat, lon: c.lon },
        cameraGround: c.groundHeight,
        nearFieldMeters: near,
      })
      const cam: GeodeticPosition = { lat: deg(c.lat), lon: deg(c.lon), height: m(c.groundHeight + d.eyeHeight) }
      const v = rayVisibility(cam, d.target, sampler, k, 0)
      if (v.visible) {
        points.push({
          lat: c.lat,
          lon: c.lon,
          kind: c.kind,
          ...(c.name === undefined ? {} : { name: c.name }),
          cellRef: c.cell,
          bearing: c.bearing,
          distance: c.distance,
          groundHeight: c.groundHeight,
          priority: KIND_PRIORITY(c.kind),
          best: c.best,
          visible: true,
        })
      } else if (v.obstructionKind === 'building') {
        blockedByBuilding++
      } else {
        blockedByTerrain++
      }
    }
    if (onProgress && n % tick === 0) onProgress(n / survivors.length)
  })
  onProgress?.(1)
  return { points, insideBuilding, blockedByBuilding, blockedByTerrain }
}

// ------------------------------------------------------------------ names

/** Name of the nearest named road / path within `maxMetres` of the point. */
export function roadNameAt(names: readonly NamedLine[], lat: number, lon: number, maxMetres = 20): string | undefined {
  const cos = Math.cos(lat * RAD)
  const dLat = maxMetres / M_PER_DEG
  const dLon = maxMetres / (M_PER_DEG * cos)
  let best = maxMetres
  let name: string | undefined
  for (const line of names) {
    for (let i = 0; i + 1 < line.coords.length; i++) {
      const a = line.coords[i] as LonLat
      const b = line.coords[i + 1] as LonLat
      if (
        (a[1] < lat - dLat && b[1] < lat - dLat) ||
        (a[1] > lat + dLat && b[1] > lat + dLat) ||
        (a[0] < lon - dLon && b[0] < lon - dLon) ||
        (a[0] > lon + dLon && b[0] > lon + dLon)
      ) {
        continue
      }
      const ax = (a[0] - lon) * M_PER_DEG * cos
      const ay = (a[1] - lat) * M_PER_DEG
      const bx = (b[0] - lon) * M_PER_DEG * cos
      const by = (b[1] - lat) * M_PER_DEG
      const vx = bx - ax
      const vy = by - ay
      const len2 = vx * vx + vy * vy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2))
      const dist = Math.hypot(ax + t * vx, ay + t * vy)
      if (dist < best) {
        best = dist
        name = line.name
      }
    }
  }
  return name
}

/** Fill in road / path names (from transportation_name) for points that have none. */
export function withRoadNames(points: readonly AccessPoint[], names: readonly NamedLine[]): AccessPoint[] {
  return points.map((p) => {
    if (p.name !== undefined || p.kind === 'viewpoint' || p.kind === 'park') return p
    const name = roadNameAt(names, p.lat, p.lon)
    return name === undefined ? p : { ...p, name }
  })
}

/** Top `n` points, best priority then smallest |error| first. */
export function topAccessPoints(points: readonly AccessPoint[], n = 20): AccessPoint[] {
  return [...points]
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Math.abs(a.best.offsetError) - Math.abs(b.best.offsetError) ||
        a.best.time.getTime() - b.best.time.getTime(),
    )
    .slice(0, n)
}
