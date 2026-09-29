/**
 * Angle helpers shared by all geometry code.
 *
 * Conventions:
 * - Azimuth is measured in degrees clockwise from true north (0 = N, 90 = E).
 * - "Positive" azimuth differences mean clockwise, i.e. to the right when
 *   looking down on the map / facing the reference direction.
 * - All functions are pure and never mutate their inputs.
 */
import type { HorizontalDirection } from '../types'
import { deg, rad, toDegrees, toRadians } from '../units'
import type { Degrees } from '../units'

/**
 * Normalizes an azimuth to the half-open range [0, 360).
 *
 * Handles negatives, multiples of 360, very large magnitudes and -0.
 * Guards against the floating-point edge where a tiny negative input
 * (e.g. -1e-14) plus 360 rounds to exactly 360: that case returns 0.
 */
export function normalizeAzimuth(a: Degrees): Degrees {
  let r = a % 360
  if (r < 0) r += 360
  // r may now be exactly 360 (rounding) or -0; both collapse to 0.
  if (r >= 360 || r === 0) return deg(0)
  return deg(r)
}

/**
 * Normalizes an angle to the signed range (-180, 180].
 *
 * Boundary convention: exactly 180 and exactly -180 both map to +180
 * (the lower bound is open, the upper bound closed).
 */
export function normalizeSigned(a: Degrees): Degrees {
  const n = normalizeAzimuth(a)
  return n > 180 ? deg(n - 360) : n
}

/**
 * Signed shortest azimuth difference `to - from`, in (-180, 180].
 *
 * Positive means `to` lies clockwise (to the right) of `from`.
 * Examples: 359 -> 1 = +2; 1 -> 359 = -2.
 * At exactly 180 degrees apart the result is +180 (see normalizeSigned).
 */
export function azimuthDifference(from: Degrees, to: Degrees): Degrees {
  return normalizeSigned(deg(to - from))
}

/**
 * Absolute shortest azimuth difference, in [0, 180].
 * Wrap-aware: 359 vs 1 = 2, not 358.
 */
export function absAzimuthDifference(a: Degrees, b: Degrees): Degrees {
  return deg(Math.abs(azimuthDifference(a, b)))
}

/**
 * Great-circle angular separation between two horizontal directions on the
 * celestial sphere, in [0, 180] degrees.
 *
 * Uses the Vincenty (atan2) form of the spherical distance formula, which
 * stays accurate for tiny separations (unlike acos of a dot product, which
 * loses precision below ~0.01 degrees) and near the antipode.
 */
export function angularSeparation(
  a: HorizontalDirection,
  b: HorizontalDirection,
): Degrees {
  const phi1 = toRadians(a.altitude)
  const phi2 = toRadians(b.altitude)
  const dLambda = toRadians(deg(b.azimuth - a.azimuth))

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const sinPhi2 = Math.sin(phi2)
  const cosPhi2 = Math.cos(phi2)
  const sinD = Math.sin(dLambda)
  const cosD = Math.cos(dLambda)

  const x = cosPhi2 * sinD
  const y = cosPhi1 * sinPhi2 - sinPhi1 * cosPhi2 * cosD
  const num = Math.hypot(x, y)
  const den = sinPhi1 * sinPhi2 + cosPhi1 * cosPhi2 * cosD

  return toDegrees(rad(Math.atan2(num, den)))
}

/** Clamps `value` into the closed interval [min, max]. Requires min <= max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Apparent angular diameter of a sphere/disc of the given physical diameter
 * seen from the given distance: 2 * atan(d / (2 * D)). Both arguments must be
 * in the same unit (metres by convention).
 */
export function angularDiameter(
  physicalDiameterMeters: number,
  distanceMeters: number,
): Degrees {
  return toDegrees(
    rad(2 * Math.atan(physicalDiameterMeters / (2 * distanceMeters))),
  )
}

/**
 * Whether `az` lies within the clockwise range from `start` to `end`
 * (inclusive at both ends). The range may wrap through north:
 * start 350, end 10 contains 0 and 5 but not 180.
 *
 * If start equals end (after normalization) the range is the single
 * direction; a full circle cannot be expressed with this signature.
 */
export function isAzimuthWithinRange(
  az: Degrees,
  start: Degrees,
  end: Degrees,
): boolean {
  const span = normalizeAzimuth(deg(end - start))
  const offset = normalizeAzimuth(deg(az - start))
  return offset <= span
}
