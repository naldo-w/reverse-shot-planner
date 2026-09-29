/**
 * AWS Open Data "Terrain Tiles" (Mapzen) Terrarium provider.
 * Browser-side decode (works in a Worker): fetch -> blob -> createImageBitmap
 * -> OffscreenCanvas -> getImageData -> decodeTerrarium.
 */

import { TileGridSampler } from '../../core/terrain/grid'
import type { DecodedTile } from '../../core/terrain/grid'
import { decodeTerrarium, despike, lonLatToTile, metersPerPixel, tilesForBounds } from '../../core/terrain/tiles'
import type { TileId } from '../../core/terrain/tiles'
import type { ElevationSampler, TerrainMetadata, TerrainProvider } from '../../core/terrain/types'
import type { Bounds } from '../../core/types'
import type { Degrees } from '../../core/units'

export const CACHE_VERSION = 'v2' // v2: despiked tiles
const TILE_SIZE = 256
const POINT_ZOOM = 13
const MAX_CONCURRENT = 6
const DB_NAME = 'rsp-terrain'
const STORE = 'tiles'

const PROVIDER = 'AWS Terrain Tiles (Mapzen)'
const DATASET = 'Terrarium (SRTM, GMTED, ETOPO1, NED, others blended)'

export type FetchLike = (url: string) => Promise<Response>
/** Decodes PNG bytes to elevations. Injectable for tests (Node has no createImageBitmap). */
export type TileDecoder = (png: Blob) => Promise<Float32Array>

export interface TerrariumOptions {
  readonly fetchImpl?: FetchLike
  readonly decodeImpl?: TileDecoder
  /** Set false to skip IndexedDB entirely. Default true (silently unused if unavailable). */
  readonly useIndexedDb?: boolean
}

export function terrariumUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
}

async function decodePngInBrowser(blob: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const img = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
    const data = decodeTerrarium(img.data, TILE_SIZE, TILE_SIZE)
    despike(data, TILE_SIZE)
    return data
  } finally {
    bitmap.close()
  }
}

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

export class TerrariumProvider implements TerrainProvider {
  private readonly fetchImpl: FetchLike
  private readonly decodeImpl: TileDecoder
  private readonly useIdb: boolean
  private readonly memory = new Map<string, Promise<Float32Array>>()
  private db: Promise<IDBDatabase | null> | null = null

  constructor(options: TerrariumOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url) => fetch(url))
    this.decodeImpl = options.decodeImpl ?? decodePngInBrowser
    this.useIdb = options.useIndexedDb ?? true
  }

  getMetadata(): TerrainMetadata {
    return {
      provider: PROVIDER,
      dataset: DATASET,
      resolutionMeters: metersPerPixel(0, 12, TILE_SIZE),
      verticalDatum: 'EGM96 (approx.)',
      surfaceType: 'DTM',
      license: 'Open data; attribution required',
      attribution:
        '* Terrain: Mapzen Terrain Tiles on AWS Open Data — SRTM/NASA, GMTED/USGS, ETOPO1/NOAA and other sources',
    }
  }

  async getElevation(lat: Degrees, lon: Degrees): Promise<number | null> {
    const { x, y } = lonLatToTile(lon, lat, POINT_ZOOM)
    const data = await this.loadTile({ z: POINT_ZOOM, x, y })
    const sampler = new TileGridSampler([{ z: POINT_ZOOM, x, y, data, size: TILE_SIZE }])
    return sampler.sample(lat, lon)
  }

  async loadArea(bounds: Bounds, zoom: number): Promise<ElevationSampler> {
    const ids = tilesForBounds(bounds, zoom)
    const tiles: DecodedTile[] = new Array<DecodedTile>(ids.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++
        const id = ids[i]
        if (!id) return
        const data = await this.loadTile(id)
        tiles[i] = { ...id, data, size: TILE_SIZE }
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, ids.length) }, worker))
    return new TileGridSampler(tiles)
  }

  private key(t: TileId): string {
    return `${PROVIDER}/${DATASET}/${CACHE_VERSION}/${t.z}/${t.x}/${t.y}`
  }

  private loadTile(t: TileId): Promise<Float32Array> {
    const key = this.key(t)
    const cached = this.memory.get(key)
    if (cached) return cached
    const p = this.fetchTile(t, key)
    this.memory.set(key, p)
    p.catch(() => this.memory.delete(key))
    return p
  }

  private async fetchTile(t: TileId, key: string): Promise<Float32Array> {
    const stored = await this.idbGet(key)
    if (stored) return stored
    const res = await this.fetchImpl(terrariumUrl(t.z, t.x, t.y))
    if (!res.ok) throw new Error(`Terrain tile ${t.z}/${t.x}/${t.y} failed: HTTP ${res.status}`)
    const data = await this.decodeImpl(await res.blob())
    void this.idbPut(key, data)
    return data
  }

  private getDb(): Promise<IDBDatabase | null> {
    if (!this.useIdb) return Promise.resolve(null)
    this.db ??= openDb()
    return this.db
  }

  private async idbGet(key: string): Promise<Float32Array | null> {
    try {
      const db = await this.getDb()
      if (!db) return null
      return await new Promise<Float32Array | null>((resolve) => {
        try {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
          req.onsuccess = () => {
            const v: unknown = req.result
            resolve(v instanceof Float32Array && v.length === TILE_SIZE * TILE_SIZE ? v : null)
          }
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
    } catch {
      return null
    }
  }

  private async idbPut(key: string, data: Float32Array): Promise<void> {
    try {
      const db = await this.getDb()
      if (!db) return
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).put(data, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      })
    } catch {
      /* cache is optional */
    }
  }
}
