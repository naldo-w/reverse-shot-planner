/**
 * Local East-North-Up (ENU) tangent frames and look angles.
 *
 * Working via ECEF makes Earth curvature automatic: a point 10 km away at the
 * same ellipsoidal height appears ~0.045 degrees BELOW the local horizontal.
 *
 * Height datums: heights here are ELLIPSOIDAL. DEM heights are orthometric
 * (above the geoid, e.g. EGM2008). For two points a few km apart the geoid
 * undulation N is nearly identical at both, so it cancels in the height
 * difference and callers may pass orthometric heights consistently for both
 * observer and target. Residual error is the undulation gradient (typically
 * < ~0.1 m per km, up to ~0.5 m/km in steep geoid regions), i.e. an angular
 * error of at most a few thousandths of a degree at 10 km. Do not mix datums
 * between observer and target.
 */

import type {
  EcefCoordinate,
  GeodeticPosition,
  HorizontalDirection,
  LocalCoordinate,
} from '../types'
import { deg, m, toDegrees, toRadians } from '../units'
import type { Meters, Radians } from '../units'
import { ecefToGeodetic, geodeticToEcef } from './ecef'

export type LookAngle = HorizontalDirection & { readonly range: Meters }

/** Rotate an ECEF delta into ENU given precomputed trig of the origin. */
function rotateToEnu(
  dx: number,
  dy: number,
  dz: number,
  sinLat: number,
  cosLat: number,
  sinLon: number,
  cosLon: number,
): LocalCoordinate {
  return {
    east: m(-sinLon * dx + cosLon * dy),
    north: m(-sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz),
    up: m(cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz),
  }
}

function rotateToEcef(
  e: number,
  n: number,
  u: number,
  origin: EcefCoordinate,
  sinLat: number,
  cosLat: number,
  sinLon: number,
  cosLon: number,
): EcefCoordinate {
  return {
    x: m(origin.x + -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u),
    y: m(origin.y + cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u),
    z: m(origin.z + cosLat * n + sinLat * u),
  }
}

/** ENU vector to azimuth ([0,360), clockwise from north), altitude and range. */
export function enuToHorizontal(v: LocalCoordinate): LookAngle {
  const e: number = v.east
  const n: number = v.north
  const u: number = v.up
  const horiz = Math.hypot(e, n)
  const range = Math.hypot(horiz, u)
  if (range === 0) {
    return { azimuth: deg(0), altitude: deg(0), range: m(0) }
  }
  let az = toDegrees(Math.atan2(e, n) as Radians) as number
  if (az < 0) az += 360
  if (az >= 360) az -= 360
  return {
    azimuth: deg(az),
    altitude: toDegrees(Math.atan2(u, horiz) as Radians),
    range: m(range),
  }
}

/** ECEF point to ENU relative to a geodetic origin. */
export function ecefToEnu(point: EcefCoordinate, origin: GeodeticPosition): LocalCoordinate {
  const o = geodeticToEcef(origin)
  const lat = toRadians(origin.lat)
  const lon = toRadians(origin.lon)
  return rotateToEnu(
    point.x - o.x,
    point.y - o.y,
    point.z - o.z,
    Math.sin(lat),
    Math.cos(lat),
    Math.sin(lon),
    Math.cos(lon),
  )
}

/** ENU offset relative to a geodetic origin back to ECEF. */
export function enuToEcef(local: LocalCoordinate, origin: GeodeticPosition): EcefCoordinate {
  const lat = toRadians(origin.lat)
  const lon = toRadians(origin.lon)
  return rotateToEcef(
    local.east,
    local.north,
    local.up,
    geodeticToEcef(origin),
    Math.sin(lat),
    Math.cos(lat),
    Math.sin(lon),
    Math.cos(lon),
  )
}

export function geodeticToEnu(point: GeodeticPosition, origin: GeodeticPosition): LocalCoordinate {
  return ecefToEnu(geodeticToEcef(point), origin)
}

export function enuToGeodetic(local: LocalCoordinate, origin: GeodeticPosition): GeodeticPosition {
  return ecefToGeodetic(enuToEcef(local, origin))
}

/**
 * Geometric (no atmospheric refraction) apparent direction of `target` as seen
 * from `observer`. Includes Earth curvature. Primary API for other engines.
 */
export function lookAngle(observer: GeodeticPosition, target: GeodeticPosition): LookAngle {
  return enuToHorizontal(geodeticToEnu(target, observer))
}

/**
 * Reusable local frame. Precomputes origin ECEF and trig so batched calls
 * (100k+) allocate only their return objects.
 */
export class LocalFrame {
  readonly origin: GeodeticPosition
  private readonly ox: number
  private readonly oy: number
  private readonly oz: number
  private readonly sinLat: number
  private readonly cosLat: number
  private readonly sinLon: number
  private readonly cosLon: number

  constructor(origin: GeodeticPosition) {
    this.origin = origin
    const o = geodeticToEcef(origin)
    this.ox = o.x
    this.oy = o.y
    this.oz = o.z
    const lat = toRadians(origin.lat)
    const lon = toRadians(origin.lon)
    this.sinLat = Math.sin(lat)
    this.cosLat = Math.cos(lat)
    this.sinLon = Math.sin(lon)
    this.cosLon = Math.cos(lon)
  }

  toLocal(p: GeodeticPosition): LocalCoordinate {
    const c = geodeticToEcef(p)
    return rotateToEnu(
      c.x - this.ox,
      c.y - this.oy,
      c.z - this.oz,
      this.sinLat,
      this.cosLat,
      this.sinLon,
      this.cosLon,
    )
  }

  toGeodetic(l: LocalCoordinate): GeodeticPosition {
    return ecefToGeodetic(
      rotateToEcef(
        l.east,
        l.north,
        l.up,
        { x: m(this.ox), y: m(this.oy), z: m(this.oz) },
        this.sinLat,
        this.cosLat,
        this.sinLon,
        this.cosLon,
      ),
    )
  }

  lookAt(p: GeodeticPosition): LookAngle {
    return enuToHorizontal(this.toLocal(p))
  }
}
