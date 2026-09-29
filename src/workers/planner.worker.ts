/// Module worker: runs planner searches off the main thread.

import { createCelestialEngine } from '../core/astronomy'
import type { CelestialEngine, EngineId } from '../core/astronomy'
import { findAlignments } from '../core/planner/alignments'
import { DEFAULT_REFRACTION_K } from '../core/planner/types'
import {
  reviveQuery,
  serializeAlignments,
  type PlannerRequest,
  type PlannerResponse,
  type AccessFieldRequest,
  type SectorFieldRequest,
} from '../core/planner/wire'
import {
  BUILDING_TILE_CAP,
  buildingTilesNear,
  collectCandidates,
  evaluateCandidates,
  featureTilesForCells,
  filterVisible,
  withRoadNames,
} from '../core/search/access'
import type { AccessSummary } from '../core/search/access'
import {
  DEFAULT_BEARING_STEP,
  DEFAULT_DISTANCE_STEPS,
  evaluateSector,
  prepareSector,
  sectorBounds,
  sectorTerrainZoom,
} from '../core/search/sectors'
import type { SectorCell, SectorQuery } from '../core/search/sectors'
import {
  reviveSectorQuery,
  serializeAccess,
  serializeSectorCells,
  type AccessFieldResult,
  type AccessPhase,
} from '../core/search/wire'
import { BuildingIndex } from '../core/terrain/composite'
import { rayVisibility } from '../core/terrain/horizon'
import type { ElevationSampler, TerrainProvider } from '../core/terrain/types'
import { deg, m } from '../core/units'
import { loadBuildingTiles } from '../providers/buildings/openFreeMapBuildings'
import { loadOsmFeatures } from '../providers/osm/openFreeMapFeatures'
import { TerrariumProvider } from '../providers/terrain/terrariumProvider'

interface WorkerScope {
  onmessage: ((e: MessageEvent<PlannerRequest>) => void) | null
  postMessage(message: PlannerResponse): void
}
const ctx = self as unknown as WorkerScope

const engines = new Map<EngineId, CelestialEngine>()
function engineFor(id: EngineId): CelestialEngine {
  let e = engines.get(id)
  if (!e) {
    e = createCelestialEngine(id)
    engines.set(id, e)
  }
  return e
}

let terrain: TerrainProvider | null = null
function terrainProvider(): TerrainProvider {
  terrain ??= new TerrariumProvider({ useIndexedDb: true })
  return terrain
}

const DEFAULT_VISIBILITY_LIMIT = 300
const DEFAULT_NEAR_FIELD_M = 200

/**
 * Sector field: tracks + fan → terrain over the fan only → cells → terrain
 * line-of-sight for the best cells. Progress: tracks 0–0.4, terrain load
 * 0.4–0.55, cells 0.55–0.9, visibility 0.9–1.
 */
async function runSector(req: SectorFieldRequest): Promise<SectorCell[]> {
  const { id } = req
  const wq = reviveSectorQuery(req.query)
  const engine = engineFor(req.engineId)
  let last = -1
  const progress = (f: number): void => {
    const rounded = Math.round(f * 100) / 100
    if (rounded === last) return
    last = rounded
    ctx.postMessage({ id, progress: rounded })
  }

  const noGround: SectorQuery = { ...wq, groundHeight: () => null }
  const prep = prepareSector(engine, noGround, (f) => progress(f * 0.4))
  const bounds = sectorBounds(wq.target, prep.bearings, wq.minDistance, wq.maxDistance)
  if (!bounds) return []
  const zoom = sectorTerrainZoom(bounds)
  if (zoom === null) throw new Error('Fan is too large to load terrain for; reduce the distance range.')
  progress(0.4)
  const sampler: ElevationSampler = await terrainProvider().loadArea(bounds, zoom)
  progress(0.55)

  const query: SectorQuery = { ...wq, groundHeight: (lat, lon) => sampler.sample(deg(lat), deg(lon)) }
  const cells = evaluateSector(engine, query, prep, (f) => progress(0.55 + f * 0.35))

  const limit = wq.visibilityLimit ?? DEFAULT_VISIBILITY_LIMIT
  if (limit > 0 && cells.length > 0) {
    const k = wq.refractionK ?? DEFAULT_REFRACTION_K
    const near = m(wq.nearFieldDistance ?? DEFAULT_NEAR_FIELD_M)
    const order = cells
      .map((_, i) => i)
      .sort((a, b) => Math.abs((cells[a] as SectorCell).best.offsetError) - Math.abs((cells[b] as SectorCell).best.offsetError))
      .slice(0, limit)
    for (let n = 0; n < order.length; n++) {
      const i = order[n] as number
      const c = cells[i] as SectorCell
      const camera = { lat: c.lat, lon: c.lon, height: m(c.groundHeight + wq.eyeHeight) }
      const v = rayVisibility(camera, wq.target, sampler, k, near)
      cells[i] = { ...c, visible: v.visible }
      if (n % 10 === 0) progress(0.9 + (0.1 * n) / order.length)
    }
  }
  progress(1)
  return cells
}

/**
 * Access field: geometric cells, then accessible candidate points inside them
 * (OSM roads, paths, parks, viewpoints), exact re-evaluation of the alignment at
 * each point, and a terrain + building line of sight. Phases (progress bands):
 * geometry 0-0.10, terrain 0.10-0.20, features 0.20-0.45, evaluation 0.45-0.55,
 * buildings 0.55-0.80, visibility 0.80-1.
 */
async function runAccess(req: AccessFieldRequest): Promise<AccessFieldResult> {
  const { id } = req
  const wq = reviveSectorQuery(req.query)
  const engine = engineFor(req.engineId)
  const t0 = performance.now()
  const marks: string[] = []
  let last = ''
  const mark = (label: string): void => {
    marks.push(`${label} ${Math.round(performance.now() - t0)} ms`)
  }
  const report = (phase: AccessPhase, lo: number, hi: number) => (f: number): void => {
    const v = Math.round((lo + (hi - lo) * Math.min(1, Math.max(0, f))) * 100) / 100
    const key = `${phase}${v}`
    if (key === last) return
    last = key
    ctx.postMessage({ id, progress: v, phase })
  }

  const noGround: SectorQuery = { ...wq, groundHeight: () => null }
  const prep = prepareSector(engine, noGround, report('geometry', 0, 0.1))
  mark('tracks')
  const bounds = sectorBounds(wq.target, prep.bearings, wq.minDistance, wq.maxDistance)
  const empty = (cells: SectorCell[], partial: Partial<AccessSummary> = {}): AccessFieldResult => ({
    cells,
    points: [],
    summary: {
      cells: cells.length,
      candidates: 0,
      evaluated: 0,
      outOfTolerance: 0,
      insideBuilding: 0,
      blockedByBuilding: 0,
      blockedByTerrain: 0,
      noAccess: cells.length,
      visible: 0,
      capped: false,
      buildingsLoaded: true,
      buildingTilesRestricted: false,
      ...partial,
    },
  })
  if (!bounds) return empty([])
  const zoom = sectorTerrainZoom(bounds)
  if (zoom === null) throw new Error('Fan is too large to load terrain for; reduce the distance range.')

  report('terrain', 0.1, 0.2)(0)
  const sampler: ElevationSampler = await terrainProvider().loadArea(bounds, zoom)
  mark(`terrain z${zoom}`)
  const query: SectorQuery = { ...wq, groundHeight: (lat, lon) => sampler.sample(deg(lat), deg(lon)) }
  const cells = evaluateSector(engine, query, prep)
  mark(`cells ${cells.length}`)
  if (cells.length === 0) return empty(cells)

  const step = wq.bearingStep ?? DEFAULT_BEARING_STEP
  const grid = {
    target: wq.target,
    bearingStep: step,
    minDistance: wq.minDistance,
    maxDistance: wq.maxDistance,
    distanceSteps: wq.distanceSteps ?? DEFAULT_DISTANCE_STEPS,
  }
  const ftiles = featureTilesForCells(cells, wq.target)
  const osm = await loadOsmFeatures(ftiles.tiles, {
    onProgress: (done, total) => report('features', 0.2, 0.45)(done / total),
  })
  mark(`features ${ftiles.tiles.length} tiles (${osm.tilesFailed} failed)`)
  const cand = collectCandidates(cells, grid, osm.features)
  mark(`candidates ${cand.total}`)
  const ev = evaluateCandidates(engine, query, prep, cells, cand.byCell, undefined, report('evaluation', 0.45, 0.55))
  mark(`evaluated ${ev.evaluated}, ${ev.survivors.length} within tolerance`)

  // Buildings only within 1.5 km of a surviving point; farther buildings are ignored for occlusion.
  const btiles = buildingTilesNear(ev.survivors, undefined, BUILDING_TILE_CAP)
  let index = new BuildingIndex([])
  let buildingsLoaded = true
  if (btiles.tiles.length > 0) {
    try {
      const b = await loadBuildingTiles(btiles.tiles, {
        onProgress: (done, total) => report('buildings', 0.55, 0.8)(done / total),
      })
      index = new BuildingIndex(b.buildings)
      mark(`buildings ${b.buildings.length} in ${btiles.tiles.length} tiles (${b.tilesFailed} failed)`)
    } catch (err) {
      buildingsLoaded = false
      console.warn('[access] building tiles failed', err)
    }
  }
  const vis = filterVisible(
    ev.survivors,
    {
      terrain: sampler,
      index,
      target: wq.target,
      eyeHeight: wq.eyeHeight,
      ...(wq.refractionK === undefined ? {} : { refractionK: wq.refractionK }),
      nearFieldMeters: wq.nearFieldDistance ?? DEFAULT_NEAR_FIELD_M,
    },
    report('visibility', 0.8, 1),
  )
  mark(`visible ${vis.points.length}`)
  console.info(`[access] ${marks.join(' · ')}`)
  report('visibility', 0.8, 1)(1)
  return {
    cells,
    points: withRoadNames(vis.points, osm.features.names),
    summary: {
      cells: cells.length,
      candidates: cand.total,
      evaluated: ev.evaluated,
      outOfTolerance: ev.outOfTolerance,
      insideBuilding: vis.insideBuilding,
      blockedByBuilding: vis.blockedByBuilding,
      blockedByTerrain: vis.blockedByTerrain,
      noAccess: cand.noAccess,
      visible: vis.points.length,
      capped: ev.capped,
      buildingsLoaded,
      buildingTilesRestricted: btiles.restricted,
    },
  }
}

ctx.onmessage = (e) => {
  const req = e.data
  const fail = (err: unknown): void =>
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  try {
    if (req.type === 'findAlignments') {
      const result = findAlignments(engineFor(req.engineId), reviveQuery(req.query))
      ctx.postMessage({ id: req.id, ok: true, result: serializeAlignments(result) })
    } else if (req.type === 'sectorField') {
      runSector(req).then(
        (cells) => ctx.postMessage({ id: req.id, ok: true, sector: serializeSectorCells(cells) }),
        fail,
      )
    } else if (req.type === 'accessField') {
      runAccess(req).then(
        (r) => ctx.postMessage({ id: req.id, ok: true, access: serializeAccess(r) }),
        fail,
      )
    } else {
      throw new Error(`Unknown request type: ${String((req as { type: unknown }).type)}`)
    }
  } catch (err) {
    fail(err)
  }
}
