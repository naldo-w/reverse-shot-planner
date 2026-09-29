import { describe, expect, it } from 'vitest'
import type { GeodeticPosition } from '../types'
import { deg, m } from '../units'
import { ecefToGeodetic, geodeticToEcef } from './ecef'
import {
  ecefToEnu,
  enuToEcef,
  enuToGeodetic,
  enuToHorizontal,
  geodeticToEnu,
  LocalFrame,
  lookAngle,
} from './enu'

const pos = (lat: number, lon: number, h = 0): GeodeticPosition => ({
  lat: deg(lat),
  lon: deg(lon),
  height: m(h),
})

/** Deterministic LCG (Numerical Recipes constants), returns [0,1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const angDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

const R_MEAN = 6371008.8

function samplePoints(): GeodeticPosition[] {
  const r = lcg(12345)
  const pts: GeodeticPosition[] = [
    pos(90, 0, 0),
    pos(-90, 0, 0),
    pos(90, 0, 9000),
    pos(-90, 0, -400),
    pos(0, 180, 0),
    pos(0, -180, 100),
    pos(45, 179.9999, 9000),
    pos(-33, -179.9999, -400),
    pos(0, 0, -400),
  ]
  for (let i = 0; i < 200; i++) {
    const h = i % 3 === 0 ? -400 : i % 3 === 1 ? 9000 : r() * 5000
    pts.push(pos(r() * 180 - 90, r() * 360 - 180, h))
  }
  return pts
}

describe('geodeticToEcef', () => {
  it('matches known values', () => {
    const a = geodeticToEcef(pos(0, 0, 0))
    expect(a.x).toBeCloseTo(6378137, 6)
    expect(a.y).toBeCloseTo(0, 6)
    expect(a.z).toBeCloseTo(0, 6)
    const b = geodeticToEcef(pos(0, 90, 0))
    expect(b.x).toBeCloseTo(0, 6)
    expect(b.y).toBeCloseTo(6378137, 6)
    const c = geodeticToEcef(pos(90, 0, 0))
    expect(c.x).toBeCloseTo(0, 6)
    expect(c.y).toBeCloseTo(0, 6)
    expect(c.z).toBeCloseTo(6356752.314245, 5)
  })

  it('round-trips a Hong Kong test point', () => {
    const p = pos(22.35, 114.18, 495)
    const back = ecefToGeodetic(geodeticToEcef(p))
    expect(Math.abs(back.lat - p.lat)).toBeLessThan(1e-10)
    expect(Math.abs(back.lon - p.lon)).toBeLessThan(1e-10)
    expect(Math.abs(back.height - p.height)).toBeLessThan(1e-6)
  })
})

describe('ecefToGeodetic', () => {
  it('handles the centre of the Earth without NaN', () => {
    const g = ecefToGeodetic({ x: m(0), y: m(0), z: m(0) })
    expect(g.lat).toBe(0)
    expect(g.lon).toBe(0)
    expect(g.height).toBeCloseTo(-6378137, 6)
  })

  it('round-trips seeded points incl. poles, antimeridian, deep and high', () => {
    for (const p of samplePoints()) {
      const back = ecefToGeodetic(geodeticToEcef(p))
      expect(Math.abs(back.lat - p.lat)).toBeLessThan(1e-9)
      expect(Math.abs(back.height - p.height)).toBeLessThan(1e-6)
      if (Math.abs(p.lat) < 89.999999) {
        expect(angDiff(back.lon, p.lon)).toBeLessThan(1e-9)
      }
    }
  })
})

describe('ENU', () => {
  it('round-trips geodetic <-> ENU <-> ECEF', () => {
    const r = lcg(777)
    for (let i = 0; i < 100; i++) {
      const origin = pos(r() * 180 - 90, r() * 360 - 180, r() * 3000 - 400)
      const target = pos(
        Math.max(-90, Math.min(90, origin.lat + (r() - 0.5) * 0.4)),
        origin.lon + (r() - 0.5) * 0.4,
        r() * 9000 - 400,
      )
      const local = geodeticToEnu(target, origin)
      const ecef = enuToEcef(local, origin)
      const local2 = ecefToEnu(ecef, origin)
      expect(Math.abs(local2.east - local.east)).toBeLessThan(1e-6)
      expect(Math.abs(local2.north - local.north)).toBeLessThan(1e-6)
      expect(Math.abs(local2.up - local.up)).toBeLessThan(1e-6)
      const back = enuToGeodetic(local, origin)
      expect(Math.abs(back.lat - target.lat)).toBeLessThan(1e-9)
      expect(angDiff(back.lon, target.lon)).toBeLessThan(1e-9)
      expect(Math.abs(back.height - target.height)).toBeLessThan(1e-5)
    }
  })

  it('round-trips at poles and antimeridian origins', () => {
    for (const origin of [pos(90, 0, 0), pos(-90, 0, 9000), pos(0, 180, -400), pos(10, -180, 0)]) {
      const local = { east: m(1234), north: m(-5678), up: m(90) }
      const g = enuToGeodetic(local, origin)
      const l2 = geodeticToEnu(g, origin)
      expect(Math.abs(l2.east - local.east)).toBeLessThan(1e-6)
      expect(Math.abs(l2.north - local.north)).toBeLessThan(1e-6)
      expect(Math.abs(l2.up - local.up)).toBeLessThan(1e-6)
    }
  })

  it('has correct axes: 1 km due north is +north, ~0 east, slightly below', () => {
    const origin = pos(30, 100, 0)
    // Move 1 km north along the meridian: dlat = 1000 / meridional radius.
    const M = (6378137 * (1 - 0.0066943799901414)) / Math.pow(1 - 0.0066943799901414 * Math.sin((30 * Math.PI) / 180) ** 2, 1.5)
    const target = pos(30 + ((1000 / M) * 180) / Math.PI, 100, 0)
    const l = geodeticToEnu(target, origin)
    expect(l.north).toBeCloseTo(1000, 2)
    expect(Math.abs(l.east)).toBeLessThan(1e-6)
    // Curvature drop = d^2 / (2R) = 1e6 / (2 * ~6.36e6) ~ 0.0785 m
    expect(l.up).toBeLessThan(0)
    expect(l.up).toBeCloseTo(-0.0785, 3)
  })

  it('enuToHorizontal maps zero vector to zeros and wraps azimuth', () => {
    const z = enuToHorizontal({ east: m(0), north: m(0), up: m(0) })
    expect(z.azimuth).toBe(0)
    expect(z.altitude).toBe(0)
    expect(z.range).toBe(0)
    const nw = enuToHorizontal({ east: m(-1), north: m(1), up: m(0) })
    expect(nw.azimuth).toBeCloseTo(315, 9)
    const up = enuToHorizontal({ east: m(0), north: m(0), up: m(5) })
    expect(up.altitude).toBeCloseTo(90, 9)
    expect(up.range).toBeCloseTo(5, 9)
  })
})

describe('lookAngle', () => {
  const obs = pos(35, 10, 100)

  it('reports cardinal azimuths', () => {
    // Targets are built as pure tangent-plane offsets (east along a parallel
    // is NOT azimuth 90 exactly, because of meridian convergence).
    const cases: [number, number, number][] = [
      [0, 2000, 0],
      [2000, 0, 90],
      [0, -2000, 180],
      [-2000, 0, 270],
    ]
    for (const [east, north, az] of cases) {
      const t = enuToGeodetic({ east: m(east), north: m(north), up: m(0) }, obs)
      const la = lookAngle(obs, t)
      expect(angDiff(la.azimuth, az)).toBeLessThan(1e-6)
      expect(la.azimuth).toBeGreaterThanOrEqual(0)
      expect(la.azimuth).toBeLessThan(360)
    }
  })

  it('shows curvature dip: altitude ~ -d/(2R) for equal heights', () => {
    // Expected: alt = -atan-ish(d / 2R) ~ -d/(2R) rad. d = 10 km -> -0.0449 deg.
    const o = pos(0, 0, 0)
    const dLon = (10000 / 6378137) * (180 / Math.PI)
    const la = lookAngle(o, pos(0, dLon, 0))
    const expected = -((la.range / (2 * 6378137)) * 180) / Math.PI
    expect(la.altitude).toBeCloseTo(expected, 4)
    expect(la.altitude).toBeCloseTo(-0.0449, 3)
    expect(la.range).toBeGreaterThan(9999)
    expect(la.range).toBeLessThan(10000)
  })

  it('combines height difference with curvature', () => {
    const o = pos(45, 7, 0)
    const flat = enuToGeodetic({ east: m(10000), north: m(0), up: m(0) }, o)
    const la = lookAngle(o, { ...flat, height: m(1000) })
    const naive = (Math.atan(1000 / 10000) * 180) / Math.PI
    const curvature = ((10000 / (2 * R_MEAN)) * 180) / Math.PI
    expect(Math.abs(la.altitude - (naive - curvature))).toBeLessThan(0.001)
  })
})

describe('LocalFrame', () => {
  it('matches the free functions exactly', () => {
    const origin = pos(22.35, 114.18, 495)
    const frame = new LocalFrame(origin)
    const r = lcg(99)
    for (let i = 0; i < 50; i++) {
      const t = pos(22.35 + (r() - 0.5) * 0.3, 114.18 + (r() - 0.5) * 0.3, r() * 1000)
      const a = frame.toLocal(t)
      const b = geodeticToEnu(t, origin)
      expect(a.east).toBeCloseTo(b.east, 9)
      expect(a.north).toBeCloseTo(b.north, 9)
      expect(a.up).toBeCloseTo(b.up, 9)
      const la = frame.lookAt(t)
      const lb = lookAngle(origin, t)
      expect(la.azimuth).toBeCloseTo(lb.azimuth, 9)
      expect(la.altitude).toBeCloseTo(lb.altitude, 9)
      expect(la.range).toBeCloseTo(lb.range, 6)
      const g = frame.toGeodetic(a)
      expect(Math.abs(g.lat - t.lat)).toBeLessThan(1e-9)
      expect(Math.abs(g.lon - t.lon)).toBeLessThan(1e-9)
      const g2 = enuToGeodetic(a, origin)
      expect(g.lat).toBeCloseTo(g2.lat, 12)
      expect(g.height).toBeCloseTo(g2.height, 6)
    }
  })
})
