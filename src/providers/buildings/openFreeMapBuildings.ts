/**
 * OpenStreetMap building footprints with heights, from OpenFreeMap vector tiles
 * (OpenMapTiles schema, layer `building`, zoom 14). Browser-side: fetch the
 * TileJSON for the current dated tile URL, fetch the .pbf tiles covering the
 * area, decode with @mapbox/vector-tile.
 *
 * Height caveat (spec honesty note): `render_height` / `render_min_height` are
 * derived by OpenMapTiles from OSM `height`, `building:levels` and roof tags;
 * where OSM has none the schema fills a default. Heights are therefore partly
 * estimated, and unmapped buildings are missing altogether. Trees are not
 * included. Data © OpenStreetMap contributors (ODbL).
 *
 * Tile cap: at most MAX_BUILDING_TILES (64) tiles are fetched. If the bounds
 * need more, the request is restricted to tiles within 3 km of the camera and
 * within 1 km of the camera -> landmark corridor; if that still exceeds the
 * cap, the tiles nearest the camera are kept. `restricted` is reported so the
 * UI can say coverage is limited.
 */

import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { offsetCoordinate } from '../../core/geometry/geodesy'
import { lonLatToTile, tileBounds } from '../../core/terrain/tiles'
import type { TileId } from '../../core/terrain/tiles'
import type { Bounds } from '../../core/types'
import { deg, m } from '../../core/units'

export const BUILDING_ZOOM = 14
export const MAX_BUILDING_TILES = 64
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const CAMERA_RADIUS_M = 3000
const CORRIDOR_HALF_WIDTH_M = 1000
const MAX_CONCURRENT = 6
const DB_NAME = 'rsp-buildings'
const STORE = 'tiles'

export interface Building {
  /** Outer ring, [lon, lat] pairs (closed or open). */
  readonly ring: readonly (readonly [number, number])[]
  /** Roof height above ground, metres (`render_height`). */
  readonly height: number
  /** Height of the building part's underside above ground, metres (`render_min_height`). */
  readonly minHeight: number
}

export type BuildingFetch = (url: string) => Promise<Response>

/** Raw tile bytes by tile URL; empty tiles are stored as zero-length buffers. */
export type BuildingTileCache = Map<string, Promise<ArrayBuffer>>

export function createBuildingTileCache(): BuildingTileCache {
  return new Map()
}

export interface LoadBuildingsOptions {
  readonly fetchImpl?: BuildingFetch
  /** Used only to restrict the tile set when `bounds` needs more than 64 tiles. */
  readonly camera?: { readonly lat: number; readonly lon: number }
  readonly landmark?: { readonly lat: number; readonly lon: number }
  /** Tile-bytes cache. Default: a shared module cache with the real network, a fresh one per call with an injected fetch. */
  readonly cache?: BuildingTileCache
  /** IndexedDB persistence of tile bytes (default true; silently unused where unavailable). */
  readonly useIndexedDb?: boolean
}

export interface BuildingLoadResult {
  readonly buildings: Building[]
  readonly tilesRequested: number
  readonly tilesFailed: number
  /** True when the tile set was cut down to the camera/corridor rule or the 64-tile cap. */
  readonly restricted: boolean
}

const sharedCache: BuildingTileCache = new Map()
let sharedTemplate: Promise<string> | null = null

function tileJsonTemplate(fetchImpl: BuildingFetch, shared: boolean): Promise<string> {
  const load = async (): Promise<string> => {
    const res = await fetchImpl(TILEJSON_URL)
    if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`)
    const json = (await res.json()) as { tiles?: unknown }
    const first = Array.isArray(json.tiles) ? json.tiles[0] : undefined
    if (typeof first !== 'string' || !first.includes('{z}')) throw new Error('TileJSON has no tiles template')
    return first
  }
  if (!shared) return load()
  sharedTemplate ??= load().catch((e: unknown) => {
    sharedTemplate = null
    throw e
  })
  return sharedTemplate
}

function tileUrl(template: string, t: TileId): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
}

/** Tile range covering `bounds` (no cap, no wrapping across the antimeridian). */
function rangeForBounds(bounds: Bounds, z: number): { x0: number; x1: number; y0: number; y1: number } {
  const nw = lonLatToTile(bounds.west, bounds.north, z)
  const se = lonLatToTile(bounds.east, bounds.south, z)
  return { x0: nw.x, x1: Math.max(nw.x, se.x), y0: nw.y, y1: Math.max(nw.y, se.y) }
}

export function planBuildingTiles(
  bounds: Bounds,
  camera?: { lat: number; lon: number },
  landmark?: { lat: number; lon: number },
): { tiles: TileId[]; restricted: boolean } {
  const z = BUILDING_ZOOM
  const r = rangeForBounds(bounds, z)
  const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
  if (count <= MAX_BUILDING_TILES) {
    const tiles: TileId[] = []
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) tiles.push({ z, x, y })
    return { tiles, restricted: false }
  }
  // Restricted: tiles touched by the camera disc and the corridor, inside the requested range.
  const centre = camera ?? { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 }
  const pts: { lat: number; lon: number }[] = []
  const add = (east: number, north: number, at: { lat: number; lon: number }): void => {
    const c = offsetCoordinate({ lat: deg(at.lat), lon: deg(at.lon) }, m(east), m(north))
    pts.push({ lat: c.lat, lon: c.lon })
  }
  // Ring of sample points every 500 m out to 3 km (tile width ~2.3 km at z14, so this catches every touched tile).
  for (let east = -CAMERA_RADIUS_M; east <= CAMERA_RADIUS_M; east += 500) {
    for (let north = -CAMERA_RADIUS_M; north <= CAMERA_RADIUS_M; north += 500) {
      if (Math.hypot(east, north) <= CAMERA_RADIUS_M + 250) add(east, north, centre)
    }
  }
  if (landmark && camera) {
    const dE = ((landmark.lon - camera.lon) * Math.PI) / 180 * 6_371_008.8 * Math.cos((camera.lat * Math.PI) / 180)
    const dN = ((landmark.lat - camera.lat) * Math.PI) / 180 * 6_371_008.8
    const len = Math.hypot(dE, dN)
    if (len > 0) {
      const ux = dE / len
      const uy = dN / len
      for (let d = 0; d <= len; d += 500) {
        for (const side of [-CORRIDOR_HALF_WIDTH_M, 0, CORRIDOR_HALF_WIDTH_M]) {
          add(d * ux - uy * side, d * uy + ux * side, camera)
        }
      }
    }
  }
  const seen = new Map<string, TileId>()
  for (const p of pts) {
    const t = lonLatToTile(p.lon, p.lat, z)
    if (t.x < r.x0 || t.x > r.x1 || t.y < r.y0 || t.y > r.y1) continue
    seen.set(`${t.x}/${t.y}`, { z, x: t.x, y: t.y })
  }
  let tiles = [...seen.values()]
  if (tiles.length > MAX_BUILDING_TILES) {
    const cLon = centre.lon
    const cLat = centre.lat
    const dist = (t: TileId): number => {
      const b = tileBounds(t.z, t.x, t.y)
      return Math.hypot(((b.east + b.west) / 2 - cLon) * Math.cos((cLat * Math.PI) / 180), (b.north + b.south) / 2 - cLat)
    }
    tiles = tiles.sort((a, b) => dist(a) - dist(b)).slice(0, MAX_BUILDING_TILES)
  }
  return { tiles, restricted: true }
}

// ---- IndexedDB (optional, best effort) ----

function openDb(): Promise<IDBDatabase | null> {
  try {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          try {
            req.result.createObjectStore(STORE)
          } catch {
            /* ignore */
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  } catch {
    return Promise.resolve(null)
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  try {
    dbPromise ??= openDb()
    const db = await dbPromise
    if (!db) return null
    return await new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
        req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  } catch {
    return null
  }
}

async function idbPut(key: string, value: ArrayBuffer): Promise<void> {
  try {
    dbPromise ??= openDb()
    const db = await dbPromise
    if (!db) return
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
  } catch {
    /* ignore */
  }
}

// ---- Decoding ----

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Decode the `building` layer of one tile to footprints (outer rings only; holes are ignored). */
export function decodeBuildingTile(bytes: ArrayBuffer, t: TileId): Building[] {
  if (bytes.byteLength === 0) return []
  const tile = new VectorTile(new PbfReader(bytes))
  const layer = tile.layers['building']
  if (!layer) return []
  const n = 2 ** t.z
  const out: Building[] = []
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i)
    if (f.type !== 3) continue
    const height = num(f.properties['render_height'])
    if (height <= 0) continue
    const minHeight = Math.min(num(f.properties['render_min_height']), height)
    const scale = f.extent
    for (const poly of classifyRings(f.loadGeometry())) {
      const outer = poly[0]
      if (!outer || outer.length < 4) continue
      const ring: [number, number][] = outer.map((p) => {
        const lon = ((t.x + p.x / scale) / n) * 360 - 180
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + p.y / scale)) / n))) * 180) / Math.PI
        return [lon, lat]
      })
      out.push({ ring, height, minHeight })
    }
  }
  return out
}

async function fetchTileBytes(
  url: string,
  fetchImpl: BuildingFetch,
  cache: BuildingTileCache,
  useDb: boolean,
): Promise<ArrayBuffer> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = (async (): Promise<ArrayBuffer> => {
    if (useDb) {
      const stored = await idbGet(url)
      if (stored) return stored
    }
    const res = await fetchImpl(url)
    if (res.status === 404 || res.status === 204) return new ArrayBuffer(0)
    if (!res.ok) throw new Error(`Building tile HTTP ${res.status}`)
    const bytes = await res.arrayBuffer()
    if (useDb) void idbPut(url, bytes)
    return bytes
  })()
  cache.set(url, p)
  // Failures are not cached.
  p.catch(() => {
    if (cache.get(url) === p) cache.delete(url)
  })
  return p
}

/** Buildings covering `bounds`, plus load diagnostics. Throws only if every tile failed. */
export async function loadBuildingsDetailed(
  bounds: Bounds,
  opts: LoadBuildingsOptions = {},
): Promise<BuildingLoadResult> {
  const injected = opts.fetchImpl !== undefined
  const fetchImpl: BuildingFetch = opts.fetchImpl ?? ((url) => fetch(url))
  const cache = opts.cache ?? (injected ? createBuildingTileCache() : sharedCache)
  const useDb = (opts.useIndexedDb ?? true) && !injected
  const plan = planBuildingTiles(bounds, opts.camera, opts.landmark)
  const template = await tileJsonTemplate(fetchImpl, !injected)

  const results: (Building[] | null)[] = plan.tiles.map(() => null)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      const t = plan.tiles[i]
      if (!t) return
      try {
        const bytes = await fetchTileBytes(tileUrl(template, t), fetchImpl, cache, useDb)
        results[i] = decodeBuildingTile(bytes, t)
      } catch {
        results[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, plan.tiles.length) }, worker))

  const failed = results.filter((r) => r === null).length
  if (plan.tiles.length > 0 && failed === plan.tiles.length) throw new Error('All building tiles failed to load')
  const buildings = results.flatMap((r) => r ?? [])
  return { buildings, tilesRequested: plan.tiles.length, tilesFailed: failed, restricted: plan.restricted }
}

/** Buildings covering `bounds` (see module notes for the tile cap). */
export async function loadBuildings(bounds: Bounds, opts: LoadBuildingsOptions = {}): Promise<Building[]> {
  return (await loadBuildingsDetailed(bounds, opts)).buildings
}
