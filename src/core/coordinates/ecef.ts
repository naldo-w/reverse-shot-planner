/**
 * Geodetic <-> ECEF conversion on the WGS84 ellipsoid.
 *
 * Heights are ELLIPSOIDAL. DEM heights are normally orthometric (above the
 * geoid, e.g. EGM2008); see the note in `enu.ts` on why mixing is acceptable
 * for look angles between nearby points.
 */

import type { EcefCoordinate, GeodeticPosition } from '../types'
import { deg, m, toDegrees, toRadians } from '../units'
import type { Degrees, Radians } from '../units'

import { WGS84 } from '../wgs84'

const WGS84_A = WGS84.a
const WGS84_B = WGS84.b
const WGS84_E2 = WGS84.e2
const WGS84_EP2 = WGS84.ep2

/** Geodetic (lat/lon degrees, ellipsoidal height) to ECEF metres. */
export function geodeticToEcef(p: GeodeticPosition): EcefCoordinate {
  const lat: Radians = toRadians(p.lat)
  const lon: Radians = toRadians(p.lon)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  const r = (n + p.height) * cosLat
  return {
    x: m(r * Math.cos(lon)),
    y: m(r * Math.sin(lon)),
    z: m((n * (1 - WGS84_E2) + p.height) * sinLat),
  }
}

/**
 * ECEF metres to geodetic. Bowring's parametric-latitude fixed-point iteration
 * (4 passes, sub-millimetre for any height from Earth's centre to well beyond
 * GEO). Height uses the pole-safe form h = p cos(phi) + z sin(phi) - a sqrt(1 - e2 sin2(phi)).
 * Longitude is in (-180, 180]. The centre returns lat 0, lon 0, h = -a.
 */
export function ecefToGeodetic(c: EcefCoordinate): GeodeticPosition {
  const x: number = c.x
  const y: number = c.y
  const z: number = c.z
  const p = Math.hypot(x, y)

  if (p === 0 && z === 0) {
    return { lat: deg(0), lon: deg(0), height: m(-WGS84_A) }
  }

  const lon: Degrees = p === 0 ? deg(0) : toDegrees(Math.atan2(y, x) as Radians)

  // Initial parametric latitude, then iterate.
  let beta = Math.atan2(z * WGS84_A, p * WGS84_B)
  let phi = 0
  for (let i = 0; i < 4; i++) {
    const sb = Math.sin(beta)
    const cb = Math.cos(beta)
    phi = Math.atan2(
      z + WGS84_EP2 * WGS84_B * sb * sb * sb,
      p - WGS84_E2 * WGS84_A * cb * cb * cb,
    )
    beta = Math.atan2((1 - WGS84.f) * Math.sin(phi), Math.cos(phi))
  }

  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const h = p * cosPhi + z * sinPhi - WGS84_A * Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi)

  return { lat: toDegrees(phi as Radians), lon, height: m(h) }
}
