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
  type SectorFieldRequest,
} from '../core/planner/wire'
import { evaluateSector, prepareSector, sectorBounds, sectorTerrainZoom } from '../core/search/sectors'
import type { SectorCell, SectorQuery } from '../core/search/sectors'
import { reviveSectorQuery, serializeSectorCells } from '../core/search/wire'
import { rayVisibility } from '../core/terrain/horizon'
import type { ElevationSampler, TerrainProvider } from '../core/terrain/types'
import { deg, m } from '../core/units'
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
    } else {
      throw new Error(`Unknown request type: ${String((req as { type: unknown }).type)}`)
    }
  } catch (err) {
    fail(err)
  }
}
