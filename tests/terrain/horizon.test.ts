import { describe, expect, it } from 'vitest'
import { AnalyticSampler } from '../../src/core/terrain/grid'
import { calculateHorizonProfile, rayVisibility } from '../../src/core/terrain/horizon'
import { haversineDistance, offsetCoordinate } from '../../src/core/geometry/geodesy'
import { MEAN_EARTH_RADIUS } from '../../src/core/wgs84'
import { deg, m } from '../../src/core/units'
import type { GeodeticPosition } from '../../src/core/types'

const cam = (h: number): GeodeticPosition => ({ lat: deg(22.35), lon: deg(114.18), height: m(h) })
const opts = (start: number, end: number, step: number, max: number, k = 0) => ({
  azimuthStart: deg(start),
  azimuthEnd: deg(end),
  azimuthStep: deg(step),
  maxDistance: m(max),
  refractionK: k,
})
const DEG = 180 / Math.PI

function coneAt(eastM: number, northM: number, peak: number, radius: number) {
  const c = offsetCoordinate(cam(0), eastM, northM)
  return (lat: number, lon: number): number => {
    const d = haversineDistance(c, { lat: deg(lat), lon: deg(lon) })
    return Math.max(0, peak * (1 - d / radius))
  }
}

describe('horizon on synthetic terrain', () => {
  it('flat plane: horizon equals the geometric sea-level dip', () => {
    const s = new AnalyticSampler(() => 0)
    const p = calculateHorizonProfile(cam(100), s, opts(0, 90, 45, 60_000))
    const dip = -Math.acos(MEAN_EARTH_RADIUS / (MEAN_EARTH_RADIUS + 100)) * DEG
    expect(p.samples).toHaveLength(3)
    for (const smp of p.samples) expect(smp.altitude).toBeCloseTo(dip, 2)
  })

  it('flat plane shorter than horizon: altitude at max distance', () => {
    const s = new AnalyticSampler(() => 0)
    const p = calculateHorizonProfile(cam(100), s, opts(0, 0, 1, 15_000))
    const expected = Math.atan2(-(100 + 15_000 ** 2 / (2 * MEAN_EARTH_RADIUS)), 15_000) * DEG
    expect(p.samples[0]?.altitude).toBeCloseTo(expected, 2)
  })

  it('no terrain data: falls back to sea-level dip', () => {
    const s = new AnalyticSampler(() => 0, { north: deg(0), south: deg(-1), east: deg(1), west: deg(0) })
    const p = calculateHorizonProfile(cam(50), s, opts(0, 0, 1, 10_000))
    const dip = -Math.acos(MEAN_EARTH_RADIUS / (MEAN_EARTH_RADIUS + 50)) * DEG
    expect(p.samples[0]?.altitude).toBeCloseTo(dip, 6)
    expect(p.samples[0]?.distance).toBeUndefined()
  })

  it('single cone hill: altitude at hill azimuth matches analytic value', () => {
    const d = 5000
    const H = 300
    const h = 10
    const s = new AnalyticSampler(coneAt(d, 0, H, 2000), undefined, 30)
    const p = calculateHorizonProfile(cam(h), s, opts(85, 95, 1, 15_000))
    const at90 = p.samples.find((x) => x.azimuth === 90)
    const expected = Math.atan((H - h - d ** 2 / (2 * MEAN_EARTH_RADIUS)) / d) * DEG
    expect(at90?.altitude).toBeCloseTo(expected, 1)
    expect(Math.abs((at90?.altitude ?? 0) - expected)).toBeLessThan(0.05)
    expect(at90?.distance).toBeGreaterThan(4900)
    expect(at90?.distance).toBeLessThan(5100)
  })

  it('ridge: peaks perpendicular to the ridge and wraps through north', () => {
    const c0 = cam(0)
    const s = new AnalyticSampler((lat, lon) => {
      const east = haversineDistance({ lat: c0.lat, lon: c0.lon }, { lat: c0.lat, lon: deg(lon) })
      const signed = lon >= c0.lon ? east : -east
      void lat
      return Math.max(0, 150 - Math.abs(signed - 3000) * 0.5)
    })
    const p = calculateHorizonProfile(c0, s, opts(60, 120, 10, 12_000))
    const alts = p.samples.map((x) => x.altitude)
    const max = Math.max(...alts)
    expect(p.samples.find((x) => x.altitude === max)?.azimuth).toBe(90)
    expect(alts[0]).toBeLessThan(max)
    expect(alts[alts.length - 1]).toBeLessThan(max)

    const wrap = calculateHorizonProfile(c0, s, opts(350, 10, 10, 5000))
    expect(wrap.samples.map((x) => x.azimuth)).toEqual([350, 0, 10])
  })

  it('refraction lifts the horizon by k*d/2R', () => {
    const s = new AnalyticSampler(coneAt(5000, 0, 300, 2000))
    const a = calculateHorizonProfile(cam(10), s, opts(90, 90, 1, 15_000, 0)).samples[0]
    const b = calculateHorizonProfile(cam(10), s, opts(90, 90, 1, 15_000, 0.13)).samples[0]
    const lift = ((0.13 * 5000) / (2 * MEAN_EARTH_RADIUS)) * DEG
    expect((b?.altitude ?? 0) - (a?.altitude ?? 0)).toBeCloseTo(lift, 3)
  })
})

describe('rayVisibility', () => {
  const s = new AnalyticSampler(coneAt(5000, 0, 300, 1500))
  const far = offsetCoordinate(cam(0), 10_000, 0)

  it('hill hides a lower target behind it', () => {
    const r = rayVisibility(cam(10), { ...far, height: m(100) }, s, 0.13)
    expect(r.visible).toBe(false)
    expect(r.obstructionDistance).toBeGreaterThan(4500)
    expect(r.obstructionDistance).toBeLessThan(5500)
    expect(r.obstructionElevation).toBeGreaterThan(200)
    expect(r.angularMargin).toBeLessThan(0)
  })

  it('a taller target above the hill line is visible', () => {
    const r = rayVisibility(cam(10), { ...far, height: m(1000) }, s, 0.13)
    expect(r.visible).toBe(true)
    expect(r.angularMargin).toBeGreaterThan(0)
  })

  it('unobstructed flat terrain is visible', () => {
    const flat = new AnalyticSampler(() => 0)
    const r = rayVisibility(cam(50), { ...far, height: m(50) }, flat, 0.13)
    expect(r.visible).toBe(true)
  })
})

describe('performance', () => {
  it('400 azimuths x 15 km at 30 m resolution < 1 s', () => {
    const s = new AnalyticSampler(
      (lat, lon) => 200 + 80 * Math.sin(lat * 900) * Math.cos(lon * 900),
      undefined,
      30,
    )
    const t0 = performance.now()
    const p = calculateHorizonProfile(cam(50), s, opts(0, 359.1, 0.9, 15_000, 0.13))
    const ms = performance.now() - t0
    console.log(`horizon: ${p.samples.length} azimuths x 15 km in ${ms.toFixed(0)} ms`)
    expect(p.samples.length).toBeGreaterThanOrEqual(400)
    expect(ms).toBeLessThan(1000)
  })
})
