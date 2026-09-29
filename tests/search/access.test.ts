import { describe, expect, it } from 'vitest'
import { createCelestialEngine } from '../../src/core/astronomy'
import { destinationPoint } from '../../src/core/geometry/geodesy'
import { findAlignments, targetPosition } from '../../src/core/planner'
import {
  ACCESS_PRIORITY,
  CellLocator,
  buildingTilesNear,
  collectCandidates,
  evaluateCandidates,
  featureTilesForCells,
  filterVisible,
  roadNameAt,
  topAccessPoints,
  withRoadNames,
} from '../../src/core/search/access'
import type { AccessFeatures, AccessPoint, CellGridSpec, LonLat } from '../../src/core/search/access'
import { cellPolygon, prepareSector, evaluateSector } from '../../src/core/search/sectors'
import type { SectorCell, SectorQuery } from '../../src/core/search/sectors'
import { AnalyticSampler } from '../../src/core/terrain/grid'
import { BuildingIndex } from '../../src/core/terrain/composite'
import { PRESET_LANDMARKS } from '../../src/data/presets'
import { deg, m } from '../../src/core/units'

const engine = createCelestialEngine()
const lionRock = PRESET_LANDMARKS.find((l) => l.id === 'lion-rock')!
const target = targetPosition(lionRock)
const flat = (): number => 20
const terrain = new AnalyticSampler(flat, undefined, 17)

const STEP = 1
const STEPS = 20
function query(over: Partial<SectorQuery> = {}): SectorQuery {
  return {
    target,
    body: 'sun',
    start: new Date('2026-10-01T00:00:00Z'),
    end: new Date('2026-12-01T00:00:00Z'),
    event: 'set',
    minDistance: m(3000),
    maxDistance: m(14000),
    bearingStep: deg(STEP),
    distanceSteps: STEPS,
    eyeHeight: m(1.6),
    groundHeight: flat,
    desiredOffset: deg(0),
    tolerance: deg(0.5),
    ...over,
  }
}
const grid: CellGridSpec = {
  target,
  bearingStep: STEP,
  minDistance: 3000,
  maxDistance: 14000,
  distanceSteps: STEPS,
}

const q = query()
const prep = prepareSector(engine, q)
const cells = evaluateSector(engine, q, prep)
/** A mid-fan cell with a comfortable size (6-10 km out). */
const mid = cells.findIndex((c) => c.distance > 6000 && c.distance < 10000 && Math.abs(c.best.offsetError) < 0.2)
const cell = cells[mid] as SectorCell

const geo = { lat: target.lat, lon: target.lon }
const at = (bearing: number, d: number): LonLat => {
  const p = destinationPoint({ lat: deg(geo.lat), lon: deg(geo.lon) }, deg(bearing), m(d))
  return [p.lon, p.lat]
}
/** Tangential chord across the middle of `cell`. */
const chord = (c: SectorCell): LonLat[] => [at(c.bearing - 0.4, c.distance), at(c.bearing + 0.4, c.distance)]

const shifted = (c: SectorCell, f: number): LonLat[] => [at(c.bearing - 0.4, c.distance * f), at(c.bearing + 0.4, c.distance * f)]

const none: AccessFeatures = { lines: [], areas: [], water: [], pois: [], names: [] }

describe('CellLocator', () => {
  it('maps cell centres and interior points back to their own cell', () => {
    const loc = new CellLocator(cells, grid)
    for (let i = 0; i < cells.length; i += Math.ceil(cells.length / 40)) {
      const c = cells[i] as SectorCell
      expect(loc.locate(c.lat, c.lon)).toBe(i)
    }
    const [lon, lat] = at(cell.bearing + 0.3, cell.distance * 1.01)
    expect(loc.locate(lat, lon)).toBe(mid)
    expect(loc.locate(geo.lat, geo.lon)).toBe(-1)
    const [flon, flat2] = at(cell.bearing, 30_000)
    expect(loc.locate(flat2, flon)).toBe(-1)
  })
})

describe('collectCandidates', () => {
  it('a road through a cell yields candidates about 25 m apart, all inside the cell', () => {
    const f: AccessFeatures = { ...none, lines: [{ kind: 'minor-road', bridge: false, coords: chord(cell) }] }
    const r = collectCandidates(cells, grid, f)
    const list = r.byCell[mid] ?? []
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(list.length).toBeLessThanOrEqual(8)
    expect(list.every((c) => c.kind === 'minor-road' && c.cell === mid)).toBe(true)
    const loc = new CellLocator(cells, grid)
    for (const c of list) expect(loc.locate(c.lat, c.lon)).toBe(mid)
    expect(r.total).toBe(list.length)
    // Cells the road does not touch have no access.
    expect(r.noAccess).toBe(cells.length - 1)
  })

  it('respects the per-cell cap and spreads the points out', () => {
    const [a, b] = chord(cell) as [LonLat, LonLat]
    const dense = Array.from({ length: 30 }, (_, i) => ({
      kind: 'path' as const,
      bridge: false,
      coords: [
        [a[0], a[1] + i * 1e-6],
        [b[0], b[1] + i * 1e-6],
      ] as LonLat[],
    }))
    const r = collectCandidates(cells, grid, { ...none, lines: dense }, { perCell: 4, lineSpacing: 5 })
    const list = r.byCell[mid] ?? []
    expect(list).toHaveLength(4)
    // Farthest-point picking: the two most distant points of the chord are among the picks.
    const lons = list.map((c) => c.lon)
    const span = Math.max(...lons) - Math.min(...lons)
    expect(span).toBeGreaterThan(Math.abs(b[0] - a[0]) * 0.6)
  })

  it('orders by priority: viewpoint > park > path > minor road > road, roads left out when slots run out', () => {
    const c = cell
    const ring = cellPolygon(c, geo) // closed ring, inside the cell
    const lonsArr = ring.map((p) => p[0])
    const latsArr = ring.map((p) => p[1])
    const box = [Math.min(...lonsArr), Math.min(...latsArr), Math.max(...lonsArr), Math.max(...latsArr)] as const
    const parkRing: LonLat[] = [
      [box[0], box[1]],
      [box[2], box[1]],
      [box[2], box[3]],
      [box[0], box[3]],
      [box[0], box[1]],
    ]
    const f: AccessFeatures = {
      ...none,
      pois: [{ kind: 'viewpoint', name: 'Lookout', lon: c.lon, lat: c.lat }],
      areas: [{ name: 'Park', rings: [parkRing] }],
      // Separate offsets so identical-position dedupe does not merge them.
      lines: [
        { kind: 'road', bridge: false, coords: shifted(c, 0.985) },
        { kind: 'minor-road', bridge: false, coords: shifted(c, 1) },
        { kind: 'path', bridge: false, coords: shifted(c, 1.015) },
      ],
    }
    const list = (collectCandidates(cells, grid, f, { perCell: 4 }).byCell[mid] ?? []).map((x) => x.kind)
    expect(list).toHaveLength(4)
    expect(list).toContain('viewpoint')
    expect(list).toContain('park')
    expect(list).not.toContain('road')
    expect(list).not.toContain('minor-road')
    expect(ACCESS_PRIORITY.viewpoint).toBeLessThan(ACCESS_PRIORITY.park)
    expect(ACCESS_PRIORITY.park).toBeLessThan(ACCESS_PRIORITY.path)
    expect(ACCESS_PRIORITY['minor-road']).toBeLessThan(ACCESS_PRIORITY.road)
    // With room for everything all kinds show up.
    const noPark = { ...f, areas: [] }
    const all = (collectCandidates(cells, grid, noPark, { perCell: 14 }).byCell[mid] ?? []).map((x) => x.kind)
    expect(new Set(all)).toEqual(new Set(['viewpoint', 'path', 'minor-road', 'road']))
    // A big park takes at most half of the slots, so paths still get a share.
    const full = (collectCandidates(cells, grid, f, { perCell: 8 }).byCell[mid] ?? []).map((x) => x.kind)
    expect(full.filter((k) => k === 'park').length).toBeLessThanOrEqual(4)
    expect(full).toContain('path')
  })

  it('drops points in water except on bridges', () => {
    const c = cell
    const box = { d: 0.01 }
    const water: LonLat[] = [
      [c.lon - box.d, c.lat - box.d],
      [c.lon + box.d, c.lat - box.d],
      [c.lon + box.d, c.lat + box.d],
      [c.lon - box.d, c.lat + box.d],
      [c.lon - box.d, c.lat - box.d],
    ]
    const wet: AccessFeatures = {
      ...none,
      water: [{ rings: [water] }],
      lines: [{ kind: 'path', bridge: false, coords: chord(c) }],
      pois: [{ kind: 'viewpoint', lon: c.lon, lat: c.lat }],
    }
    expect(collectCandidates(cells, grid, wet).total).toBe(0)
    const bridge: AccessFeatures = { ...wet, pois: [], lines: [{ kind: 'road', bridge: true, coords: chord(c) }] }
    expect(collectCandidates(cells, grid, bridge).total).toBeGreaterThan(0)
  })

  it('deduplicates features repeated in neighbouring tiles', () => {
    const line = { kind: 'path' as const, bridge: false, coords: chord(cell) }
    const once = collectCandidates(cells, grid, { ...none, lines: [line] }).total
    const twice = collectCandidates(cells, grid, { ...none, lines: [line, line] }).total
    expect(twice).toBe(once)
  })
})

describe('evaluate + visibility', () => {
  const road: AccessFeatures = {
    ...none,
    lines: [{ kind: 'minor-road', bridge: false, coords: [at(cell.bearing - 0.45, cell.distance * 0.97), at(cell.bearing + 0.45, cell.distance * 1.03)] }],
  }
  const cand = collectCandidates(cells, grid, road)
  const ev = evaluateCandidates(engine, q, prep, cells, cand.byCell)

  it('re-evaluates at the exact point; survivors match findAlignments from that point', () => {
    expect(ev.evaluated).toBe(cand.total)
    expect(ev.survivors.length).toBeGreaterThan(0)
    for (const s of ev.survivors) {
      expect(Math.abs(s.best.offsetError)).toBeLessThanOrEqual(0.5)
      const cam = { lat: deg(s.lat), lon: deg(s.lon), height: m(s.groundHeight + 1.6) }
      const t = s.best.time.getTime()
      const found = findAlignments(engine, {
        camera: cam,
        target,
        body: 'sun',
        start: new Date(t - 6 * 3_600_000),
        end: new Date(t + 6 * 3_600_000),
      })
      const hit = found.reduce<(typeof found)[number] | null>(
        (b, a) => (!b || Math.abs(a.time.getTime() - t) < Math.abs(b.time.getTime() - t) ? a : b),
        null,
      )
      expect(hit).not.toBeNull()
      expect(Math.abs(hit!.time.getTime() - t)).toBeLessThanOrEqual(2 * 60_000)
      expect(Math.abs(hit!.verticalOffset - s.best.offsetError)).toBeLessThan(0.05)
      expect(s.groundHeight).toBe(20)
    }
    expect(ev.survivors.length + ev.outOfTolerance).toBe(ev.evaluated)
  })

  it('caps the evaluated candidates, best geometric cell error first', () => {
    const capped = evaluateCandidates(engine, q, prep, cells, cand.byCell, 2)
    expect(capped.evaluated).toBe(2)
    expect(capped.capped).toBe(true)
  })

  const rect = (lat: number, lon: number, half: number): { ring: [number, number][]; height: number; minHeight: number } => {
    const dLat = half / 111_320
    const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180))
    return {
      ring: [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
      height: 200,
      minHeight: 0,
    }
  }

  it('keeps an open point, drops one behind a tall building and one inside a footprint', () => {
    const s = ev.survivors[0]!
    const deps = { terrain, target, eyeHeight: 1.6, nearFieldMeters: 200 }
    const open = filterVisible([s], { ...deps, index: new BuildingIndex([]) })
    expect(open.points).toHaveLength(1)
    expect(open.points[0]!.visible).toBe(true)
    expect(open.points[0]!.priority).toBe(ACCESS_PRIORITY['minor-road'])

    // A 200 m tower 300 m from the camera, straight toward the landmark.
    const toward = destinationPoint({ lat: deg(s.lat), lon: deg(s.lon) }, deg((s.bearing + 180) % 360), m(300))
    const behind = filterVisible([s], { ...deps, index: new BuildingIndex([rect(toward.lat, toward.lon, 40)]) })
    expect(behind.points).toHaveLength(0)
    expect(behind.blockedByBuilding).toBe(1)
    expect(behind.blockedByTerrain).toBe(0)

    const inside = filterVisible([s], { ...deps, index: new BuildingIndex([rect(s.lat, s.lon, 20)]) })
    expect(inside.points).toHaveLength(0)
    expect(inside.insideBuilding).toBe(1)

    // A building well off the line of sight does not matter.
    const beside = destinationPoint({ lat: deg(s.lat), lon: deg(s.lon) }, deg((s.bearing + 90) % 360), m(300))
    const off = filterVisible([s], { ...deps, index: new BuildingIndex([rect(beside.lat, beside.lon, 40)]) })
    expect(off.points).toHaveLength(1)
  })

  it('terrain blocks are reported as terrain, not buildings', () => {
    const s = ev.survivors[0]!
    const ridge = new AnalyticSampler((lat, lon) => {
      const t = destinationPoint({ lat: deg(s.lat), lon: deg(s.lon) }, deg((s.bearing + 180) % 360), m(2000))
      const d = Math.hypot((lat - t.lat) * 111_320, (lon - t.lon) * 111_320 * Math.cos((lat * Math.PI) / 180))
      return d < 300 ? 400 : 20
    }, undefined, 17)
    const r = filterVisible([s], { terrain: ridge, index: new BuildingIndex([]), target, eyeHeight: 1.6 })
    expect(r.points).toHaveLength(0)
    expect(r.blockedByTerrain).toBe(1)
    expect(r.blockedByBuilding).toBe(0)
  })
})

describe('tiles, names and ranking', () => {
  it('feature tiles cover the cells; building tiles stay within 1.5 km of the points and honour the cap', () => {
    const ft = featureTilesForCells(cells, target)
    expect(ft.tiles.length).toBeGreaterThan(4)
    expect(ft.restricted).toBe(false)
    expect(featureTilesForCells(cells, target, 3).tiles).toHaveLength(3)

    const p = { lat: cell.lat, lon: cell.lon }
    const bt = buildingTilesNear([p])
    expect(bt.tiles.length).toBeGreaterThanOrEqual(1)
    expect(bt.tiles.length).toBeLessThanOrEqual(4)
    const far = destinationPoint({ lat: deg(p.lat), lon: deg(p.lon) }, deg(90), m(10_000))
    const two = buildingTilesNear([p, { lat: far.lat, lon: far.lon }])
    expect(two.tiles.length).toBeGreaterThan(bt.tiles.length)
    expect(buildingTilesNear([p, { lat: far.lat, lon: far.lon }], 1500, 1)).toMatchObject({ restricted: true })
    expect(buildingTilesNear([], 1500, 200).tiles).toEqual([])
  })

  it('roadNameAt finds the nearest named line within 20 m', () => {
    const names = [{ name: 'Test Road', coords: [[114.19, 22.33], [114.192, 22.33]] as LonLat[] }]
    expect(roadNameAt(names, 22.33005, 114.191)).toBe('Test Road')
    expect(roadNameAt(names, 22.3305, 114.191)).toBeUndefined()
  })

  const pt = (kind: AccessPoint['kind'], err: number, name?: string): AccessPoint => ({
    lat: 22.3,
    lon: 114.2,
    kind,
    ...(name === undefined ? {} : { name }),
    cellRef: 0,
    bearing: 90,
    distance: 5000,
    groundHeight: 10,
    priority: ACCESS_PRIORITY[kind],
    visible: true,
    best: {
      time: new Date('2026-11-01T10:00:00Z'),
      offsetError: deg(err),
      bodyAzimuth: deg(270),
      bodyApparentAltitude: deg(3),
      targetApparentAltitude: deg(3),
      direction: 'setting',
    },
  })

  it('ranks by priority, then |error|; fills road names', () => {
    const pts = [pt('road', 0.01), pt('path', 0.3), pt('viewpoint', 0.4, 'V'), pt('path', 0.1), pt('park', 0.2)]
    expect(topAccessPoints(pts, 4).map((p) => `${p.kind}${p.best.offsetError}`)).toEqual([
      'viewpoint0.4',
      'park0.2',
      'path0.1',
      'path0.3',
    ])
    const named = withRoadNames([pt('path', 0), pt('park', 0)], [{ name: 'Lion Rock Path', coords: [[114.19, 22.3], [114.21, 22.3]] }])
    expect(named[0]!.name).toBe('Lion Rock Path')
    expect(named[1]!.name).toBeUndefined()
  })
})

describe('performance', () => {
  it('collects candidates over a dense synthetic street grid quickly', () => {
    // 150 m street grid over 20 x 20 km east of Lion Rock: a stress test, denser than real Hong Kong data.
    const west = 114.15
    const south = 22.25
    const lines: AccessFeatures['lines'][number][] = []
    const spanLon = 0.2
    const spanLat = 0.18
    for (let i = 0; i <= 120; i++) {
      const la = south + (spanLat * i) / 120
      lines.push({ kind: 'minor-road', bridge: false, coords: [[west, la], [west + spanLon, la]] })
      const lo = west + (spanLon * i) / 120
      lines.push({ kind: 'minor-road', bridge: false, coords: [[lo, south], [lo, south + spanLat]] })
    }
    const t0 = performance.now()
    const r = collectCandidates(cells, grid, { ...none, lines })
    const ms = performance.now() - t0
    console.log(`collectCandidates: ${cells.length} cells, ${lines.length} lines -> ${r.total} candidates in ${Math.round(ms)} ms`)
    expect(ms).toBeLessThan(15_000)
    expect(r.total).toBeGreaterThan(0)
  })
})
