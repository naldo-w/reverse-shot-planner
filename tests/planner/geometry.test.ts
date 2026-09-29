import { describe, expect, it } from 'vitest'
import { PRESET_LANDMARKS } from '../../src/data/presets'
import {
  cameraPosition,
  landmarkOutline,
  targetDirection,
  targetPosition,
  terrestrialRefraction,
} from '../../src/core/planner'
import { DEFAULT_EYE_HEIGHT } from '../../src/core/planner'
import { destinationPoint } from '../../src/core/geometry/geodesy'
import { deg, m } from '../../src/core/units'

const R = 6371008.8

describe('planner geometry', () => {
  it('terrestrialRefraction = k d / 2R', () => {
    expect(terrestrialRefraction(10000, 0.13)).toBeCloseTo(((0.13 * 10000) / (2 * R)) * (180 / Math.PI), 9)
    expect(terrestrialRefraction(0)).toBe(0)
  })

  it('cameraPosition adds eye height', () => {
    const c = cameraPosition({ lat: deg(22), lon: deg(114) }, 5)
    expect(c.height).toBeCloseTo(5 + DEFAULT_EYE_HEIGHT, 9)
  })

  it('targetDirection altitude ≈ atan(Δh/d) − curvature + refraction', () => {
    const origin = { lat: deg(22.3), lon: deg(114.1) }
    const camera = cameraPosition(origin, 5)
    for (const d of [3000, 8000, 20000]) {
      const p = destinationPoint(origin, deg(75), m(d))
      const target = { ...p, height: m(495) }
      const dir = targetDirection(camera, target)
      const dh = 495 - camera.height
      const expected =
        (Math.atan2(dh, d) - d / (2 * R)) * (180 / Math.PI) + terrestrialRefraction(d, 0.13)
      expect(dir.apparentAltitude).toBeCloseTo(expected, 2)
      expect(Math.abs(dir.apparentAltitude - expected)).toBeLessThan(0.002)
      expect(dir.azimuth).toBeCloseTo(75, 1)
      expect(Math.abs(dir.distance - Math.hypot(d, dh))).toBeLessThan(d * 0.002)
    }
  })

  it('targetPosition uses topHeight', () => {
    const lm = PRESET_LANDMARKS[0]!
    expect(targetPosition(lm).height).toBe(lm.topHeight)
  })

  it('bridge outline: non-empty, pylon top above base, 3 km away', () => {
    const lm = PRESET_LANDMARKS.find((l) => l.id === 'danjiang-bridge')!
    const p = destinationPoint(lm.coordinate, deg(250), m(3000))
    const cam = cameraPosition(p, 3)
    const lines = landmarkOutline(cam, lm)
    expect(lines.length).toBe(3 + 12)
    for (const l of lines) expect(l.length).toBeGreaterThanOrEqual(2)
    const pylon = lines[0]!
    expect(pylon[1]!.altitude).toBeGreaterThan(pylon[0]!.altitude)
    const base = lines[1]!
    expect(base[0]!.altitude).toBeLessThan(base[1]!.altitude)
    // pylon top apparent altitude equals targetDirection of the aim point
    expect(pylon[1]!.altitude).toBeCloseTo(targetDirection(cam, targetPosition(lm)).apparentAltitude, 6)
  })

  it('mountains have no outline', () => {
    const lm = PRESET_LANDMARKS.find((l) => l.kind === 'mountain')!
    expect(landmarkOutline(cameraPosition(lm.coordinate, 0), lm)).toEqual([])
  })
})
