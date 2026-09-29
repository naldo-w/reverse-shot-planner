/**
 * Atmospheric refraction.
 *
 * Policy (TECHNICAL_NOTES §1): every engine reports GEOMETRIC (airless)
 * topocentric altitude as `altitude`. Refraction is applied explicitly and
 * visibly through this module, never hidden inside an engine.
 *
 * Model: Bennett (1982) as used by Skyfield / USNO, scaled for temperature
 * and pressure. Zero above 89.9° and for altitudes more than 1° below the
 * horizon, matching the fixture generator (scripts/ephemeris).
 */

import type { Degrees } from '../units'
import { deg } from '../units'

export interface Atmosphere {
  readonly temperatureC: number
  readonly pressureMbar: number
}

/** Standard atmosphere used by fixtures and as the app default. */
export const STANDARD_ATMOSPHERE: Atmosphere = { temperatureC: 10, pressureMbar: 1010 }

const DEG2RAD = Math.PI / 180

/**
 * Refraction for an OBSERVED (apparent) altitude, degrees.
 */
export function refractionForApparent(apparent: Degrees, atm: Atmosphere = STANDARD_ATMOSPHERE): Degrees {
  if (apparent < -1 || apparent > 89.9) return deg(0)
  const r = 0.016667 / Math.tan((apparent + 7.31 / (apparent + 4.4)) * DEG2RAD)
  return deg(r * ((0.28 * atm.pressureMbar) / (atm.temperatureC + 273)))
}

/**
 * Geometric → apparent altitude. Fixed-point iteration (converges in a few
 * steps; tolerance 3e-5° like Skyfield).
 */
export function refract(geometric: Degrees, atm: Atmosphere = STANDARD_ATMOSPHERE): Degrees {
  let alt = geometric as number
  for (let i = 0; i < 50; i++) {
    const next = geometric + refractionForApparent(deg(alt), atm)
    if (Math.abs(next - alt) <= 3e-5) return deg(next)
    alt = next
  }
  return deg(alt)
}

/** Apparent → geometric altitude (exact inverse of the observed-altitude formula). */
export function unrefract(apparent: Degrees, atm: Atmosphere = STANDARD_ATMOSPHERE): Degrees {
  return deg(apparent - refractionForApparent(apparent, atm))
}
