/**
 * Planner contract (location-first mode, spec §27): a fixed landmark and a
 * fixed camera position → when/where the Sun or Moon appears relative to it.
 * Pure types; no runtime dependencies.
 */

import type { CelestialBody, Coordinate, GeodeticPosition, HorizontalDirection } from '../types'
import type { Degrees, Meters } from '../units'

export interface LocalizedText {
  readonly en: string
  readonly zhTW: string
}

/** Schematic geometry for man-made structures (not in terrain models). */
export interface CableStayedBridgeGeometry {
  readonly kind: 'cable-stayed-bridge'
  /** Pylon top height above the deck/base reference, metres. */
  readonly pylonHeight: Meters
  /** Deck height above sea level, metres. */
  readonly deckHeight: Meters
  /** Bearing of the main span axis through the pylon, degrees. */
  readonly spanBearing: Degrees
  /** Deck length drawn on each side of the pylon along the span axis, metres. */
  readonly spanLengthEachSide: readonly [Meters, Meters]
}

export type StructureGeometry = CableStayedBridgeGeometry

export interface Landmark {
  readonly id: string
  readonly name: LocalizedText
  readonly kind: 'mountain' | 'structure'
  /** Aim point: summit or pylon top position. */
  readonly coordinate: Coordinate
  /** Aim-point height above sea level (orthometric), metres. */
  readonly topHeight: Meters
  /** Ground / water level at the landmark, metres above sea level. */
  readonly baseHeight: Meters
  readonly structure?: StructureGeometry
  /** Local civil time offset used for display and "local day" queries. */
  readonly utcOffsetMinutes: number
  readonly sources: readonly string[]
}

export interface ShootingSpot {
  readonly id: string
  readonly landmarkId: string
  readonly name: LocalizedText
  readonly coordinate: Coordinate
  /** Ground height above sea level if sourced; null = look up from terrain. */
  readonly groundHeight: Meters | null
  readonly note: LocalizedText
  readonly sources: readonly string[]
}

/** Camera eye height above ground, metres (tripod). */
export const DEFAULT_EYE_HEIGHT = 1.6 as Meters

/** Terrestrial refraction coefficient default (TECHNICAL_NOTES §6). */
export const DEFAULT_REFRACTION_K = 0.13

export interface PlannerTarget {
  readonly name: string
  readonly position: GeodeticPosition
}

// ------------------------------------------------------------------ Tracks

export interface TrackPoint {
  readonly time: Date
  readonly azimuth: Degrees
  /** Geometric altitude. */
  readonly altitude: Degrees
  /** Refracted (standard atmosphere) altitude — what the camera sees. */
  readonly apparentAltitude: Degrees
}

// -------------------------------------------------------------- Alignments

export interface AlignmentQuery {
  readonly camera: GeodeticPosition
  readonly target: GeodeticPosition
  readonly body: CelestialBody
  readonly start: Date
  readonly end: Date
  /** Keep crossings whose |apparent vertical offset| ≤ this, degrees. Default 3. */
  readonly maxVerticalOffset?: Degrees
  /** Ignore crossings with body apparent altitude above this, degrees. Default 25. */
  readonly maxBodyAltitude?: Degrees
  readonly refractionK?: number
}

/**
 * An instant when the body's azimuth equals the target's azimuth as seen
 * from the camera (azimuth crossing), with the vertical relationship.
 */
export interface Alignment {
  readonly body: CelestialBody
  readonly time: Date
  readonly body_: HorizontalDirection & { readonly apparentAltitude: Degrees }
  readonly target: HorizontalDirection & { readonly apparentAltitude: Degrees; readonly distance: Meters }
  /** Body apparent altitude − target apparent altitude. + = body above target. */
  readonly verticalOffset: Degrees
  /** Body angular diameter, degrees. */
  readonly bodyDiameter: Degrees
  /** Moon illuminated fraction 0..1 (Moon only). */
  readonly illumination?: number
  /** Body rising (altitude increasing) or setting at this instant. */
  readonly direction: 'rising' | 'setting'
}

// ---------------------------------------------------------- Rise/set table

export interface DailyEvents {
  /** Local calendar date YYYY-MM-DD in the landmark's offset. */
  readonly localDate: string
  readonly events: readonly {
    readonly body: CelestialBody
    readonly kind: 'rise' | 'set'
    readonly time: Date
    readonly azimuth: Degrees
  }[]
}
