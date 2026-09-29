/**
 * CelestialEngine backed by astronomy-engine 2.1.19 (MIT, Don Cross).
 * This is the ONLY file allowed to import the library; no library types leak.
 *
 * Conventions (see ../types.ts):
 *  - getPosition: topocentric, of-date, aberration-corrected, NO refraction
 *    (geometric altitude).
 *  - findEvents: library SearchRiseSet already means "upper limb touches the
 *    horizon with 34' standard refraction". Its horizon dip and atmospheric
 *    density are derived from observer height, which would deviate from the
 *    contract's SEA-LEVEL horizon for elevated observers, so the search is
 *    run with the observer's height set to 0 (parallax effect of that is
 *    < 1 arcsec). Terrain horizons are the visibility engine's concern.
 */
import * as Astronomy from 'astronomy-engine'
import type { CelestialBody } from '../../types'
import { deg, type Degrees } from '../../units'
import {
  BODY_RADIUS_KM,
  type CelestialEngine,
  type CelestialEvent,
  type CelestialSample,
  type MoonPhase,
  type Observer,
  type RiseSetKind,
} from '../types'

const MS_PER_DAY = 86_400_000
const RAD_TO_DEG = 180 / Math.PI

const BODIES: Readonly<Record<CelestialBody, Astronomy.Body>> = {
  sun: Astronomy.Body.Sun,
  moon: Astronomy.Body.Moon,
}

function toLibObserver(o: Observer, height: number): Astronomy.Observer {
  return new Astronomy.Observer(o.lat, o.lon, height)
}

export class AstronomyEngineEngine implements CelestialEngine {
  readonly id = 'astronomy-engine'
  readonly label = 'Astronomy Engine 2.1'

  getPosition(body: CelestialBody, time: Date, observer: Observer): CelestialSample {
    const libBody = BODIES[body]
    const obs = toLibObserver(observer, observer.height)
    const t = new Astronomy.AstroTime(time)
    const equ = Astronomy.Equator(libBody, t, obs, true, true)
    // No refraction argument: geometric (airless) altitude.
    const hor = Astronomy.Horizon(t, obs, equ.ra, equ.dec)
    const distanceKm = equ.dist * Astronomy.KM_PER_AU
    return {
      body,
      azimuth: deg(hor.azimuth),
      altitude: deg(hor.altitude),
      distanceKm,
      angularDiameter: deg(2 * Math.atan(BODY_RADIUS_KM[body] / distanceKm) * RAD_TO_DEG),
    }
  }

  findEvents(body: CelestialBody, observer: Observer, start: Date, end: Date): CelestialEvent[] {
    const endMs = end.getTime()
    const startMs = start.getTime()
    if (!(endMs > startMs)) return []
    const libBody = BODIES[body]
    // Sea-level horizon per contract (see file header).
    const seaObs = toLibObserver(observer, 0)
    const out: CelestialEvent[] = []

    const kinds: readonly [RiseSetKind, number][] = [
      ['rise', +1],
      ['set', -1],
    ]
    for (const [kind, direction] of kinds) {
      // The library searches strictly after its start; back off 1 ms so an
      // event exactly at `start` is included.
      let cursorMs = startMs - 1
      for (;;) {
        const limitDays = (endMs - cursorMs) / MS_PER_DAY
        if (limitDays <= 0) break
        const found = Astronomy.SearchRiseSet(libBody, seaObs, direction, new Date(cursorMs), limitDays)
        if (!found) break
        const ms = found.date.getTime()
        if (ms >= endMs) break
        if (ms >= startMs) {
          const time = new Date(ms)
          out.push({ body, kind, time, azimuth: this.getPosition(body, time, observer).azimuth as Degrees })
        }
        cursorMs = ms + 1000
      }
    }
    return out.sort((a, b) => a.time.getTime() - b.time.getTime())
  }

  getMoonPhase(time: Date): MoonPhase {
    const t = new Astronomy.AstroTime(time)
    const lon = Astronomy.MoonPhase(t)
    return {
      phase: lon / 360,
      illumination: Astronomy.Illumination(Astronomy.Body.Moon, t).phase_fraction,
      waxing: lon < 180,
    }
  }
}
