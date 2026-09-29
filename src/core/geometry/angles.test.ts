import { describe, it, expect } from 'vitest'
import { deg } from '../units'
import {
  absAzimuthDifference,
  angularDiameter,
  angularSeparation,
  azimuthDifference,
  clamp,
  isAzimuthWithinRange,
  normalizeAzimuth,
  normalizeSigned,
} from './angles'

const dir = (azimuth: number, altitude: number) => ({
  azimuth: deg(azimuth),
  altitude: deg(altitude),
})

describe('normalizeAzimuth', () => {
  it('leaves 0 and in-range values alone', () => {
    expect(normalizeAzimuth(deg(0))).toBe(0)
    expect(normalizeAzimuth(deg(123.5))).toBe(123.5)
  })
  it('maps 360 to 0', () => {
    expect(normalizeAzimuth(deg(360))).toBe(0)
  })
  it('handles negatives', () => {
    expect(normalizeAzimuth(deg(-90))).toBe(270)
  })
  it('handles large values', () => {
    expect(normalizeAzimuth(deg(720.5))).toBeCloseTo(0.5, 10)
    expect(normalizeAzimuth(deg(-1080 - 10))).toBeCloseTo(350, 10)
  })
  it('turns -0 into +0', () => {
    expect(Object.is(normalizeAzimuth(deg(-0)), 0)).toBe(true)
  })
  it('never returns 360 for tiny negatives', () => {
    const r = normalizeAzimuth(deg(-1e-14))
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(360)
  })
})

describe('normalizeSigned', () => {
  it('maps into (-180, 180]', () => {
    expect(normalizeSigned(deg(190))).toBe(-170)
    expect(normalizeSigned(deg(-190))).toBe(170)
    expect(normalizeSigned(deg(360))).toBe(0)
  })
  it('180 boundary: both 180 and -180 map to +180', () => {
    expect(normalizeSigned(deg(180))).toBe(180)
    expect(normalizeSigned(deg(-180))).toBe(180)
  })
})

describe('azimuthDifference / absAzimuthDifference', () => {
  it('wraps across north in both directions', () => {
    expect(azimuthDifference(deg(359), deg(1))).toBeCloseTo(2, 10)
    expect(azimuthDifference(deg(1), deg(359))).toBeCloseTo(-2, 10)
  })
  it('is positive when target is clockwise', () => {
    expect(azimuthDifference(deg(90), deg(100))).toBe(10)
    expect(azimuthDifference(deg(100), deg(90))).toBe(-10)
  })
  it('exactly opposite directions give +180 either way', () => {
    expect(azimuthDifference(deg(0), deg(180))).toBe(180)
    expect(azimuthDifference(deg(180), deg(0))).toBe(180)
  })
  it('absolute difference uses the short way round', () => {
    expect(absAzimuthDifference(deg(359), deg(1))).toBeCloseTo(2, 10)
    expect(absAzimuthDifference(deg(1), deg(359))).toBeCloseTo(2, 10)
    expect(absAzimuthDifference(deg(0), deg(180))).toBe(180)
  })
})

describe('angularSeparation', () => {
  it('is 0 for identical directions', () => {
    expect(angularSeparation(dir(123, 45), dir(123, 45))).toBe(0)
  })
  it('equals the azimuth difference at altitude 0', () => {
    expect(angularSeparation(dir(10, 0), dir(25, 0))).toBeCloseTo(15, 10)
    expect(angularSeparation(dir(359, 0), dir(1, 0))).toBeCloseTo(2, 10)
  })
  it('shrinks by cos(altitude) for small azimuth differences', () => {
    expect(angularSeparation(dir(100, 60), dir(101, 60))).toBeCloseTo(0.5, 3)
  })
  it('converges at the zenith regardless of azimuth', () => {
    expect(angularSeparation(dir(0, 90), dir(200, 90))).toBeCloseTo(0, 9)
  })
  it('measures pure altitude differences directly', () => {
    expect(angularSeparation(dir(50, 10), dir(50, 30))).toBeCloseTo(20, 10)
  })
  it('is accurate for tiny separations', () => {
    expect(angularSeparation(dir(45, 20), dir(45, 20.001))).toBeCloseTo(0.001, 9)
    expect(angularSeparation(dir(45, 0), dir(45.001, 0))).toBeCloseTo(0.001, 9)
  })
  it('gives 180 for antipodes', () => {
    expect(angularSeparation(dir(0, 0), dir(180, 0))).toBeCloseTo(180, 9)
    expect(angularSeparation(dir(30, 40), dir(210, -40))).toBeCloseTo(180, 9)
  })
  it('is symmetric', () => {
    const a = dir(12, 33)
    const b = dir(200, -5)
    expect(angularSeparation(a, b)).toBeCloseTo(angularSeparation(b, a), 12)
  })
})

describe('clamp', () => {
  it('clamps to bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('angularDiameter', () => {
  it('gives about 0.5179 degrees for the Moon', () => {
    expect(angularDiameter(3_474_800, 384_400_000)).toBeCloseTo(0.5179, 3)
  })
  it('matches the small-angle approximation for tiny objects', () => {
    expect(angularDiameter(1, 1000)).toBeCloseTo((1 / 1000) * (180 / Math.PI), 6)
  })
})

describe('isAzimuthWithinRange', () => {
  it('handles a plain range', () => {
    expect(isAzimuthWithinRange(deg(90), deg(80), deg(100))).toBe(true)
    expect(isAzimuthWithinRange(deg(101), deg(80), deg(100))).toBe(false)
  })
  it('includes both endpoints', () => {
    expect(isAzimuthWithinRange(deg(80), deg(80), deg(100))).toBe(true)
    expect(isAzimuthWithinRange(deg(100), deg(80), deg(100))).toBe(true)
  })
  it('handles a range wrapping through north', () => {
    expect(isAzimuthWithinRange(deg(0), deg(350), deg(10))).toBe(true)
    expect(isAzimuthWithinRange(deg(5), deg(350), deg(10))).toBe(true)
    expect(isAzimuthWithinRange(deg(355), deg(350), deg(10))).toBe(true)
    expect(isAzimuthWithinRange(deg(180), deg(350), deg(10))).toBe(false)
  })
  it('does not treat the reverse arc as inside', () => {
    expect(isAzimuthWithinRange(deg(90), deg(10), deg(350))).toBe(true)
    expect(isAzimuthWithinRange(deg(0), deg(10), deg(350))).toBe(false)
  })
  it('normalizes out-of-range inputs', () => {
    expect(isAzimuthWithinRange(deg(365), deg(-10), deg(10))).toBe(true)
  })
})
