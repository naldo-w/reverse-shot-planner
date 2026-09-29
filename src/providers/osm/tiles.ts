/**
 * Shared OpenFreeMap vector-tile plumbing (OpenMapTiles schema, zoom 14):
 * TileJSON discovery, tile-byte fetching with an in-memory + IndexedDB cache,
 * bounded concurrency and pixel -> lon/lat conversion.
 *
 * A vector tile holds every layer, so the buildings loader and the OSM
 * feature loader share one byte cache: whichever asks second gets the bytes
 * for free. Empty tiles (HTTP 204/404) are cached as zero-length buffers.
 */

import type { TileId } from '../../core/terrain/tiles'

export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
export const OSM_TILE_ZOOM = 14
export const TILE_CONCURRENCY = 6
const DB_NAME = 'rsp-buildings'
const STORE = 'tiles'

export type TileFetch = (url: string) => Promise<Response>

/** Raw tile bytes by tile URL. */
export type TileBytesCache = Map<string, Promise<ArrayBuffer>>

export const createTileBytesCache = (): TileBytesCache => new Map()

/** Module cache used with the real network (an injected fetch gets a fresh cache unless one is passed). */
export const sharedTileCache: TileBytesCache = new Map()
let sharedTemplate: Promise<string> | null = null

export function tileJsonTemplate(fetchImpl: TileFetch, shared: boolean): Promise<string> {
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

export function tileUrl(template: string, t: TileId): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
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

export async function fetchTileBytes(
  url: string,
  fetchImpl: TileFetch,
  cache: TileBytesCache,
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
    if (!res.ok) throw new Error(`Vector tile HTTP ${res.status}`)
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

export interface TileFetchOptions {
  readonly fetchImpl?: TileFetch
  readonly cache?: TileBytesCache
  /** IndexedDB persistence of tile bytes (default true; silently unused where unavailable or with an injected fetch). */
  readonly useIndexedDb?: boolean
  /** Called after each tile finishes (done, total). */
  readonly onProgress?: (done: number, total: number) => void
}

/**
 * Fetch and decode `tiles` with at most TILE_CONCURRENCY requests in flight.
 * A tile that fails yields null. Throws only when every tile failed.
 */
export async function loadTiles<T>(
  tiles: readonly TileId[],
  opts: TileFetchOptions,
  decode: (bytes: ArrayBuffer, tile: TileId) => T,
): Promise<(T | null)[]> {
  const injected = opts.fetchImpl !== undefined
  const fetchImpl: TileFetch = opts.fetchImpl ?? ((url) => fetch(url))
  const cache = opts.cache ?? (injected ? createTileBytesCache() : sharedTileCache)
  const useDb = (opts.useIndexedDb ?? true) && !injected
  const results: (T | null)[] = tiles.map(() => null)
  if (tiles.length === 0) return results
  const template = await tileJsonTemplate(fetchImpl, !injected)
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      const t = tiles[i]
      if (!t) return
      try {
        const bytes = await fetchTileBytes(tileUrl(template, t), fetchImpl, cache, useDb)
        results[i] = decode(bytes, t)
      } catch {
        results[i] = null
      }
      opts.onProgress?.(++done, tiles.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, tiles.length) }, worker))
  if (results.every((r) => r === null)) throw new Error('All vector tiles failed to load')
  return results
}

/** Tile-pixel coordinates to [lon, lat]. */
export function tilePointToLonLat(t: TileId, px: number, py: number, extent: number): [number, number] {
  const n = 2 ** t.z
  const lon = ((t.x + px / extent) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + py / extent)) / n))) * 180) / Math.PI
  return [lon, lat]
}
