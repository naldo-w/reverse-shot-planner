/**
 * Cross-module consistency checks. Each engine was written independently;
 * these tests pin them to each other so a regression in one shows up as a
 * disagreement rather than a silently shifted result.
 */
import { describe, expect, it } from 'vitest'
import { lookAngle } from '../src/core/coordinates/enu'
import { destinationPoint, earthCurvatureDrop, initialBearing } from '../src/core/geometry/geodesy'
import { absAzimuthDifference, angularDiameter } from '../src/core/geometry/angles'
import { fieldOfView } from '../src/core/camera/fov'
import { deg, m, mm, toDegrees, rad } from '../src/core/units'
import type { GeodeticPosition } from '../src/core/types'

// Generic Hong Kong-latitude origin (not tied to any product feature).
const origin: GeodeticPosition = { lat: deg(22.35), lon: deg(114.18), height: m(0) }

describe('ENU look angle vs Vincenty geodesic', () => {
  for (const distanceM of [2_000, 15_000, 50_000]) {
    for (const bearing of [0, 37, 90, 145, 180, 233, 270, 318]) {
      it(`azimuths agree at ${distanceM / 1000} km, bearing ${bearing}°`, () => {
        const p = destinationPoint(origin, deg(bearing), m(distanceM))
        const target: GeodeticPosition = { ...p, height: m(0) }
        const enuAz = lookAngle(origin, target).azimuth
        const geoAz = initialBearing(origin, p)
        // Normal-section vs geodesic azimuth differ by < 1e-5° at these ranges.
        expect(absAzimuthDifference(enuAz, geoAz)).toBeLessThan(1e-5)
      })
    }
  }
})

describe('ENU altitude vs curvature-drop formula', () => {
  it('altitude of a same-height point matches −drop/d within 1e-4°', () => {
    for (const d of [5_000, 15_000, 30_000]) {
      const p = destinationPoint(origin, deg(60), m(d))
      const alt = lookAngle(origin, { ...p, height: m(0) }).altitude
      const expected = toDegrees(rad(-earthCurvatureDrop(m(d)) / d))
      expect(Math.abs(alt - expected)).toBeLessThan(1e-4)
    }
  })

  it('raising the target by its curvature drop brings it back to ~0° altitude', () => {
    const d = 20_000
    const p = destinationPoint(origin, deg(200), m(d))
    const alt = lookAngle(origin, { ...p, height: m(earthCurvatureDrop(m(d))) }).altitude
    expect(Math.abs(alt)).toBeLessThan(1e-3)
  })
})

describe('Moon in a 400 mm frame', () => {
  it('occupies ~10% of full-frame width', () => {
    const moon = angularDiameter(3_474_800, 384_400_000)
    const fov = fieldOfView({ sensorWidth: mm(36), sensorHeight: mm(24), focalLength: mm(400) })
    const fraction = moon / fov.horizontal
    expect(fraction).toBeGreaterThan(0.095)
    expect(fraction).toBeLessThan(0.105)
  })
})
