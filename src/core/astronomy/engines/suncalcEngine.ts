/**
 * SunCalc 2.0 adapter. The ONLY file allowed to import `suncalc`.
 *
 * Notes:
 * - SunCalc reports APPARENT altitude using its own Meeus 16.4 refraction
 *   (`astroRefraction`, h clamped to >= 0). We invert that exact formula so
 *   `altitude` is GEOMETRIC, as the CelestialEngine contract requires.
 * - Observer height has NO effect on SunCalc positions (they are geocentric
 *   with a simple Moon parallax term at the sea-level ellipsoid). Height is
 *   only forwarded to `getTimes` (horizon dip) for Sun rise/set.
 * - Sun distance is not provided by SunCalc; a low-order solar-anomaly series
 *   is used (accurate to ~1e-4 relative).
 * - SunCalc's rise/set functions work per UTC calendar day, so findEvents
 *   queries every UTC day overlapping the window and filters afterwards.
 */

import * as SunCalc from 'suncalc'
import type { CelestialBody } from '../../types'
import type { Degrees } from '../../units'
import { deg } from '../../units'
import type { CelestialEngine, CelestialEvent, CelestialSample, MoonPhase, Observer } from '../types'
import { BODY_RADIUS_KM } from '../types'

const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const AU_KM = 149_597_870.7
const J1970 = 2_440_588
const J2000 = 2_451_545
/** Earth radius used inside SunCalc's Moon parallax, km. */
const SUNCALC_EARTH_RADIUS_KM = 6378.14
const DEDUPE_MS = 60_000

/** SunCalc's refraction (radians in, radians out), reproduced exactly from index.js. */
export function suncalcRefractionRad(hRad: number): number {
  const h = hRad < 0 ? 0 : hRad
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179))
}

/**
 * Invert SunCalc's apparent altitude (degrees) to geometric altitude (degrees).
 * SunCalc computes app = h + R(max(h, 0)).
 */
export function suncalcApparentToGeometric(apparentDeg: number): Degrees {
  const app = apparentDeg * RAD
  const r0 = suncalcRefractionRad(0)
  if (app < r0) return deg(apparentDeg - r0 / RAD)
  // Newton on f(h) = h + R(h) - app, h >= 0. Start from fixed-point guess.
  let h = Math.max(0, app - suncalcRefractionRad(app))
  for (let i = 0; i < 50; i++) {
    const f = h + suncalcRefractionRad(h) - app
    const eps = 1e-7
    const df = (h + eps + suncalcRefractionRad(h + eps) - (h - eps + suncalcRefractionRad(Math.max(0, h - eps)))) / (2 * eps)
    const next = Math.max(0, h - f / df)
    const done = Math.abs(next - h) < 1e-12
    h = next
    if (done) break
  }
  return deg(h / RAD)
}

/** Sun distance, km, from the mean anomaly (SunCalc-style days since J2000). */
function sunDistanceKm(time: Date): number {
  const d = time.valueOf() / DAY_MS - 0.5 + J1970 - J2000
  const M = (357.5291 + 0.98560028 * d) * RAD
  const rAu = 1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M)
  return rAu * AU_KM
}

function angularDiameterDeg(body: CelestialBody, distanceKm: number): Degrees {
  return deg((2 * Math.atan(BODY_RADIUS_KM[body] / distanceKm)) / RAD)
}

function utcDayStart(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS
}

export class SuncalcEngine implements CelestialEngine {
  readonly id = 'suncalc'
  readonly label = 'SunCalc 2.0'

  getPosition(body: CelestialBody, time: Date, observer: Observer): CelestialSample {
    if (body === 'sun') {
      const p = SunCalc.getPosition(time, observer.lat, observer.lon)
      const distanceKm = sunDistanceKm(time)
      return {
        body,
        azimuth: deg(p.azimuth),
        altitude: suncalcApparentToGeometric(p.altitude),
        distanceKm,
        angularDiameter: angularDiameterDeg(body, distanceKm),
      }
    }
    const p = SunCalc.getMoonPosition(time, observer.lat, observer.lon)
    const altitude = suncalcApparentToGeometric(p.altitude)
    // SunCalc's distance is geocentric; convert to observer -> Moon centre.
    // Geocentric altitude = topocentric + parallax (SunCalc's own parallax model).
    const hGeo = altitude * RAD + Math.asin((SUNCALC_EARTH_RADIUS_KM / p.distance) * Math.cos(altitude * RAD))
    const distanceKm = Math.sqrt(
      p.distance ** 2 + SUNCALC_EARTH_RADIUS_KM ** 2 - 2 * p.distance * SUNCALC_EARTH_RADIUS_KM * Math.sin(hGeo),
    )
    return {
      body,
      azimuth: deg(p.azimuth),
      altitude,
      distanceKm,
      angularDiameter: angularDiameterDeg(body, distanceKm),
    }
  }

  findEvents(body: CelestialBody, observer: Observer, start: Date, end: Date): CelestialEvent[] {
    const s = start.getTime()
    const e = end.getTime()
    const raw: CelestialEvent[] = []
    const push = (kind: 'rise' | 'set', t: Date | null | undefined): void => {
      if (!t) return
      const ms = t.getTime()
      if (Number.isNaN(ms) || ms < s || ms >= e) return
      raw.push({ body, kind, time: t, azimuth: this.getPosition(body, t, observer).azimuth })
    }

    for (let day = utcDayStart(s - DAY_MS); day <= e + DAY_MS; day += DAY_MS) {
      if (body === 'sun') {
        // Anchor at noon UTC of the day (getTimes anchors by UTC day itself).
        const t = SunCalc.getTimes(new Date(day + DAY_MS / 2), observer.lat, observer.lon, observer.height)
        push('rise', t.sunrise)
        push('set', t.sunset)
      } else {
        const t = SunCalc.getMoonTimes(new Date(day), observer.lat, observer.lon)
        push('rise', t.rise)
        push('set', t.set)
      }
    }

    raw.sort((a, b) => a.time.getTime() - b.time.getTime())
    const out: CelestialEvent[] = []
    for (const ev of raw) {
      const dup = out.some((o) => o.kind === ev.kind && Math.abs(o.time.getTime() - ev.time.getTime()) < DEDUPE_MS)
      if (!dup) out.push(ev)
    }
    return out
  }

  getMoonPhase(time: Date): MoonPhase {
    const m = SunCalc.getMoonIllumination(time)
    return { illumination: m.fraction, phase: m.phase, waxing: m.waxing }
  }
}
