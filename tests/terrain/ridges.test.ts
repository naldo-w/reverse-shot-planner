import { describe, expect, it } from 'vitest'
import { AnalyticSampler } from '../../src/core/terrain/grid'
import { calculateHorizonProfile, rayVisibility } from '../../src/core/terrain/horizon'
import { calculateRidgelines } from '../../src/core/terrain/ridges'
import { haversineDistance, offsetCoordinate } from '../../src/core/geometry/geodesy'
import { MEAN_EARTH_RADIUS } from '../../src/core/wgs84'
import { deg, m } from '../../src/core/units'
import type { GeodeticPosition } from '../../src/core/types'

const DEG = 180 / Math.PI
const cam = (h: number): GeodeticPosition => ({ lat: deg(22.35), lon: deg(114.18), height: m(h) })
const opts = (start: number, end: number, step: number, max: number, k = 0) => ({
  azimuthStart: deg(start),
  azimuthEnd: deg(end),
  azimuthStep: deg(step),
  maxDistance: m(max),
  refractionK: k,
})

/** Apparent angle of a point of height `top` at range d for an eye at height h (curvature, k = 0). */
const angleTo = (top: number, h: number, d: number): number =>
  Math.atan((top - h - d ** 2 / (2 * MEAN_EARTH_RADIUS)) / d) * DEG

/** East-west ridge at `northM` metres north of the camera (elevation depends on latitude only). */
function ridgeAt(northM: number, height: number, halfWidth: number) {
  const c = offsetCoordinate(cam(0), 0, northM)
  return (lat: number): number => {
    // Distance to the ridge line ~ latitude difference (ridge runs east-west).
    const dy = Math.abs(lat - c.lat) * 111_195
    return height * Math.exp(-((dy / halfWidth) ** 2))
  }
}

describe('calculateRidgelines', () => {
  it('two parallel ridges: far one is the skyline, near one is a lower line', () => {
    const h = 10
    const near = ridgeAt(2000, 120, 250)
    const far = ridgeAt(5000, 420, 250)
    const s = new AnalyticSampler((lat) => Math.max(near(lat), far(lat)), undefined, 30)
    const r = calculateRidgelines(cam(h), s, opts(-3, 3, 0.03, 10_000))
    expect(r.ridges).toHaveLength(2)
    const [nearLine, farLine] = r.ridges
    expect(farLine?.isSkyline).toBe(true)
    expect(nearLine?.isSkyline).toBe(false)
    const expNear = angleTo(120, h, 2000)
    const expFar = angleTo(420, h, 5000)
    expect(expFar).toBeGreaterThan(expNear)
    const mid = (line: typeof nearLine) => line?.points[Math.floor((line?.points.length ?? 0) / 2)]
    expect(Math.abs((mid(nearLine)?.altitude ?? 99) - expNear)).toBeLessThan(0.05)
    expect(Math.abs((mid(farLine)?.altitude ?? 99) - expFar)).toBeLessThan(0.05)
    expect(Math.abs((nearLine?.meanDistance ?? 0) / 2000 - 1)).toBeLessThan(0.05)
    expect(Math.abs((farLine?.meanDistance ?? 0) / 5000 - 1)).toBeLessThan(0.05)
    expect(nearLine?.points.length).toBeGreaterThan(100)
  })

  it('skyline matches calculateHorizonProfile', () => {
    const far = ridgeAt(5000, 420, 250)
    const s = new AnalyticSampler((lat) => far(lat), undefined, 30)
    const o = opts(-2, 2, 0.1, 8000)
    const a = calculateRidgelines(cam(10), s, o).skyline.samples
    const b = calculateHorizonProfile(cam(10), s, o).samples
    expect(a).toHaveLength(b.length)
    a.forEach((p, i) => expect(p.altitude).toBeCloseTo(b[i]?.altitude ?? NaN, 9))
  })

  it('single cone: only the skyline line, no spurious ridges', () => {
    const c = offsetCoordinate(cam(0), 5000, 0)
    const s = new AnalyticSampler(
      (lat, lon) => Math.max(0, 300 * (1 - haversineDistance(c, { lat: deg(lat), lon: deg(lon) }) / 2000)),
      undefined,
      30,
    )
    const r = calculateRidgelines(cam(10), s, opts(80, 100, 0.1, 12_000))
    expect(r.ridges).toHaveLength(1)
    expect(r.ridges[0]?.isSkyline).toBe(true)
  })

  it('flat plane: no ridges besides the skyline', () => {
    const s = new AnalyticSampler(() => 0, undefined, 30)
    const r = calculateRidgelines(cam(100), s, opts(0, 20, 0.1, 20_000))
    expect(r.ridges.filter((l) => !l.isSkyline)).toHaveLength(0)
  })

  it('performance: 200 azimuths x 10 km at 30 m under 400 ms', () => {
    const near = ridgeAt(2000, 120, 250)
    const far = ridgeAt(5000, 420, 250)
    const s = new AnalyticSampler((lat) => Math.max(near(lat), far(lat)), undefined, 30)
    calculateRidgelines(cam(10), s, opts(-5, 5, 0.05, 10_000)) // warm-up
    const t0 = performance.now()
    const r = calculateRidgelines(cam(10), s, opts(-5, 5, 0.05, 10_000))
    const ms = performance.now() - t0
    console.log(`ridgelines: 201 azimuths x 10 km in ${ms.toFixed(0)} ms (${r.ridges.length} lines)`)
    expect(ms).toBeLessThan(400)
  })

  it('near-field exclusion: slope beside the camera hides a far hill only when not excluded', () => {
    const hill = ridgeAt(5000, 420, 250)
    const slope = ridgeAt(60, 40, 60) // steep rise ~60 m north of the camera
    const s = new AnalyticSampler((lat) => Math.max(hill(lat), slope(lat)), undefined, 30)
    const c = cam(10)
    const o = opts(-1, 1, 0.1, 8000)
    const withNear = calculateRidgelines(c, s, { ...o, nearFieldDistance: m(200) })
    const without = calculateRidgelines(c, s, o)
    const mid = (r: typeof withNear) => r.skyline.samples[Math.floor(r.skyline.samples.length / 2)]
    expect(mid(withNear)?.distance).toBeGreaterThan(4000)
    expect(mid(without)?.distance).toBeLessThan(200)
    expect(mid(withNear)?.altitude).toBeCloseTo(angleTo(420, 10, 5000), 1)
    const ignored = withNear.nearField.samples[Math.floor(withNear.nearField.samples.length / 2)]
    expect(ignored?.altitude).toBeGreaterThan(mid(withNear)?.altitude ?? 99)
    const target = { lat: offsetCoordinate(cam(0), 0, 5000).lat, lon: c.lon, height: m(420) }
    expect(rayVisibility(c, target, s, 0, 200).visible).toBe(true)
    expect(rayVisibility(c, target, s, 0).visible).toBe(false)
  })
})
