import { describe, expect, it } from 'vitest'
import { createCelestialEngine } from '../../src/core/astronomy'
import {
  bodyTrack,
  dailyEvents,
  dayTrack,
  formatLocal,
  fromLocalParts,
  localDayRange,
  multiDayTrack,
  toLocalParts,
} from '../../src/core/planner'
import { deg, m } from '../../src/core/units'

const engine = createCelestialEngine()
const hk = { lat: deg(22.35), lon: deg(114.18), height: m(10) }

describe('local time helpers', () => {
  it('round-trips and formats UTC+8', () => {
    const d = new Date('2027-03-20T16:30:00Z')
    expect(formatLocal(d, 480)).toBe('2027-03-21 00:30')
    expect(fromLocalParts(toLocalParts(d, 480), 480).getTime()).toBe(d.getTime())
  })
  it('localDayRange for UTC+8', () => {
    const { start, end } = localDayRange('2027-03-21', 480)
    expect(start.toISOString()).toBe('2027-03-20T16:00:00.000Z')
    expect(end.toISOString()).toBe('2027-03-21T16:00:00.000Z')
  })
})

describe('tracks', () => {
  it('dayTrack: 288 points, monotonic, within the local day', () => {
    const t = dayTrack(engine, 'sun', hk, '2027-03-21', 480)
    expect(t.length).toBe(288)
    for (let i = 1; i < t.length; i++) expect(t[i]!.time.getTime()).toBeGreaterThan(t[i - 1]!.time.getTime())
    expect(formatLocal(t[0]!.time, 480)).toBe('2027-03-21 00:00')
    expect(formatLocal(t.at(-1)!.time, 480)).toBe('2027-03-21 23:55')
    const noon = t[144]!
    expect(noon.altitude).toBeGreaterThan(60)
    expect(noon.apparentAltitude).toBeGreaterThanOrEqual(noon.altitude)
  })
  it('bodyTrack includes both endpoints', () => {
    const s = new Date('2027-01-01T00:00:00Z')
    const t = bodyTrack(engine, 'moon', hk, s, new Date(s.getTime() + 3600_000), 15)
    expect(t.length).toBe(5)
  })
  it('multiDayTrack keeps the local clock time', () => {
    const t = multiDayTrack(engine, 'sun', hk, '2027-02-27', 5, 6 * 60 + 30, 480)
    expect(t.length).toBe(5)
    expect(t.map((p) => formatLocal(p.time, 480))).toEqual([
      '2027-02-27 06:30',
      '2027-02-28 06:30',
      '2027-03-01 06:30',
      '2027-03-02 06:30',
      '2027-03-03 06:30',
    ])
  })
})

describe('dailyEvents', () => {
  it('a Hong Kong day has 1–2 sun events and sorted output', () => {
    const days = dailyEvents(engine, hk, '2027-03-21', 3, 480)
    expect(days.map((d) => d.localDate)).toEqual(['2027-03-21', '2027-03-22', '2027-03-23'])
    for (const d of days) {
      const sun = d.events.filter((e) => e.body === 'sun')
      expect(sun.length).toBeGreaterThanOrEqual(1)
      expect(sun.length).toBeLessThanOrEqual(2)
      for (let i = 1; i < d.events.length; i++)
        expect(d.events[i]!.time.getTime()).toBeGreaterThanOrEqual(d.events[i - 1]!.time.getTime())
    }
    const sun = days[0]!.events.filter((e) => e.body === 'sun')
    expect(sun.map((e) => e.kind)).toEqual(['rise', 'set'])
    expect(sun[0]!.azimuth).toBeGreaterThan(85)
    expect(sun[0]!.azimuth).toBeLessThan(95)
  })
})
