import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/ephemeris.json'
import { AstronomyEngineEngine } from '../../src/core/astronomy/engines/astronomyEngine'
import type { Observer } from '../../src/core/astronomy/types'
import { deg, m } from '../../src/core/units'
import { describeConformance } from './conformance'

const engine = new AstronomyEngineEngine()

describeConformance(engine, {
  azimuthDeg: { sun: 0.02, moon: 0.05 },
  altitudeDeg: { sun: 0.02, moon: 0.05 },
  distanceRel: { sun: 1e-3, moon: 3e-3 },
  eventSeconds: { sun: 60, moon: 120 },
})

const hk: Observer = { lat: deg(22.35), lon: deg(114.18), height: m(0) }

describe('AstronomyEngineEngine specifics', () => {
  it('Hong Kong local day 2026-10-06 (UTC+8) matches fixture events in the window', () => {
    const start = new Date('2026-10-05T16:00:00Z')
    const end = new Date('2026-10-06T16:00:00Z')
    for (const body of ['sun', 'moon'] as const) {
      const expected = fixture.events.filter((e) => {
        if (e.site !== 'hk-sea-level' || e.body !== body) return false
        const t = new Date(e.utc).getTime()
        return t >= start.getTime() && t < end.getTime()
      })
      const got = engine.findEvents(body, hk, start, end)
      expect(expected.length).toBeGreaterThan(0)
      expect(got.length).toBe(expected.length)
      const sorted = [...expected].sort((a, b) => a.utc.localeCompare(b.utc))
      sorted.forEach((e, i) => {
        const g = got[i]
        expect(g?.kind).toBe(e.event)
        expect(Math.abs((g?.time.getTime() ?? 0) - new Date(e.utc).getTime())).toBeLessThan(120_000)
        expect(g?.time.getTime()).toBeGreaterThanOrEqual(start.getTime())
        expect(g?.time.getTime()).toBeLessThan(end.getTime())
      })
    }
  })

  it('returns no Sun events in Tromsø polar night (late Dec 2026)', () => {
    const tromso: Observer = { lat: deg(69.65), lon: deg(18.96), height: m(0) }
    expect(engine.findEvents('sun', tromso, new Date('2026-12-20T00:00:00Z'), new Date('2026-12-28T00:00:00Z'))).toEqual([])
  })

  it('event azimuths are north-based and in [0, 360)', () => {
    const [ev] = engine.findEvents('sun', hk, new Date('2026-10-05T16:00:00Z'), new Date('2026-10-06T16:00:00Z'))
    expect(ev?.kind).toBe('rise')
    expect(ev?.azimuth).toBeGreaterThan(80)
    expect(ev?.azimuth).toBeLessThan(100)
  })

  it('moon phase sanity', () => {
    // New moon 2026-09-11 ~03:27Z, full moon 2026-09-26 ~16:49Z (approx.).
    const newMoon = engine.getMoonPhase(new Date('2026-09-11T03:27:00Z'))
    expect(newMoon.illumination).toBeLessThan(0.01)
    const full = engine.getMoonPhase(new Date('2026-09-26T16:49:00Z'))
    expect(full.illumination).toBeGreaterThan(0.99)
    expect(Math.abs(full.phase - 0.5)).toBeLessThan(0.01)
    const waxing = engine.getMoonPhase(new Date('2026-09-18T00:00:00Z'))
    expect(waxing.waxing).toBe(true)
    expect(waxing.phase).toBeGreaterThan(0)
    expect(waxing.phase).toBeLessThan(0.5)
    const waning = engine.getMoonPhase(new Date('2026-10-02T00:00:00Z'))
    expect(waning.waxing).toBe(false)
    expect(waning.phase).toBeGreaterThan(0.5)
  })

  it('angular diameters are plausible', () => {
    const t = new Date('2026-10-06T06:00:00Z')
    const sun = engine.getPosition('sun', t, hk).angularDiameter
    const moon = engine.getPosition('moon', t, hk).angularDiameter
    expect(sun).toBeGreaterThan(0.52)
    expect(sun).toBeLessThan(0.55)
    expect(moon).toBeGreaterThan(0.49)
    expect(moon).toBeLessThan(0.57)
  })

  it('performance: 10,000 moon getPosition calls', () => {
    const t0 = Date.now()
    let acc = 0
    for (let i = 0; i < 10_000; i++) {
      acc += engine.getPosition('moon', new Date(1_790_000_000_000 + i * 60_000), hk).altitude
    }
    const ms = Date.now() - t0
    console.info(`[astronomy-engine] 10,000 moon getPosition calls: ${ms} ms`)
    expect(Number.isFinite(acc)).toBe(true)
    expect(ms).toBeLessThan(5000)
  })
})
