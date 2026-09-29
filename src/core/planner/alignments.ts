/**
 * Alignment search: instants when the Sun/Moon azimuth equals the (fixed)
 * target azimuth seen from the camera, filtered by vertical offset.
 */

import { refract } from '../astronomy'
import type { CelestialEngine } from '../astronomy'
import { destinationPoint } from '../geometry/geodesy'
import { azimuthDifference } from '../geometry/angles'
import type { CelestialBody, Coordinate, GeodeticPosition } from '../types'
import { deg, m } from '../units'
import type { Degrees } from '../units'
import { DEFAULT_REFRACTION_K } from './types'
import type { Alignment, AlignmentQuery, Landmark } from './types'
import { targetDirection } from './geometry'
import { localDayRange } from './tracks'

const COARSE_STEP_MS = 10 * 60_000
const WRAP_GUARD_DEG = 20
const TOLERANCE_MS = 1000
const DEFAULT_MAX_VERTICAL = 3
const DEFAULT_MAX_BODY_ALT = 25
const MIN_BODY_ALT = -1

export function findAlignments(engine: CelestialEngine, q: AlignmentQuery): Alignment[] {
  const k = q.refractionK ?? DEFAULT_REFRACTION_K
  const maxV = q.maxVerticalOffset ?? DEFAULT_MAX_VERTICAL
  const maxAlt = q.maxBodyAltitude ?? DEFAULT_MAX_BODY_ALT
  const target = targetDirection(q.camera, q.target, k)
  const targetAz = target.azimuth
  const startMs = q.start.getTime()
  const endMs = q.end.getTime()
  const out: Alignment[] = []
  if (!(endMs > startMs)) return out

  const diffAt = (ms: number): number =>
    azimuthDifference(targetAz, engine.getPosition(q.body, new Date(ms), q.camera).azimuth)

  let t0 = startMs
  let d0 = diffAt(t0)
  while (t0 < endMs) {
    const t1 = Math.min(t0 + COARSE_STEP_MS, endMs)
    const d1 = diffAt(t1)
    const crossing = (d0 < 0 && d1 >= 0) || (d0 > 0 && d1 <= 0)
    if (crossing && Math.abs(d0) < WRAP_GUARD_DEG && Math.abs(d1) < WRAP_GUARD_DEG) {
      let lo = t0
      let hi = t1
      const negLo = d0 < 0
      while (hi - lo > TOLERANCE_MS) {
        const mid = Math.floor((lo + hi) / 2)
        if (diffAt(mid) < 0 === negLo) lo = mid
        else hi = mid
      }
      const tm = Math.floor((lo + hi) / 2)
      // Half-open [start, end): the final coarse sample at `end` may only refine to < end.
      if (tm < endMs) {
        const a = buildAlignment(engine, q, target, tm, k, maxAlt, maxV)
        if (a) out.push(a)
      }
    }
    t0 = t1
    d0 = d1
  }
  return out
}

function buildAlignment(
  engine: CelestialEngine,
  q: AlignmentQuery,
  target: ReturnType<typeof targetDirection>,
  ms: number,
  _k: number,
  maxAlt: number,
  maxV: number,
): Alignment | null {
  const time = new Date(ms)
  const s = engine.getPosition(q.body, time, q.camera)
  const apparent = refract(s.altitude)
  if (apparent < MIN_BODY_ALT || apparent > maxAlt) return null
  const verticalOffset = deg(apparent - target.apparentAltitude)
  if (Math.abs(verticalOffset) > maxV) return null
  const later = engine.getPosition(q.body, new Date(ms + 30_000), q.camera)
  const alignment: Alignment = {
    body: q.body,
    time,
    body_: { azimuth: s.azimuth, altitude: s.altitude, apparentAltitude: apparent },
    target: {
      azimuth: target.azimuth,
      altitude: target.altitude,
      apparentAltitude: target.apparentAltitude,
      distance: target.distance,
    },
    verticalOffset,
    bodyDiameter: s.angularDiameter,
    direction: later.altitude >= s.altitude ? 'rising' : 'setting',
    ...(q.body === 'moon' ? { illumination: engine.getMoonPhase(time).illumination } : {}),
  }
  return alignment
}

export interface AlignmentLine {
  readonly kind: 'rise' | 'set'
  readonly time: Date
  readonly azimuth: Degrees
  readonly from: Coordinate
  readonly to: Coordinate
}

/**
 * Rise/set events of `body` at the landmark's position on a local day, each
 * with the camera-side ground line: from the landmark toward azimuth + 180°
 * for `lengthMeters`. A camera on that line sees the body rise/set behind the
 * landmark.
 *
 * APPROXIMATE: rise/set is at the sea-level astronomical horizon and the line
 * ignores the body's altitude when it clears a raised horizon (a summit is
 * higher than the horizon, so the true alignment azimuth is slightly larger in
 * altitude terms and shifts by up to ~1° for tall landmarks). Use findAlignments
 * for exact results at a chosen camera.
 */
export function alignmentLines(
  engine: CelestialEngine,
  body: CelestialBody,
  landmark: Landmark,
  localDate: string,
  utcOffsetMinutes: number,
  lengthMeters = 15000,
): AlignmentLine[] {
  const { start, end } = localDayRange(localDate, utcOffsetMinutes)
  const observer: GeodeticPosition = {
    lat: landmark.coordinate.lat,
    lon: landmark.coordinate.lon,
    height: landmark.baseHeight,
  }
  return engine.findEvents(body, observer, start, end).map((e) => ({
    kind: e.kind,
    time: e.time,
    azimuth: e.azimuth,
    from: landmark.coordinate,
    to: destinationPoint(landmark.coordinate, deg((e.azimuth + 180) % 360), m(lengthMeters)),
  }))
}
