/**
 * Astronomy contract. Every engine (SunCalc, astronomy-engine, …) implements
 * `CelestialEngine`; nothing outside `core/astronomy/engines/` may import an
 * astronomy library.
 *
 * Deviation from the original spec sketch (getSunPosition/getMoonPosition/…):
 * the interface is parameterised by body so the search engine can treat
 * Sun and Moon uniformly. Convenience wrappers live in `index.ts`.
 */

import type { CelestialBody, GeodeticPosition } from '../types'
import type { Degrees } from '../units'

/** Observer on/above the WGS84 ellipsoid. Height matters for Moon parallax only marginally. */
export type Observer = GeodeticPosition

export interface CelestialSample {
  readonly body: CelestialBody
  /** Degrees, 0 = N clockwise. */
  readonly azimuth: Degrees
  /** GEOMETRIC topocentric altitude of the body centre (airless, parallax included). */
  readonly altitude: Degrees
  /** Distance observer → body centre, km. */
  readonly distanceKm: number
  /** Apparent angular diameter, degrees (from true physical radius and distance). */
  readonly angularDiameter: Degrees
}

export type RiseSetKind = 'rise' | 'set'

/**
 * Rise/set instant. Convention (matches fixtures and USNO): the body's UPPER
 * LIMB touches the sea-level astronomical horizon under standard refraction.
 * Terrain horizons are handled by the visibility engine, not here.
 */
export interface CelestialEvent {
  readonly body: CelestialBody
  readonly kind: RiseSetKind
  readonly time: Date
  /** Azimuth of the body centre at `time`. */
  readonly azimuth: Degrees
}

export interface MoonPhase {
  /** Illuminated fraction 0 (new) → 1 (full). */
  readonly illumination: number
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  readonly phase: number
  readonly waxing: boolean
}

export interface CelestialEngine {
  readonly id: string
  readonly label: string
  getPosition(body: CelestialBody, time: Date, observer: Observer): CelestialSample
  /**
   * All rise/set events with `start <= time < end`, sorted by time. Callers
   * pass explicit UTC instants; local-day handling is the caller's concern
   * (e.g. a Hong Kong day is [T-8h, T+16h) in UTC).
   */
  findEvents(body: CelestialBody, observer: Observer, start: Date, end: Date): CelestialEvent[]
  getMoonPhase(time: Date): MoonPhase
}

/** Physical radii used for angular diameter, km (IAU). */
export const BODY_RADIUS_KM: Readonly<Record<CelestialBody, number>> = {
  sun: 695_700,
  moon: 1_737.4,
}
