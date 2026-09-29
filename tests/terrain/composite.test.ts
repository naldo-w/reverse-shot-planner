import { describe, expect, it } from 'vitest'
import { BuildingIndex, BuildingSurfaceSampler } from '../../src/core/terrain/composite'
import { AnalyticSampler } from '../../src/core/terrain/grid'
import { calculateHorizonProfile, rayStep, rayVisibility } from '../../src/core/terrain/horizon'
import { calculateRidgelines } from '../../src/core/terrain/ridges'
import { haversineDistance, offsetCoordinate } from '../../src/core/geometry/geodesy'
import type { GeodeticPosition } from '../../src/core/types'
import type { Building } from '../../src/providers/buildings/openFreeMapBuildings'
import { deg, m } from '../../src/core/units'

const CAM = { lat: deg(22.35), lon: deg(114.18) }
const cam: GeodeticPosition = { ...CAM, height: m(1.6) }
const bounds = { north: deg(22.6), south: deg(22.1), east: deg(114.5), west: deg(113.9) }
const K = 0.13

/** Axis-aligned square footprint centred (east, north) metres from the camera. */
function box(east: number, north: number, size: number, height: number, minHeight = 0): Building {
  const h = size / 2
  const pts = [
    [east - h, north - h],
    [east + h, north - h],
    [east + h, north + h],
    [east - h, north + h],
    [east - h, north - h],
  ] as const
  return {
    ring: pts.map(([e, n]) => {
      const c = offsetCoordinate(CAM, e, n)
      return [c.lon, c.lat] as const
    }),
    height,
    minHeight,
  }
}

const at = (east: number, north: number) => offsetCoordinate(CAM, east, north)

function hill(northM: number, peak: number, radius: number) {
  const c = at(0, northM)
  return (lat: number, lon: number): number =>
    Math.max(0, peak * (1 - haversineDistance(c, { lat: deg(lat), lon: deg(lon) }) / radius))
}

describe('BuildingIndex', () => {
  it('point-in-polygon on a concave L shape; tallest overlapping building wins', () => {
    const L: Building = {
      ring: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.0005],
        [0.0005, 0.0005],
        [0.0005, 0.001],
        [0, 0.001],
        [0, 0],
      ],
      height: 20,
      minHeight: 0,
    }
    const tall: Building = {
      ring: [
        [0.0001, 0.0001],
        [0.0002, 0.0001],
        [0.0002, 0.0002],
        [0.0001, 0.0002],
      ],
      height: 90,
      minHeight: 0,
    }
    const idx = new BuildingIndex([L, tall])
    expect(idx.count).toBe(2)
    expect(idx.heightAt(0.0002, 0.0008)).toBe(20) // in the L's foot
    expect(idx.heightAt(0.0008, 0.0002)).toBe(20) // in the L's stem
    expect(idx.heightAt(0.0008, 0.0008)).toBe(0) // in the notch
    expect(idx.heightAt(0.00015, 0.00015)).toBe(90)
    expect(idx.heightAt(0.5, 0.5)).toBe(0)
    expect(new BuildingIndex([]).heightAt(1, 1)).toBe(0)
  })
})

describe('BuildingSurfaceSampler', () => {
  const flat = new AnalyticSampler(() => 10, bounds, 30)

  it('adds building height above the terrain at the query point and keeps terrain elsewhere', () => {
    const s = new BuildingSurfaceSampler(flat, [box(500, 0, 40, 25)])
    const inside = at(500, 0)
    const outside = at(600, 0)
    expect(s.sample(inside.lat, inside.lon)).toBe(35)
    expect(s.sample(outside.lat, outside.lon)).toBe(10)
    expect(s.surfaceKindAt(inside.lat, inside.lon)).toBe('building')
    expect(s.surfaceKindAt(outside.lat, outside.lon)).toBe('terrain')
    expect(s.sample(deg(60), deg(0))).toBeNull()
  })

  it('on a slope the roof follows the terrain at the query point', () => {
    const slope = new AnalyticSampler((_lat, lon) => (lon - 114.18) * 1e5, bounds, 30) // ~ +0.93 m per m east
    const s = new BuildingSurfaceSampler(slope, [box(500, 0, 60, 30)])
    const w = at(480, 0)
    const e = at(520, 0)
    const diff = (s.sample(e.lat, e.lon) as number) - (s.sample(w.lat, w.lon) as number)
    expect(diff).toBeGreaterThan(30)
  })

  it('resolution is min(terrain, 5): ray step stays within 2.5 m .. terrain step', () => {
    const s = new BuildingSurfaceSampler(new AnalyticSampler(() => 0, bounds, 30), [])
    expect(s.resolutionMeters).toBe(5)
    expect(rayStep(30, s.resolutionMeters)).toBe(2.5)
    expect(rayStep(2000, s.resolutionMeters)).toBeCloseTo(4, 6)
    for (const d of [2000, 3000, 5000, 8000]) expect(rayStep(d, s.resolutionMeters)).toBeLessThanOrEqual(rayStep(d, 30))
    expect(new BuildingSurfaceSampler(new AnalyticSampler(() => 0, bounds, 3), []).resolutionMeters).toBe(3)
  })
})

describe('near-field rule with buildings', () => {
  const target: GeodeticPosition = { ...at(0, 3000), height: m(40) }
  const hillTerrain = new AnalyticSampler(hill(3000, 40, 500), bounds, 30)
  const tower = box(0, 150, 20, 60)
  const opts = { camera: CAM, cameraGround: 0, nearFieldMeters: 200 }

  it('without buildings the far hill target is visible', () => {
    const v = rayVisibility(cam, target, hillTerrain, K)
    expect(v.visible).toBe(true)
    const c = rayVisibility(cam, target, new BuildingSurfaceSampler(hillTerrain, [], opts), K)
    expect(c.visible).toBe(true)
  })

  it('a 60 m tower 150 m away (inside the near-field radius) hides it and is named a building', () => {
    const s = new BuildingSurfaceSampler(hillTerrain, [tower], opts)
    const v = rayVisibility(cam, target, s, K)
    expect(v.visible).toBe(false)
    expect(v.obstructionKind).toBe('building')
    expect(v.obstructionDistance).toBeGreaterThan(135)
    expect(v.obstructionDistance).toBeLessThan(165)
  })

  it('a tower beyond the near-field radius hides it too, and terrain-only samplers report no kind', () => {
    const far = new BuildingSurfaceSampler(hillTerrain, [box(0, 1200, 30, 80)], opts)
    const v = rayVisibility(cam, target, far, K)
    expect(v.visible).toBe(false)
    expect(v.obstructionDistance).toBeGreaterThan(1180)
    expect(v.obstructionDistance).toBeLessThan(1230)
    expect(rayVisibility(cam, target, hillTerrain, K).obstructionKind).toBeUndefined()
  })

  it('a street-like DTM slope inside 200 m is still ignored (no buildings there)', () => {
    const ramp = new AnalyticSampler((lat, lon) => {
      const n = haversineDistance(CAM, { lat: deg(lat), lon: deg(lon) })
      return n < 200 ? 30 * Math.min(1, n / 100) : 0
    }, bounds, 30)
    // Control: terrain-only sampler without the near-field rule sees the false slope.
    expect(rayVisibility(cam, target, ramp, K).visible).toBe(false)
    const withNear = new BuildingSurfaceSampler(ramp, [], opts)
    expect(rayVisibility(cam, target, withNear, K).visible).toBe(true)
    const prof = calculateHorizonProfile(cam, withNear, {
      azimuthStart: deg(0),
      azimuthEnd: deg(0),
      azimuthStep: deg(1),
      maxDistance: m(3000),
      refractionK: K,
    })
    expect(prof.samples[0]?.altitude).toBeLessThan(1)
  })

  it('buildings inside the near-field radius stand on the camera ground, not on the DTM', () => {
    const ramp = new AnalyticSampler(() => 30, bounds, 30) // DTM says 30 m; camera ground is 0
    const s = new BuildingSurfaceSampler(ramp, [tower], opts)
    const p = at(0, 150)
    expect(s.sample(p.lat, p.lon)).toBe(60)
    const q = at(0, 100)
    expect(s.sample(q.lat, q.lon)).toBe(0)
    const beyond = at(0, 400)
    expect(s.sample(beyond.lat, beyond.lon)).toBe(30)
  })

  it('skyline and ridgelines include the tower at its distance', () => {
    const s = new BuildingSurfaceSampler(hillTerrain, [tower], opts)
    const r = calculateRidgelines(cam, s, {
      azimuthStart: deg(-6),
      azimuthEnd: deg(6),
      azimuthStep: deg(1),
      maxDistance: m(3500),
      refractionK: K,
    })
    const north = r.skyline.samples.find((x) => Math.abs(x.azimuth - 0) < 1e-6 || x.azimuth === 360)
    expect(north?.altitude).toBeGreaterThan(20)
    expect(north?.distance).toBeGreaterThan(135)
    expect(north?.distance).toBeLessThan(165)
    // Rays that miss the tower see the far hill instead.
    const off = r.skyline.samples.find((x) => Math.abs(x.azimuth - 6) < 1e-6)
    expect(off?.altitude).toBeLessThan(2)
  })
})

describe('performance', () => {
  it('450 azimuths x 5 km with ~20k buildings', () => {
    const buildings: Building[] = []
    let seed = 12345
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    for (let i = 0; i < 20_000; i++) {
      const r = 5500 * Math.sqrt(rnd())
      const a = rnd() * 2 * Math.PI
      buildings.push(box(r * Math.sin(a), r * Math.cos(a), 12 + rnd() * 30, 8 + rnd() * 90))
    }
    const t0 = performance.now()
    const index = new BuildingIndex(buildings)
    const tIndex = performance.now() - t0
    const s = new BuildingSurfaceSampler(new AnalyticSampler(() => 5, bounds, 30), index, {
      camera: CAM,
      cameraGround: 5,
      nearFieldMeters: 200,
    })
    const t1 = performance.now()
    const prof = calculateHorizonProfile(cam, s, {
      azimuthStart: deg(0),
      azimuthEnd: deg(89.8),
      azimuthStep: deg(0.2),
      maxDistance: m(5000),
      refractionK: K,
    })
    const ms = performance.now() - t1
    console.log(`[perf] index ${tIndex.toFixed(0)} ms; ${prof.samples.length} azimuths x 5 km, ${index.count} buildings: ${ms.toFixed(0)} ms`)
    expect(prof.samples).toHaveLength(450)
    expect(ms).toBeLessThan(1500)
  })
})
