/**
 * Terrain horizon profiles and point-to-point terrain visibility.
 *
 * All heights (camera, target, DEM) must share one vertical datum
 * (TECHNICAL_NOTES §3). Terrain points are converted to the camera's ENU frame
 * so Earth curvature is exact; terrestrial refraction is added as k*d/(2R).
 * This is a DEM horizon, not a photographic skyline (TECHNICAL_NOTES §5).
 */

import { LocalFrame } from '../coordinates/enu'
import { normalizeAzimuth } from '../geometry/angles'
import { offsetCoordinate } from '../geometry/geodesy'
import type { GeodeticPosition, HorizonProfile, HorizonSample } from '../types'
import { MEAN_EARTH_RADIUS } from '../wgs84'
import { deg, m } from '../units'
import type { ElevationSampler, HorizonOptions } from './types'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const START_DISTANCE = 30
const TARGET_EXCLUSION = 50

export function rayStep(distance: number, resolution: number): number {
  return Math.max(resolution / 2, distance * 0.002)
}

/** Refraction lift of an object at horizontal distance d, degrees. */
export function refractionDeg(k: number, d: number): number {
  return ((k * d) / (2 * MEAN_EARTH_RADIUS)) * DEG
}

/** Sea-level horizon (geometric dip plus refraction at the horizon distance), degrees. */
export function seaHorizonAltitude(h: number, k: number): number {
  const height = Math.max(0, h)
  const gamma = Math.acos(MEAN_EARTH_RADIUS / (MEAN_EARTH_RADIUS + height))
  return -gamma * DEG + refractionDeg(k, gamma * MEAN_EARTH_RADIUS)
}

/**
 * March one ray outward from the camera and report the apparent altitude
 * (Earth curvature via the ENU frame, plus refraction k*d/2R) and horizontal
 * distance of each terrain sample. Samples closer than `nearField` go to
 * `visitNear` (if given) instead of `visit`. Stops at the first sample outside coverage.
 * Shared by the horizon profile and the ridgeline extraction.
 */
export function marchRay(
  frame: LocalFrame,
  origin: { readonly lat: number; readonly lon: number },
  sampler: ElevationSampler,
  sinAz: number,
  cosAz: number,
  maxDistance: number,
  k: number,
  visit: (altitudeDeg: number, horizontalDistance: number) => void,
  nearField = 0,
  visitNear?: (altitudeDeg: number, horizontalDistance: number) => void,
): void {
  const res = sampler.resolutionMeters
  for (let d = START_DISTANCE; d <= maxDistance; d += rayStep(d, res)) {
    const c = offsetCoordinate({ lat: deg(origin.lat), lon: deg(origin.lon) }, m(d * sinAz), m(d * cosAz))
    const elev = sampler.sample(c.lat, c.lon)
    if (elev === null) break
    const local = frame.toLocal({ lat: c.lat, lon: c.lon, height: m(elev) })
    const horiz = Math.hypot(local.east, local.north)
    if (horiz < 1) continue
    const alt = Math.atan2(local.up, horiz) * DEG + refractionDeg(k, horiz)
    if (horiz < nearField) visitNear?.(alt, horiz)
    else visit(alt, horiz)
  }
}

export function calculateHorizonProfile(
  camera: GeodeticPosition,
  sampler: ElevationSampler,
  opts: HorizonOptions,
): HorizonProfile {
  const frame = new LocalFrame(camera)
  const step = opts.azimuthStep
  if (!(step > 0)) throw new RangeError('azimuthStep must be positive')
  const span = opts.azimuthEnd - opts.azimuthStart
  const sweep = span >= 0 ? span : ((span % 360) + 360) % 360
  const count = Math.floor(sweep / step + 1e-9) + 1
  const k = opts.refractionK
  const seaLevel = seaHorizonAltitude(camera.height, k)
  const samples: HorizonSample[] = []

  for (let i = 0; i < count; i++) {
    const az = normalizeAzimuth(deg(opts.azimuthStart + i * step))
    const sinAz = Math.sin(az * RAD)
    const cosAz = Math.cos(az * RAD)
    let best = Number.NEGATIVE_INFINITY
    let bestDistance = 0

    marchRay(
      frame,
      camera,
      sampler,
      sinAz,
      cosAz,
      opts.maxDistance,
      k,
      (alt, horiz) => {
        if (alt > best) {
          best = alt
          bestDistance = horiz
        }
      },
      opts.nearFieldDistance ?? 0,
    )

    if (best === Number.NEGATIVE_INFINITY) {
      samples.push({ azimuth: az, altitude: deg(seaLevel) })
    } else {
      samples.push({ azimuth: az, altitude: deg(best), distance: m(bestDistance) })
    }
  }
  return { samples }
}

export interface RayVisibility {
  readonly visible: boolean
  readonly obstructionDistance?: number
  readonly obstructionElevation?: number
  /** Target apparent altitude minus max terrain apparent altitude before it, degrees. */
  readonly angularMargin: number
}

export function rayVisibility(
  camera: GeodeticPosition,
  target: GeodeticPosition,
  sampler: ElevationSampler,
  k: number,
  nearFieldDistance = 0,
): RayVisibility {
  const frame = new LocalFrame(camera)
  const t = frame.toLocal(target)
  const total = Math.hypot(t.east, t.north)
  const targetAlt = Math.atan2(t.up, total) * DEG + refractionDeg(k, total)
  const ux = total > 0 ? t.east / total : 0
  const uy = total > 0 ? t.north / total : 0
  const res = sampler.resolutionMeters
  const limit = total - TARGET_EXCLUSION

  let best = Number.NEGATIVE_INFINITY
  let bestDistance = 0
  let bestElev = 0
  for (let d = START_DISTANCE; d <= limit; d += rayStep(d, res)) {
    const c = offsetCoordinate({ lat: camera.lat, lon: camera.lon }, d * ux, d * uy)
    const elev = sampler.sample(c.lat, c.lon)
    if (elev === null) continue
    const local = frame.toLocal({ lat: c.lat, lon: c.lon, height: m(elev) })
    const horiz = Math.hypot(local.east, local.north)
    if (horiz < 1 || horiz < nearFieldDistance) continue
    const alt = Math.atan2(local.up, horiz) * DEG + refractionDeg(k, horiz)
    if (alt > best) {
      best = alt
      bestDistance = horiz
      bestElev = elev
    }
  }

  if (best === Number.NEGATIVE_INFINITY) {
    return { visible: true, angularMargin: targetAlt + 90 }
  }
  const margin = targetAlt - best
  if (margin > 0) return { visible: true, angularMargin: margin }
  return {
    visible: false,
    obstructionDistance: bestDistance,
    obstructionElevation: bestElev,
    angularMargin: margin,
  }
}
