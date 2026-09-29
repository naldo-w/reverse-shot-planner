/**
 * Planner geometry: positions of landmarks/cameras, terrestrial refraction and
 * apparent directions. Pure functions; no DOM.
 *
 * Height convention (see coordinates/enu.ts): all heights are consistent
 * orthometric heights, so the geoid undulation cancels between camera/target.
 */

import { lookAngle } from '../coordinates/enu'
import { destinationPoint } from '../geometry/geodesy'
import { MEAN_EARTH_RADIUS } from '../wgs84'
import type { Coordinate, GeodeticPosition, HorizontalDirection } from '../types'
import { deg, m, toDegrees, rad } from '../units'
import type { Degrees, Meters } from '../units'
import { DEFAULT_EYE_HEIGHT, DEFAULT_REFRACTION_K } from './types'
import type { Landmark } from './types'

/** Aim point of a landmark: its coordinate at `topHeight`. */
export function targetPosition(l: Landmark): GeodeticPosition {
  return { lat: l.coordinate.lat, lon: l.coordinate.lon, height: l.topHeight }
}

/** Camera lens position: ground height plus tripod/eye height. */
export function cameraPosition(
  c: Coordinate,
  groundHeight: number,
  eyeHeight: number = DEFAULT_EYE_HEIGHT,
): GeodeticPosition {
  return { lat: c.lat, lon: c.lon, height: m(groundHeight + eyeHeight) }
}

/**
 * Terrestrial refraction lifting a distant object: k·d/(2R) radians → degrees,
 * R = 6371008.8 m. Always ≥ 0 for k ≥ 0.
 */
export function terrestrialRefraction(distanceM: number, k: number = DEFAULT_REFRACTION_K): Degrees {
  return toDegrees(rad((k * distanceM) / (2 * MEAN_EARTH_RADIUS)))
}

export type TargetDirection = HorizontalDirection & {
  readonly apparentAltitude: Degrees
  readonly distance: Meters
}

/**
 * Direction of `target` from `camera`. `altitude` is geometric (includes Earth
 * curvature, no refraction); `apparentAltitude` adds terrestrial refraction.
 */
export function targetDirection(
  camera: GeodeticPosition,
  target: GeodeticPosition,
  k: number = DEFAULT_REFRACTION_K,
): TargetDirection {
  const la = lookAngle(camera, target)
  return {
    azimuth: la.azimuth,
    altitude: la.altitude,
    apparentAltitude: deg(la.altitude + terrestrialRefraction(la.range, k)),
    distance: la.range,
  }
}

function apparentDirection(camera: GeodeticPosition, p: GeodeticPosition, k: number): HorizontalDirection {
  const d = targetDirection(camera, p, k)
  return { azimuth: d.azimuth, altitude: d.apparentAltitude }
}

/**
 * Apparent-direction polylines of a landmark's man-made outline, for drawing
 * in the camera view. Each polyline is a list of {azimuth, altitude} (apparent
 * altitude). Azimuths are normalised to [0, 360); a renderer must unwrap
 * across north itself. Mountains return [] (the terrain model draws them).
 *
 * Cable-stayed bridge: pylon (deck → top, and water → deck), deck from far end
 * A (along spanBearing) through the pylon to far end B (opposite side), and 6
 * stay cables per side from the pylon (60–95 % of the way from deck to top)
 * to points spread along the deck.
 */
export function landmarkOutline(
  camera: GeodeticPosition,
  l: Landmark,
  k: number = DEFAULT_REFRACTION_K,
): HorizontalDirection[][] {
  const s = l.structure
  if (l.kind !== 'structure' || !s || s.kind !== 'cable-stayed-bridge') return []

  const at = (c: Coordinate, h: number): HorizontalDirection =>
    apparentDirection(camera, { lat: c.lat, lon: c.lon, height: m(h) }, k)

  const deckH: number = s.deckHeight
  const topH: number = l.topHeight
  const baseH: number = l.baseHeight
  const bearingA = s.spanBearing
  const bearingB = deg((s.spanBearing + 180) % 360)
  const [lenA, lenB] = s.spanLengthEachSide
  const endA = destinationPoint(l.coordinate, bearingA, lenA)
  const endB = destinationPoint(l.coordinate, bearingB, lenB)

  const lines: HorizontalDirection[][] = []
  lines.push([at(l.coordinate, deckH), at(l.coordinate, topH)])
  lines.push([at(l.coordinate, baseH), at(l.coordinate, deckH)])
  lines.push([at(endA, deckH), at(l.coordinate, deckH), at(endB, deckH)])

  const CABLES = 6
  for (const [bearing, len] of [
    [bearingA, lenA],
    [bearingB, lenB],
  ] as const) {
    for (let i = 0; i < CABLES; i++) {
      const frac = i / (CABLES - 1)
      const anchorH = deckH + (0.6 + 0.35 * frac) * (topH - deckH)
      // Higher anchors land further out along the deck.
      const deckPoint = destinationPoint(l.coordinate, bearing, m(len * (0.2 + 0.75 * frac)))
      lines.push([at(l.coordinate, anchorH), at(deckPoint, deckH)])
    }
  }
  return lines
}

