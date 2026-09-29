/**
 * WGS84 reference ellipsoid (NIMA TR8350.2). Single source of truth for every
 * geodetic computation in the app.
 */

const A = 6378137
const F = 1 / 298.257223563
const E2 = F * (2 - F)

export const WGS84 = {
  /** Semi-major axis, metres. */
  a: A,
  /** Flattening. */
  f: F,
  /** Semi-minor axis, metres. */
  b: A * (1 - F),
  /** First eccentricity squared. */
  e2: E2,
  /** Second eccentricity squared. */
  ep2: E2 / (1 - E2),
} as const

/** IUGG mean Earth radius R1, metres. Used for spherical approximations only. */
export const MEAN_EARTH_RADIUS = 6371008.8
