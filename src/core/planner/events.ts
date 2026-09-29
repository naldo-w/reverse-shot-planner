import type { CelestialEngine, Observer } from '../astronomy'
import type { CelestialBody } from '../types'
import { formatLocal, fromLocalParts, localDayRange } from './tracks'
import type { DailyEvents } from './types'

const BODIES: readonly CelestialBody[] = ['sun', 'moon']

/**
 * Sun and Moon rise/set for `days` consecutive local days starting at
 * `startLocalDate`. Events are sorted by time within each day. A day may have
 * 0–1 Moon events (the Moon rises ~50 min later each day).
 */
export function dailyEvents(
  engine: CelestialEngine,
  camera: Observer,
  startLocalDate: string,
  days: number,
  utcOffsetMinutes: number,
): DailyEvents[] {
  const first = localDayRange(startLocalDate, utcOffsetMinutes).start
  const out: DailyEvents[] = []
  for (let i = 0; i < days; i++) {
    // Re-derive each day via local parts so day arithmetic stays calendar-correct.
    const p = new Date(first.getTime() + utcOffsetMinutes * 60_000)
    const dayStart = fromLocalParts(
      { y: p.getUTCFullYear(), mo: p.getUTCMonth() + 1, d: p.getUTCDate() + i, h: 0, mi: 0 },
      utcOffsetMinutes,
    )
    const localDate = formatLocal(dayStart, utcOffsetMinutes).slice(0, 10)
    const { start, end } = localDayRange(localDate, utcOffsetMinutes)
    const events = BODIES.flatMap((body) =>
      engine.findEvents(body, camera, start, end).map((e) => ({
        body: e.body,
        kind: e.kind,
        time: e.time,
        azimuth: e.azimuth,
      })),
    ).sort((a, b) => a.time.getTime() - b.time.getTime())
    out.push({ localDate, events })
  }
  return out
}
