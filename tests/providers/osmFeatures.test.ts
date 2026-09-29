import { describe, expect, it } from 'vitest'
import { lonLatToTile } from '../../src/core/terrain/tiles'
import { decodeFeatureTile, loadOsmFeatures } from '../../src/providers/osm/openFreeMapFeatures'
import { tilePointToLonLat } from '../../src/providers/osm/tiles'
import { encodeTile, fakeTileFetch } from '../helpers/mvt'

const tileXY = lonLatToTile(114.19, 22.33, 14)
const TILE = { z: 14, ...tileXY }

const sample = encodeTile([
  {
    name: 'transportation',
    features: [
      { kind: 'line', pts: [[100, 100], [900, 120]], props: { class: 'path', subclass: 'footway' } },
      { kind: 'line', pts: [[100, 300], [900, 300]], props: { class: 'path', subclass: 'steps' } },
      { kind: 'line', pts: [[100, 400], [900, 400]], props: { class: 'path', subclass: 'corridor' } },
      { kind: 'line', pts: [[100, 500], [900, 500]], props: { class: 'minor' } },
      { kind: 'line', pts: [[100, 600], [900, 600]], props: { class: 'service', service: 'driveway' } },
      { kind: 'line', pts: [[100, 700], [900, 700]], props: { class: 'service' } },
      { kind: 'line', pts: [[100, 800], [900, 800]], props: { class: 'primary' } },
      { kind: 'line', pts: [[100, 900], [900, 900]], props: { class: 'motorway' } },
      { kind: 'line', pts: [[100, 1000], [900, 1000]], props: { class: 'trunk' } },
      { kind: 'line', pts: [[100, 1100], [900, 1100]], props: { class: 'rail' } },
      { kind: 'line', pts: [[100, 1200], [900, 1200]], props: { class: 'ferry' } },
      { kind: 'line', pts: [[100, 1300], [900, 1300]], props: { class: 'minor', brunnel: 'tunnel' } },
      { kind: 'line', pts: [[100, 1400], [900, 1400]], props: { class: 'tertiary', brunnel: 'bridge' } },
      { kind: 'line', pts: [[100, 1500], [900, 1500]], props: { class: 'minor', access: 'private' } },
      { kind: 'line', pts: [[100, 1600], [900, 1600]], props: { class: 'track' } },
    ],
  },
  {
    name: 'transportation_name',
    features: [{ kind: 'line', pts: [[100, 500], [900, 500]], props: { class: 'minor', name: 'Test Road' } }],
  },
  {
    name: 'park',
    features: [
      { kind: 'rect', x0: 2000, y0: 2000, x1: 2400, y1: 2300, props: { class: 'park', name: 'Test Park' } },
      { kind: 'rect', x0: 2600, y0: 2000, x1: 2700, y1: 2100, props: { class: 'national_park', name: 'Big Reserve' } },
    ],
  },
  {
    name: 'landuse',
    features: [
      { kind: 'rect', x0: 3000, y0: 2000, x1: 3100, y1: 2100, props: { class: 'recreation_ground' } },
      { kind: 'rect', x0: 3200, y0: 2000, x1: 3300, y1: 2100, props: { class: 'residential' } },
    ],
  },
  {
    name: 'landcover',
    features: [
      { kind: 'rect', x0: 3400, y0: 2000, x1: 3500, y1: 2100, props: { class: 'grass', subclass: 'park' } },
      { kind: 'rect', x0: 3600, y0: 2000, x1: 3700, y1: 2100, props: { class: 'grass', subclass: 'grass' } },
    ],
  },
  { name: 'water', features: [{ kind: 'rect', x0: 0, y0: 3000, x1: 4096, y1: 4096, props: { class: 'ocean' } }] },
  {
    name: 'poi',
    features: [
      { kind: 'point', x: 1000, y: 3500, props: { class: 'attraction', subclass: 'viewpoint', name: 'Lookout' } },
      { kind: 'point', x: 1100, y: 3500, props: { class: 'restaurant', subclass: 'restaurant', name: 'Cafe' } },
      { kind: 'point', x: 1200, y: 3500, props: { class: 'park', subclass: 'playground' } },
    ],
  },
])

describe('decodeFeatureTile', () => {
  const f = decodeFeatureTile(sample, TILE)

  it('keeps paths, minor roads and roads; excludes motorway, trunk, rail, ferry, tunnels, private and driveways', () => {
    const kinds = f.lines.map((l) => `${l.kind}${l.bridge ? '+bridge' : ''}`)
    expect(kinds.sort()).toEqual(
      ['minor-road', 'minor-road', 'path', 'path', 'path', 'road', 'road+bridge'].sort(),
    )
    // corridor (indoor) path subclass is dropped; the track is a path.
    expect(f.lines.filter((l) => l.kind === 'path')).toHaveLength(3)
  })

  it('decodes line geometry to lon/lat inside the tile', () => {
    const first = f.lines[0]!
    const [lon, lat] = first.coords[0]!
    const [elon, elat] = tilePointToLonLat(TILE, 100, 100, 4096)
    expect(lon).toBeCloseTo(elon, 9)
    expect(lat).toBeCloseTo(elat, 9)
  })

  it('keeps public open space polygons only, with names', () => {
    const names = f.areas.map((a) => a.name ?? '')
    expect(f.areas).toHaveLength(3) // park, recreation_ground, grass/park
    expect(names).toContain('Test Park')
    expect(names).not.toContain('Big Reserve')
    for (const a of f.areas) expect(a.rings[0]!.length).toBeGreaterThanOrEqual(4)
  })

  it('collects water polygons, viewpoint and park POIs, and road names', () => {
    expect(f.water).toHaveLength(1)
    expect(f.pois.map((p) => `${p.kind}:${p.name ?? ''}`).sort()).toEqual(['park:', 'viewpoint:Lookout'])
    expect(f.names.map((n) => n.name)).toEqual(['Test Road'])
  })

  it('empty tile bytes decode to nothing', () => {
    const e = decodeFeatureTile(new ArrayBuffer(0), TILE)
    expect(e.lines).toHaveLength(0)
    expect(e.pois).toHaveLength(0)
  })
})

describe('loadOsmFeatures', () => {
  it('fetches via TileJSON, decodes and merges tiles, shares the byte cache and reports progress', async () => {
    const log: string[] = []
    const seen: number[] = []
    const tiles = [TILE, { z: 14, x: TILE.x + 1, y: TILE.y }]
    const r = await loadOsmFeatures(tiles, {
      fetchImpl: fakeTileFetch(sample, log),
      onProgress: (done, total) => seen.push(done / total),
    })
    expect(r.tilesRequested).toBe(2)
    expect(r.tilesFailed).toBe(0)
    expect(r.features.lines).toHaveLength(14)
    expect(log[0]).toBe('https://tiles.openfreemap.org/planet')
    expect(seen.at(-1)).toBe(1)
  })

  it('throws when every tile fails and tolerates a partial failure', async () => {
    const bad = (url: string): Promise<Response> =>
      url.endsWith('/planet')
        ? Promise.resolve(new Response(JSON.stringify({ tiles: ['https://t.example/{z}/{x}/{y}.pbf'] })))
        : Promise.resolve(new Response(null, { status: 500 }))
    await expect(loadOsmFeatures([TILE], { fetchImpl: bad })).rejects.toThrow()
    let n = 0
    const half = (url: string): Promise<Response> => {
      if (url.endsWith('/planet')) return Promise.resolve(new Response(JSON.stringify({ tiles: ['https://t.example/{z}/{x}/{y}.pbf'] })))
      n++
      return n === 1 ? Promise.resolve(new Response(null, { status: 500 })) : Promise.resolve(new Response(sample.slice(0)))
    }
    const r = await loadOsmFeatures([TILE, { z: 14, x: TILE.x + 1, y: TILE.y }], { fetchImpl: half })
    expect(r.tilesFailed).toBe(1)
    expect(r.features.lines.length).toBeGreaterThan(0)
  })
})
