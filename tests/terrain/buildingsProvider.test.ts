import { describe, expect, it } from 'vitest'
import { PbfWriter } from 'pbf'
import {
  MAX_BUILDING_TILES,
  createBuildingTileCache,
  loadBuildings,
  loadBuildingsDetailed,
  planBuildingTiles,
} from '../../src/providers/buildings/openFreeMapBuildings'
import { lonLatToTile } from '../../src/core/terrain/tiles'
import { deg } from '../../src/core/units'

const TEMPLATE = 'https://tiles.example/planet/20260101_000000_pt/{z}/{x}/{y}.pbf'

interface Rect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly props: Record<string, number>
}

const zz = (n: number): number => (n << 1) ^ (n >> 31)

/** Minimal MVT encoder: one `building` layer of rectangle polygons (extent 4096). */
function encodeTile(rects: readonly Rect[]): ArrayBuffer {
  const keys = [...new Set(rects.flatMap((r) => Object.keys(r.props)))]
  const values: number[] = []
  const layer = (_: null, p: PbfWriter): void => {
    p.writeStringField(1, 'building')
    rects.forEach((r) => {
      const tags: number[] = []
      for (const [k, v] of Object.entries(r.props)) {
        tags.push(keys.indexOf(k), values.length)
        values.push(v)
      }
      p.writeMessage(
        2,
        (_2: null, f: PbfWriter) => {
          f.writePackedVarint(2, tags)
          f.writeVarintField(3, 3)
          // Exterior ring must wind so that signed area > 0 in tile space (y down).
          f.writePackedVarint(4, [
            9,
            zz(r.x0),
            zz(r.y0),
            (3 << 3) | 2,
            zz(0),
            zz(r.y1 - r.y0),
            zz(r.x1 - r.x0),
            zz(0),
            zz(0),
            zz(-(r.y1 - r.y0)),
            15,
          ])
        },
        null,
      )
    })
    keys.forEach((k) => p.writeStringField(3, k))
    values.forEach((v) => p.writeMessage(4, (_3: null, w: PbfWriter) => w.writeDoubleField(3, v), null))
    p.writeVarintField(5, 4096)
    p.writeVarintField(15, 2)
  }
  const w = new PbfWriter()
  w.writeMessage(3, layer, null)
  const bytes = w.finish()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const bounds = { north: deg(22.3), south: deg(22.29), east: deg(114.17), west: deg(114.16) }

function fakeFetch(tile: ArrayBuffer, log: string[] = []) {
  return (url: string): Promise<Response> => {
    log.push(url)
    if (url === 'https://tiles.openfreemap.org/planet') {
      return Promise.resolve(new Response(JSON.stringify({ tiles: [TEMPLATE] }), { status: 200 }))
    }
    return Promise.resolve(new Response(tile.slice(0), { status: 200 }))
  }
}

describe('loadBuildings (OpenFreeMap, injected fetch)', () => {
  it('decodes footprints with heights, uses the TileJSON template, skips zero-height features', async () => {
    const tile = encodeTile([
      { x0: 1000, y0: 1000, x1: 1400, y1: 1300, props: { render_height: 60, render_min_height: 10 } },
      { x0: 2000, y0: 2000, x1: 2100, y1: 2100, props: { render_height: 0 } },
      { x0: 3000, y0: 3000, x1: 3100, y1: 3100, props: { render_height: 8 } },
    ])
    const log: string[] = []
    const b = await loadBuildings(bounds, { fetchImpl: fakeFetch(tile, log) })
    expect(log[0]).toBe('https://tiles.openfreemap.org/planet')
    expect(log.slice(1).every((u) => u.startsWith('https://tiles.example/planet/20260101_000000_pt/14/'))).toBe(true)
    expect(b.length).toBe(2 * (log.length - 1))
    const tall = b.find((x) => x.height === 60)
    expect(tall).toBeDefined()
    expect(tall?.minHeight).toBe(10)
    expect(b.find((x) => x.height === 8)?.minHeight).toBe(0)
    // Geometry: the first tile's 60 m building starts at tile pixel (1000, 1000).
    const m = /\/14\/(\d+)\/(\d+)\.pbf$/.exec(log[1] ?? '')
    const tx = Number(m?.[1])
    const ty = Number(m?.[2])
    const first = b[0]
    expect(first?.height).toBe(60)
    const lons = (first?.ring ?? []).map((p) => p[0])
    expect(Math.min(...lons)).toBeCloseTo(((tx + 1000 / 4096) / 2 ** 14) * 360 - 180, 9)
    expect(Math.max(...lons)).toBeCloseTo(((tx + 1400 / 4096) / 2 ** 14) * 360 - 180, 9)
    const lats = (first?.ring ?? []).map((p) => p[1])
    const latOf = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** 14))) * 180) / Math.PI
    expect(Math.max(...lats)).toBeCloseTo(latOf(ty + 1000 / 4096), 9)
    expect(Math.min(...lats)).toBeCloseTo(latOf(ty + 1300 / 4096), 9)
  })

  it('caches tile bytes per tile when a cache is shared', async () => {
    const tile = encodeTile([{ x0: 0, y0: 0, x1: 100, y1: 100, props: { render_height: 5 } }])
    const log: string[] = []
    const cache = createBuildingTileCache()
    const f = fakeFetch(tile, log)
    await loadBuildings(bounds, { fetchImpl: f, cache })
    const n = log.filter((u) => u.endsWith('.pbf')).length
    await loadBuildings(bounds, { fetchImpl: f, cache })
    expect(log.filter((u) => u.endsWith('.pbf')).length).toBe(n)
  })

  it('treats 404 as an empty tile and reports partial failures', async () => {
    const tile = encodeTile([{ x0: 0, y0: 0, x1: 100, y1: 100, props: { render_height: 5 } }])
    const wide = { north: deg(22.3), south: deg(22.29), east: deg(114.2), west: deg(114.16) }
    let i = 0
    const f = (url: string): Promise<Response> => {
      if (url.endsWith('/planet')) return Promise.resolve(new Response(JSON.stringify({ tiles: [TEMPLATE] })))
      i++
      if (i === 1) return Promise.reject(new Error('boom'))
      if (i === 2) return Promise.resolve(new Response(null, { status: 404 }))
      return Promise.resolve(new Response(tile.slice(0), { status: 200 }))
    }
    const r = await loadBuildingsDetailed(wide, { fetchImpl: f })
    expect(r.tilesRequested).toBeGreaterThanOrEqual(3)
    expect(r.tilesFailed).toBe(1)
  })

  it('throws when every tile fails', async () => {
    const f = (url: string): Promise<Response> =>
      url.endsWith('/planet')
        ? Promise.resolve(new Response(JSON.stringify({ tiles: [TEMPLATE] })))
        : Promise.resolve(new Response(null, { status: 500 }))
    await expect(loadBuildings(bounds, { fetchImpl: f })).rejects.toThrow()
  })
})

describe('planBuildingTiles cap', () => {
  it('returns every tile when within the cap', () => {
    const p = planBuildingTiles(bounds)
    expect(p.restricted).toBe(false)
    expect(p.tiles.length).toBeGreaterThan(0)
  })

  it('restricts to camera disc + corridor when over 64 tiles', () => {
    const cam = { lat: 22.3, lon: 114.17 }
    const lm = { lat: 22.3, lon: 114.4 } // ~23.7 km east
    const big = { north: deg(22.4), south: deg(22.2), east: deg(114.45), west: deg(114.1) }
    const p = planBuildingTiles(big, cam, lm)
    expect(p.restricted).toBe(true)
    expect(p.tiles.length).toBeLessThanOrEqual(MAX_BUILDING_TILES)
    const camTile = lonLatToTile(cam.lon, cam.lat, 14)
    expect(p.tiles.some((t) => t.x === camTile.x && t.y === camTile.y)).toBe(true)
    // Corridor reaches well beyond 3 km of the camera, but off-corridor far corners are excluded.
    const lmTile = lonLatToTile(lm.lon, lm.lat, 14)
    expect(p.tiles.some((t) => t.x >= lmTile.x - 1 && t.y === lmTile.y)).toBe(true)
    const farCorner = lonLatToTile(114.1, 22.4, 14)
    expect(p.tiles.some((t) => t.x === farCorner.x && t.y === farCorner.y)).toBe(false)
  })
})
