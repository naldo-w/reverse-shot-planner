import { describe, expect, it } from 'vitest'
import { createCelestialEngine, refract } from '../../src/core/astronomy'
import { findAlignments, targetPosition } from '../../src/core/planner'
import { destinationPoint, distance as geoDistance } from '../../src/core/geometry/geodesy'
import {
  cellPolygon,
  computeSectorField,
  prepareSector,
  sectorBounds,
  sectorDistances,
  sectorTerrainZoom,
} from '../../src/core/search/sectors'
import type { SectorCell, SectorQuery } from '../../src/core/search/sectors'
import { PRESET_LANDMARKS } from '../../src/data/presets'
import { deg, m } from '../../src/core/units'

const engine = createCelestialEngine()
const lionRock = PRESET_LANDMARKS.find((l) => l.id === 'lion-rock')!
const target = targetPosition(lionRock)
const START = new Date('2026-10-01T00:00:00Z')
const YEAR_END = new Date('2027-10-01T00:00:00Z')
const flat = (): number => 20
/** Terrain that varies with position so the ground lookup really matters. */
const sloped = (lat: number, lon: number): number => 40 + 800 * (lat - 22.35) + 500 * (lon - 114.18)

function query(over: Partial<SectorQuery> = {}): SectorQuery {
  return {
    target,
    body: 'moon',
    start: START,
    end: YEAR_END,
    event: 'any',
    minDistance: m(500),
    maxDistance: m(20_000),
    eyeHeight: m(1.6),
    groundHeight: flat,
    desiredOffset: deg(0),
    tolerance: deg(0.5),
    ...over,
  }
}

const range = (xs: readonly number[]): [number, number] => [Math.min(...xs), Math.max(...xs)]

describe('computeSectorField', () => {
  it('Lion Rock, Moon, 12 months, 0.5-20 km: performance and numbers', () => {
    const t0 = performance.now()
    const cells = computeSectorField(engine, query())
    const ms = performance.now() - t0
    const [b0, b1] = range(cells.map((c) => c.bearing))
    const [d0, d1] = range(cells.map((c) => c.distance))
    console.log(
      `Lion Rock Moon 365 d: ${Math.round(ms)} ms, ${cells.length} cells, bearing ${b0}-${b1}, distance ${Math.round(d0)}-${Math.round(d1)} m`,
    )
    for (const event of ['rise', 'set'] as const) {
      const sub = cells.filter((c) => c.best.direction === (event === 'rise' ? 'rising' : 'setting'))
      const [a0, a1] = range(sub.map((c) => c.bearing))
      console.log(`  Moon ${event}: ${sub.length} cells, bearing ${a0}-${a1}`)
    }
    expect(ms).toBeLessThan(4000)
    expect(cells.length).toBeGreaterThan(1000)
    for (const c of cells) expect(Math.abs(c.best.offsetError)).toBeLessThanOrEqual(0.5)
  })

  it('prunes bearings to the body azimuth band (Sun sets, camera on the east side)', () => {
    const q = query({ body: 'sun', event: 'set' })
    // Independent band: azimuths of the setting Sun with apparent altitude in [-1, 20] over the year.
    const obs = { lat: target.lat, lon: target.lon, height: target.height }
    let azLo = Infinity
    let azHi = -Infinity
    let prev = engine.getPosition('sun', START, obs).altitude
    for (let t = START.getTime() + 4 * 60_000; t < YEAR_END.getTime(); t += 4 * 60_000) {
      const s = engine.getPosition('sun', new Date(t), obs)
      const app = refract(s.altitude)
      if (s.altitude < prev && app >= -1 && app <= 20) {
        azLo = Math.min(azLo, s.azimuth)
        azHi = Math.max(azHi, s.azimuth)
      }
      prev = s.altitude
    }
    const prep = prepareSector(engine, q)
    const cells = computeSectorField(engine, q)
    const [b0, b1] = range(cells.map((c) => c.bearing))
    console.log(
      `Sun set azimuth band ${azLo.toFixed(1)}-${azHi.toFixed(1)} -> expected bearings ${(azLo - 180).toFixed(1)}-${(azHi - 180).toFixed(1)}; ` +
        `candidates ${prep.bearings.length}/1440 (${prep.bearings[0]}-${prep.bearings.at(-1)}); cells ${cells.length}, bearing ${b0}-${b1}`,
    )
    // Roughly the 59-121 deg camera-east sector.
    expect(azLo - 180).toBeGreaterThan(50)
    expect(azHi - 180).toBeLessThan(130)
    expect(b0).toBeGreaterThanOrEqual(azLo - 180 - 0.5)
    expect(b1).toBeLessThanOrEqual(azHi - 180 + 0.5)
    // Pruning: nothing evaluated outside the band (1 deg margin + 0.25 deg grid + 4-min scan resolution).
    expect(prep.bearings.length).toBeLessThan(1440 / 3)
    for (const b of prep.bearings) {
      expect(b).toBeGreaterThanOrEqual(azLo - 180 - 1.8)
      expect(b).toBeLessThanOrEqual(azHi - 180 + 1.8)
    }
    expect(prep.bearings).not.toContain(0)
    expect(prep.bearings).not.toContain(270)
    // The Sun is only "setting" here: no rising cells.
    expect(cells.every((c) => c.best.direction === 'setting')).toBe(true)
  })

  it.each([
    { body: 'moon' as const, desired: 0 },
    { body: 'moon' as const, desired: 0.26 },
    { body: 'sun' as const, desired: 0.26 },
  ])('cells re-evaluate with findAlignments ($body, offset $desired)', ({ body, desired }) => {
    const q = query({ body, desiredOffset: deg(desired), groundHeight: sloped, end: new Date('2027-04-01T00:00:00Z') })
    const cells = computeSectorField(engine, q)
    expect(cells.length).toBeGreaterThan(200)
    const stride = Math.floor(cells.length / 12)
    let checked = 0
    for (let i = 0; i < cells.length; i += stride) {
      const c = cells[i] as SectorCell
      const camera = { lat: c.lat, lon: c.lon, height: m(c.groundHeight + 1.6) }
      expect(c.groundHeight).toBeCloseTo(sloped(c.lat, c.lon), 6)
      const t = c.best.time.getTime()
      const found = findAlignments(engine, {
        camera,
        target,
        body,
        start: new Date(t - 6 * 3_600_000),
        end: new Date(t + 6 * 3_600_000),
        maxVerticalOffset: deg(3),
        maxBodyAltitude: deg(25),
      })
      const hit = found.reduce<(typeof found)[number] | null>(
        (best, a) => (!best || Math.abs(a.time.getTime() - t) < Math.abs(best.time.getTime() - t) ? a : best),
        null,
      )
      expect(hit).not.toBeNull()
      expect(Math.abs(hit!.time.getTime() - t)).toBeLessThanOrEqual(2 * 60_000)
      expect(Math.abs(hit!.verticalOffset - (c.best.offsetError + desired))).toBeLessThan(0.05)
      expect(hit!.direction).toBe(c.best.direction)
      expect(Math.abs(hit!.body_.azimuth - c.best.bodyAzimuth)).toBeLessThan(0.05)
      expect(hit!.body_.apparentAltitude).toBeCloseTo(c.best.bodyApparentAltitude, 1)
      expect(hit!.target.apparentAltitude).toBeCloseTo(c.best.targetApparentAltitude, 3)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  it('returns nothing for an impossible tolerance or composition', () => {
    const short = { end: new Date('2026-11-01T00:00:00Z') }
    expect(computeSectorField(engine, query({ ...short, tolerance: deg(1e-9) }))).toEqual([])
    expect(computeSectorField(engine, query({ ...short, desiredOffset: deg(60) }))).toEqual([])
    // Too close: the summit is above the maximum body altitude from every cell.
    expect(computeSectorField(engine, query({ ...short, minDistance: m(100), maxDistance: m(300) }))).toEqual([])
    expect(computeSectorField(engine, query({ start: START, end: START }))).toEqual([])
  })

  it('skips cells without ground data', () => {
    const short = { end: new Date('2026-11-01T00:00:00Z') }
    const all = computeSectorField(engine, query(short))
    expect(computeSectorField(engine, query({ ...short, groundHeight: () => null }))).toEqual([])
    const east = computeSectorField(engine, query({ ...short, groundHeight: (_lat, lon) => (lon > 114.19 ? 20 : null) }))
    expect(east.length).toBeGreaterThan(0)
    expect(east.length).toBeLessThan(all.length)
  })

  it('a wider tolerance never removes cells and the event filter separates rise from set', () => {
    const short = { end: new Date('2026-12-01T00:00:00Z'), bearingStep: deg(0.5), distanceSteps: 20 }
    const tight = computeSectorField(engine, query({ ...short, tolerance: deg(0.25) }))
    const loose = computeSectorField(engine, query({ ...short, tolerance: deg(1) }))
    expect(loose.length).toBeGreaterThanOrEqual(tight.length)
    const rise = computeSectorField(engine, query({ ...short, event: 'rise' }))
    const set = computeSectorField(engine, query({ ...short, event: 'set' }))
    expect(rise.every((c) => c.best.direction === 'rising')).toBe(true)
    expect(set.every((c) => c.best.direction === 'setting')).toBe(true)
    const any = computeSectorField(engine, query({ ...short, event: 'any' }))
    expect(any.length).toBe(rise.length + set.length)
  })

  it('reports progress monotonically up to 1', () => {
    const seen: number[] = []
    computeSectorField(engine, query({ end: new Date('2026-10-20T00:00:00Z') }), (f) => seen.push(f))
    expect(seen.length).toBeGreaterThan(2)
    for (let i = 1; i < seen.length; i++) expect(seen[i] as number).toBeGreaterThanOrEqual(seen[i - 1] as number)
    expect(seen.at(-1)).toBe(1)
  })
})

describe('sector geometry helpers', () => {
  it('log-spaced distances tile [min, max] without gaps', () => {
    const d = sectorDistances(500, 20_000, 40)
    expect(d.centre[0]).toBeCloseTo(500)
    expect(d.centre[39]).toBeCloseTo(20_000)
    expect(d.inner[0]).toBe(500)
    expect(d.outer[39]).toBe(20_000)
    for (let i = 0; i < 39; i++) {
      expect(d.outer[i]).toBeCloseTo(d.inner[i + 1] as number, 6)
      expect(d.centre[i] as number).toBeGreaterThanOrEqual(d.inner[i] as number)
      expect(d.centre[i] as number).toBeLessThanOrEqual(d.outer[i] as number)
    }
  })

  it('cellPolygon is a closed annular sector around the cell', () => {
    const cells = computeSectorField(engine, query({ end: new Date('2026-11-01T00:00:00Z') }))
    const c = cells[Math.floor(cells.length / 2)] as SectorCell
    for (const ring of [cellPolygon(c), cellPolygon(c, target)]) {
      expect(ring.length).toBeGreaterThanOrEqual(5)
      expect(ring[0]).toEqual(ring.at(-1))
      for (const [lon, lat] of ring.slice(0, -1)) {
        const r = geoDistance(target, { lat: deg(lat), lon: deg(lon) })
        expect(r).toBeGreaterThan(c.distanceInner - 1)
        expect(r).toBeLessThan(c.distanceOuter + 1)
      }
    }
    // With the exact origin the ring is centred on the cell centre.
    const ring = cellPolygon(c, target).slice(0, -1)
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length
    expect(geoDistance({ lat: deg(lat), lon: deg(lon) }, c)).toBeLessThan((c.distanceOuter - c.distanceInner) * 0.6 + 5)
  })

  it('sectorBounds encloses the fan and sectorTerrainZoom picks a fitting zoom', () => {
    const bearings = [60, 70, 80, 90]
    const b = sectorBounds(target, bearings, 500, 20_000)!
    for (const bearing of bearings) {
      for (const d of [500, 20_000]) {
        const p = destinationPoint(target, deg(bearing), m(d))
        expect(p.lat).toBeLessThanOrEqual(b.north)
        expect(p.lat).toBeGreaterThanOrEqual(b.south)
        expect(p.lon).toBeLessThanOrEqual(b.east)
        expect(p.lon).toBeGreaterThanOrEqual(b.west)
      }
    }
    expect(sectorBounds(target, [], 500, 20_000)).toBeNull()
    const z = sectorTerrainZoom(b)
    expect(z).not.toBeNull()
    expect(z as number).toBeLessThanOrEqual(13)
    const huge = sectorBounds(target, [0, 90, 180, 270], 500, 200_000)!
    expect(sectorTerrainZoom(huge)).toBeLessThan(z as number)
  })
})
