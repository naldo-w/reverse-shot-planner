import { describe, it, expect } from 'vitest'
import type { CameraDefinition } from '../types'
import { deg, mm, toDegrees, toRadians } from '../units'
import { aspectRatio, cropSensor, fieldOfView, focalLengthForFov } from './fov'
import { isInFrame, projectToSensor, sensorToDirection, type CameraPose } from './projection'

const cam = (f: number, w = 36, h = 24): CameraDefinition => ({
  sensorWidth: mm(w),
  sensorHeight: mm(h),
  focalLength: mm(f),
})
const pose = (az: number, alt: number, roll?: number): CameraPose =>
  roll === undefined
    ? { azimuth: deg(az), altitude: deg(alt) }
    : { azimuth: deg(az), altitude: deg(alt), roll: deg(roll) }
const dir = (az: number, alt: number) => ({ azimuth: deg(az), altitude: deg(alt) })

describe('fieldOfView', () => {
  it('matches known values @ 50 mm', () => {
    const f = fieldOfView(cam(50))
    expect(f.horizontal).toBeCloseTo(39.5978, 3)
    expect(f.vertical).toBeCloseTo(26.9915, 3)
    expect(f.diagonal).toBeCloseTo(46.793, 3)
  })
  it('matches known values @ 400 mm', () => {
    const f = fieldOfView(cam(400))
    expect(f.horizontal).toBeCloseTo(5.1531, 3)
    expect(f.vertical).toBeCloseTo(3.4369, 3)
    expect(f.diagonal).toBeCloseTo(6.1915, 3)
  })
  it('matches known value @ 24 mm', () => {
    expect(fieldOfView(cam(24)).horizontal).toBeCloseTo(73.7398, 3)
  })
})

describe('focalLengthForFov', () => {
  it('round trips', () => {
    const f = fieldOfView(cam(135))
    expect(focalLengthForFov(mm(36), f.horizontal)).toBeCloseTo(135, 9)
    expect(focalLengthForFov(mm(24), f.vertical)).toBeCloseTo(135, 9)
  })
})

describe('cropSensor / aspectRatio', () => {
  it('reports aspect', () => {
    expect(aspectRatio(cam(50))).toBeCloseTo(1.5, 12)
  })
  it('crops 3:2 to 16:9', () => {
    const c = cropSensor(cam(50), 16 / 9)
    expect(c.sensorWidth).toBeCloseTo(36, 12)
    expect(c.sensorHeight).toBeCloseTo(20.25, 12)
    expect(c.focalLength).toBe(50)
  })
  it('crops 3:2 to 1:1', () => {
    const c = cropSensor(cam(50), 1)
    expect(c.sensorWidth).toBeCloseTo(24, 12)
    expect(c.sensorHeight).toBeCloseTo(24, 12)
  })
  it('crops a wider aspect than the sensor by width', () => {
    const c = cropSensor(cam(50), 2)
    expect(c.sensorWidth).toBeCloseTo(36, 12)
    expect(c.sensorHeight).toBeCloseTo(18, 12)
  })
  it('rejects invalid aspect', () => {
    expect(() => cropSensor(cam(50), 0)).toThrow(RangeError)
  })
})

describe('projection', () => {
  const c = cam(50)
  const f = fieldOfView(c)

  it('maps the pose direction to the centre', () => {
    const p = projectToSensor(dir(123, 35), pose(123, 35), c)
    expect(p.x).toBeCloseTo(0, 12)
    expect(p.y).toBeCloseTo(0, 12)
    expect(p.inFront).toBe(true)
  })

  it('half horizontal FOV at altitude 0 gives x = +-1', () => {
    const half = f.horizontal / 2
    expect(projectToSensor(dir(90 + half, 0), pose(90, 0), c).x).toBeCloseTo(1, 9)
    expect(projectToSensor(dir(90 - half, 0), pose(90, 0), c).x).toBeCloseTo(-1, 9)
  })

  it('half vertical FOV gives y = +-1', () => {
    const half = f.vertical / 2
    expect(projectToSensor(dir(90, half), pose(90, 0), c).y).toBeCloseTo(1, 9)
    expect(projectToSensor(dir(90, -half), pose(90, 0), c).y).toBeCloseTo(-1, 9)
  })

  it('handles azimuth wrap', () => {
    const p = projectToSensor(dir(1, 0), pose(359, 0), c)
    expect(p.x).toBeGreaterThan(0)
    const expected = Math.tan(toRadians(deg(2))) / Math.tan(toRadians(deg(f.horizontal / 2)))
    expect(p.x).toBeCloseTo(expected, 9)
    const q = projectToSensor(dir(359, 0), pose(1, 0), c)
    expect(q.x).toBeCloseTo(-expected, 9)
    expect(projectToSensor(dir(360, 0), pose(0, 0), c).x).toBeCloseTo(0, 12)
  })

  it('is truly gnomonic at high altitude (not the naive offset)', () => {
    const p = projectToSensor(dir(91, 60), pose(90, 60), c)
    const naive = Math.tan(toRadians(deg(1))) / Math.tan(toRadians(deg(f.horizontal / 2)))
    // Exact: xc = cos(alt) sin(dAz); zc = cos^2(alt) cos(dAz) + sin^2(alt)
    const alt = toRadians(deg(60))
    const dAz = toRadians(deg(1))
    const zc = Math.cos(alt) ** 2 * Math.cos(dAz) + Math.sin(alt) ** 2
    const expected = ((Math.cos(alt) * Math.sin(dAz)) / zc) * (2 * 50) / 36
    expect(p.x).toBeCloseTo(expected, 12)
    expect(Math.abs(p.x - naive)).toBeGreaterThan(0.005)
    // and the inverse recovers the original direction
    const back = sensorToDirection(p.x, p.y, pose(90, 60), c)
    expect(back.azimuth).toBeCloseTo(91, 9)
    expect(back.altitude).toBeCloseTo(60, 9)
    // same altitude curves: the circle of constant altitude bends toward the zenith (up)
    expect(p.y).toBeGreaterThan(0)
  })

  it('roll 90 swaps axes', () => {
    const half = f.horizontal / 2
    const target = dir(90 + half, 0)
    const p0 = projectToSensor(target, pose(90, 0), c)
    const p1 = projectToSensor(target, pose(90, 0, 90), c)
    expect(p0.x).toBeCloseTo(1, 9)
    expect(p1.x).toBeCloseTo(0, 9)
    // sensor y spans 24 mm vs x 36 mm, so the same offset is 1.5x further in y units
    expect(p1.y).toBeCloseTo(-1.5, 9)
    const up = projectToSensor(dir(90, 10), pose(90, 0, 90), c)
    expect(up.x).toBeGreaterThan(0)
    expect(up.y).toBeCloseTo(0, 9)
  })

  it('flags points behind the camera', () => {
    expect(projectToSensor(dir(270, 0), pose(90, 0), c).inFront).toBe(false)
    expect(projectToSensor(dir(90, -10), pose(90, 90), c).inFront).toBe(false)
    expect(isInFrame(dir(270, 0), pose(90, 0), c)).toBe(false)
  })

  it('isInFrame respects the sensor edges', () => {
    expect(isInFrame(dir(90, 0), pose(90, 0), c)).toBe(true)
    expect(isInFrame(dir(90 + f.horizontal / 2 - 0.01, 0), pose(90, 0), c)).toBe(true)
    expect(isInFrame(dir(90 + f.horizontal / 2 + 0.01, 0), pose(90, 0), c)).toBe(false)
    expect(isInFrame(dir(90, f.vertical / 2 + 0.01), pose(90, 0), c)).toBe(false)
  })

  it('round trips projectToSensor o sensorToDirection', () => {
    const poses = [pose(0, 0), pose(359, 60), pose(200, -30, 25), pose(45, 80, -110), pose(10, 5, 90)]
    const cams = [cam(24), cam(50), cam(400), cam(85, 17.3, 13)]
    for (const ps of poses) {
      for (const cm of cams) {
        for (const [x, y] of [[0, 0], [0.7, -0.4], [-1, 1], [0.25, 0.9]] as const) {
          const d = sensorToDirection(x, y, ps, cm)
          const p = projectToSensor(d, ps, cm)
          expect(p.inFront).toBe(true)
          expect(Math.abs(p.x - x)).toBeLessThan(1e-9)
          expect(Math.abs(p.y - y)).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('exposes toDegrees consistency', () => {
    expect(toDegrees(toRadians(deg(12.5)))).toBeCloseTo(12.5, 12)
  })
})
