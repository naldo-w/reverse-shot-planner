/**
 * Body tracks over time and fixed-offset local-time helpers.
 * Local time = UTC + a fixed offset (no DST database; landmarks carry their
 * own `utcOffsetMinutes`).
 */

import { refract } from '../astronomy'
import type { CelestialEngine, Observer } from '../astronomy'
import type { CelestialBody } from '../types'
import type { TrackPoint } from './types'

const MIN_MS = 60_000
const DAY_MS = 86_400_000

export interface LocalParts {
  readonly y: number
  readonly mo: number
  readonly d: number
  readonly h: number
  readonly mi: number
}

export function toLocalParts(date: Date, utcOffsetMinutes: number): LocalParts {
  const t = new Date(date.getTime() + utcOffsetMinutes * MIN_MS)
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes(),
  }
}

/** Overflowing parts (e.g. d = 32, h = 25) roll over like Date.UTC. */
export function fromLocalParts(parts: LocalParts, utcOffsetMinutes: number): Date {
  return new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi) - utcOffsetMinutes * MIN_MS)
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

export function formatLocal(date: Date, utcOffsetMinutes: number): string {
  const p = toLocalParts(date, utcOffsetMinutes)
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`
}

function parseLocalDate(localDate: string): { y: number; mo: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) throw new Error(`Invalid local date (expected YYYY-MM-DD): ${localDate}`)
  return { y: Number(match[1]), mo: Number(match[2]), d: Number(match[3]) }
}

/** [local 00:00, next local 00:00) as UTC instants. */
export function localDayRange(localDate: string, utcOffsetMinutes: number): { start: Date; end: Date } {
  const { y, mo, d } = parseLocalDate(localDate)
  const start = fromLocalParts({ y, mo, d, h: 0, mi: 0 }, utcOffsetMinutes)
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

/** Samples every `stepMinutes` from `start` to `end` inclusive. */
export function bodyTrack(
  engine: CelestialEngine,
  body: CelestialBody,
  camera: Observer,
  start: Date,
  end: Date,
  stepMinutes: number,
): TrackPoint[] {
  if (!(stepMinutes > 0)) throw new Error('stepMinutes must be > 0')
  const out: TrackPoint[] = []
  const step = stepMinutes * MIN_MS
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    const time = new Date(t)
    const s = engine.getPosition(body, time, camera)
    out.push({ time, azimuth: s.azimuth, altitude: s.altitude, apparentAltitude: refract(s.altitude) })
  }
  return out
}

/** Whole local day, [00:00, 24:00) — 288 points at the default 5 min step. */
export function dayTrack(
  engine: CelestialEngine,
  body: CelestialBody,
  camera: Observer,
  localDate: string,
  utcOffsetMinutes: number,
  stepMinutes = 5,
): TrackPoint[] {
  const { start, end } = localDayRange(localDate, utcOffsetMinutes)
  return bodyTrack(engine, body, camera, start, new Date(end.getTime() - 1), stepMinutes)
}

/** One point per local day at the same local clock time (minutes after midnight). */
export function multiDayTrack(
  engine: CelestialEngine,
  body: CelestialBody,
  camera: Observer,
  startLocalDate: string,
  days: number,
  localMinutes: number,
  utcOffsetMinutes: number,
): TrackPoint[] {
  const { y, mo, d } = parseLocalDate(startLocalDate)
  const out: TrackPoint[] = []
  for (let i = 0; i < days; i++) {
    const time = fromLocalParts({ y, mo, d: d + i, h: 0, mi: localMinutes }, utcOffsetMinutes)
    const s = engine.getPosition(body, time, camera)
    out.push({ time, azimuth: s.azimuth, altitude: s.altitude, apparentAltitude: refract(s.altitude) })
  }
  return out
}
