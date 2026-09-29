import { describe, expect, it } from 'vitest'
import { createCelestialEngine, refract } from '../../src/core/astronomy'
import {
  alignmentLines,
  cameraPosition,
  findAlignments,
  formatLocal,
  targetDirection,
  targetPosition,
} from '../../src/core/planner'
import { PRESET_LANDMARKS, PRESET_SPOTS } from '../../src/data/presets'
import { destinationPoint, initialBearing } from '../../src/core/geometry/geodesy'
import { deg, m } from '../../src/core/units'

const engine = createCelestialEngine()
const hk = { lat: deg(22.35), lon: deg(114.18) }
const camera = cameraPosition(hk, 5)

describe('findAlignments', () => {
  it('finds a constructed Moon alignment within 2 s with ~0 vertical offset', () => {
    // Pick an instant with the Moon between 4° and 18° apparent altitude.
    let t0 = new Date('2027-05-10T00:00:00Z').getTime()
    for (;; t0 += 600_000) {
      const s = engine.getPosition('moon', new Date(t0), camera)
      const a = refract(s.altitude)
      if (a > 4 && a < 18) break
    }
    const when = new Date(t0)
    const moon = engine.getPosition('moon', when, camera)
    const wantApp = refract(moon.altitude)
    const d = 5000
    const p = destinationPoint(hk, moon.azimuth, m(d))
    let h = camera.height + d * Math.tan((wantApp * Math.PI) / 180)
    for (let i = 0; i < 8; i++) {
      const got = targetDirection(camera, { ...p, height: m(h) }).apparentAltitude
      h += ((wantApp - got) * Math.PI) / 180 * d
    }
    const target = { ...p, height: m(h) }

    const res = findAlignments(engine, {
      camera,
      target,
      body: 'moon',
      start: new Date(t0 - 2 * 86400_000),
      end: new Date(t0 + 2 * 86400_000),
    })
    const hit = res.find((a) => Math.abs(a.time.getTime() - t0) <= 2000)
    expect(hit).toBeDefined()
    expect(Math.abs(hit!.verticalOffset)).toBeLessThan(0.01)
    expect(hit!.illumination).toBeGreaterThanOrEqual(0)
    expect(hit!.illumination).toBeLessThanOrEqual(1)
    for (let i = 1; i < res.length; i++) expect(res[i]!.time.getTime()).toBeGreaterThan(res[i - 1]!.time.getTime())
  })

  it('processes 366 days quickly', () => {
    const lm = PRESET_LANDMARKS.find((l) => l.id === 'lion-rock')!
    const cam = cameraPosition(PRESET_SPOTS.find((s) => s.id === 'lr-tsing-yi')!.coordinate, 5)
    const start = new Date('2027-01-01T00:00:00Z')
    const end = new Date(start.getTime() + 366 * 86400_000)
    const times: Record<string, number> = {}
    let total = 0
    for (const body of ['sun', 'moon'] as const) {
      const t = performance.now()
      const r = findAlignments(engine, { camera: cam, target: targetPosition(lm), body, start, end })
      times[body] = Math.round(performance.now() - t)
      total += performance.now() - t
      expect(r.length).toBeGreaterThan(0)
    }
    console.log(`findAlignments 366 days: sun ${times['sun']} ms, moon ${times['moon']} ms`)
    expect(total).toBeLessThan(3000)
  })

  it('Lion Rock from Tsing Yi: Sun rising alignments near the equinoxes in 2027', () => {
    const lm = PRESET_LANDMARKS.find((l) => l.id === 'lion-rock')!
    const spot = PRESET_SPOTS.find((s) => s.id === 'lr-tsing-yi')!
    const cam = cameraPosition(spot.coordinate, 5)
    const res = findAlignments(engine, {
      camera: cam,
      target: targetPosition(lm),
      body: 'sun',
      start: new Date('2026-12-31T16:00:00Z'),
      end: new Date('2027-12-31T16:00:00Z'),
    })
    for (const a of res)
      console.log(
        `${formatLocal(a.time, 480)} ${a.direction} az ${a.body_.azimuth.toFixed(2)} alt ${a.body_.apparentAltitude.toFixed(2)} vOff ${a.verticalOffset.toFixed(2)}`,
      )
    const eq = res.filter((a) => {
      const mo = Number(formatLocal(a.time, 480).slice(5, 7))
      return a.direction === 'rising' && (mo === 3 || mo === 9)
    })
    expect(eq.length).toBeGreaterThanOrEqual(1)
  })
})

describe('alignmentLines', () => {
  it('gives rise/set lines toward azimuth + 180', () => {
    const lm = PRESET_LANDMARKS.find((l) => l.id === 'lion-rock')!
    const lines = alignmentLines(engine, 'sun', lm, '2027-03-21', 480)
    expect(lines.map((l) => l.kind)).toEqual(['rise', 'set'])
    for (const l of lines) {
      expect(Math.abs(initialBearing(l.from, l.to) - ((l.azimuth + 180) % 360))).toBeLessThan(0.05)
    }
    expect(lines[0]!.azimuth).toBeGreaterThan(85)
    expect(lines[0]!.azimuth).toBeLessThan(95)
  })
})
