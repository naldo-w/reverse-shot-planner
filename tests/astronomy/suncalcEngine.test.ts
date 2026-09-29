import { describe, expect, it } from 'vitest'
import { SuncalcEngine, suncalcApparentToGeometric, suncalcRefractionRad } from '../../src/core/astronomy/engines/suncalcEngine'
import type { Observer } from '../../src/core/astronomy/types'
import { deg, m } from '../../src/core/units'
import { describeConformance } from './conformance'

const engine = new SuncalcEngine()
const hk: Observer = { lat: deg(22.35), lon: deg(114.18), height: m(0) }

describeConformance(engine, {
  azimuthDeg: { sun: 0.02, moon: 0.05 },
  altitudeDeg: { sun: 0.02, moon: 0.05 },
  distanceRel: { sun: 1e-3, moon: 3e-3 },
  eventSeconds: { sun: 60, moon: 120 },
})

describe('SunCalc refraction inversion', () => {
  it('round-trips against the forward SunCalc formula', () => {
    let worst = 0
    for (let h = -5; h <= 90; h += 0.05) {
      const app = h + (suncalcRefractionRad((h * Math.PI) / 180) * 180) / Math.PI
      const back = suncalcApparentToGeometric(app)
      worst = Math.max(worst, Math.abs(back - h))
    }
    expect(worst).toBeLessThan(1e-7)
  })

  it('handles the horizon kink (apparent below R(0))', () => {
    const r0 = (suncalcRefractionRad(0) * 180) / Math.PI
    expect(suncalcApparentToGeometric(r0)).toBeCloseTo(0, 9)
    expect(suncalcApparentToGeometric(-2)).toBeCloseTo(-2 - r0, 9)
  })
})

describe('findEvents', () => {
  const start = new Date('2026-10-05T16:00:00Z')
  const end = new Date('2026-10-06T16:00:00Z')

  it('returns sorted, deduplicated events inside [start, end)', () => {
    for (const body of ['sun', 'moon'] as const) {
      const ev = engine.findEvents(body, hk, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'))
      expect(ev.length).toBeGreaterThan(6)
      for (let i = 1; i < ev.length; i++) {
        const prev = ev[i - 1]
        const cur = ev[i]
        if (!prev || !cur) throw new Error('missing event')
        expect(cur.time.getTime()).toBeGreaterThanOrEqual(prev.time.getTime())
        if (cur.kind === prev.kind) expect(cur.time.getTime() - prev.time.getTime()).toBeGreaterThan(60_000)
      }
      for (const e of ev) {
        expect(e.time.getTime()).toBeGreaterThanOrEqual(new Date('2026-10-01T00:00:00Z').getTime())
        expect(e.time.getTime()).toBeLessThan(new Date('2026-10-08T00:00:00Z').getTime())
      }
    }
  })

  it('HK local day 2026-10-06 returns the fixture events', () => {
    const sun = engine.findEvents('sun', hk, start, end)
    expect(sun.map((e) => e.kind)).toEqual(['rise', 'set'])
    const moon = engine.findEvents('moon', hk, start, end)
    // Fixture (Skyfield): moonrise 2026-10-05T17:49:21Z, moonset 2026-10-06T07:15:55Z.
    expect(moon.map((e) => e.kind)).toEqual(['rise', 'set'])
    const [rise, set] = moon
    expect(Math.abs((rise?.time.getTime() ?? 0) - Date.parse('2026-10-05T17:49:21Z')) / 1000).toBeLessThan(120)
    expect(Math.abs((set?.time.getTime() ?? 0) - Date.parse('2026-10-06T07:15:55Z')) / 1000).toBeLessThan(120)
    for (const e of [...sun, ...moon]) {
      expect(e.time.getTime()).toBeGreaterThanOrEqual(start.getTime())
      expect(e.time.getTime()).toBeLessThan(end.getTime())
    }
  })

  it('half-open window excludes an event at exactly `end`', () => {
    const [first] = engine.findEvents('sun', hk, start, end)
    if (!first) throw new Error('no event')
    expect(engine.findEvents('sun', hk, start, first.time).some((e) => e.time.getTime() === first.time.getTime())).toBe(false)
    expect(engine.findEvents('sun', hk, first.time, end)[0]?.time.getTime()).toBe(first.time.getTime())
  })
})

describe('getMoonPhase', () => {
  it('returns sane values', () => {
    for (let i = 0; i < 30; i++) {
      const p = engine.getMoonPhase(new Date(Date.UTC(2026, 9, 1 + i)))
      expect(p.illumination).toBeGreaterThanOrEqual(0)
      expect(p.illumination).toBeLessThanOrEqual(1)
      expect(p.phase).toBeGreaterThanOrEqual(0)
      expect(p.phase).toBeLessThanOrEqual(1)
      expect(p.waxing).toBe(p.phase < 0.5)
    }
  })
})
