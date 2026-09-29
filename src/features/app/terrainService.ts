/**
 * Terrain access for the UI: single-point elevation lookups and a cached
 * sampler covering camera → landmark. Providers stay behind the core
 * `TerrainProvider` interface; the horizon maths lives in core/terrain.
 */

import type { Bounds, GeodeticPosition, HorizonSample } from '../../core/types'
import { calculateRidgelines, type RidgeLine } from '../../core/terrain/ridges'
import { MAX_TILES, tilesForBounds } from '../../core/terrain/tiles'
import type { ElevationSampler, TerrainProvider } from '../../core/terrain/types'
import { offsetCoordinate } from '../../core/geometry/geodesy'
import { deg, m } from '../../core/units'
import { TerrariumProvider } from '../../providers/terrain/terrariumProvider'

let provider: TerrainProvider | null = null

export function terrainProvider(): TerrainProvider {
  provider ??= new TerrariumProvider()
  return provider
}

const elevationCache = new Map<string, Promise<number | null>>()

export function elevationAt(lat: number, lon: number): Promise<number | null> {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`
  let p = elevationCache.get(key)
  if (!p) {
    p = terrainProvider()
      .getElevation(deg(lat), deg(lon))
      .catch(() => null)
    elevationCache.set(key, p)
    // Do not cache failures for the whole session.
    void p.then((v) => {
      if (v === null) elevationCache.delete(key)
    })
  }
  return p
}

const MARGIN_M = 2000
const ZOOMS = [13, 12, 11, 10, 9]

export function areaBounds(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Bounds {
  return areaBoundsOf([a, b])
}

/** Bounding box (plus margin) of several points. */
export function areaBoundsOf(points: readonly { lat: number; lon: number }[]): Bounds {
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const dLat = MARGIN_M / 111_320
  const dLon = MARGIN_M / (111_320 * Math.max(0.2, Math.cos((((north + south) / 2) * Math.PI) / 180)))
  return {
    north: deg(north + dLat),
    south: deg(south - dLat),
    east: deg(east + dLon),
    west: deg(west - dLon),
  }
}

/** Highest zoom ≤ 13 (~17 m at Hong Kong) whose tile count stays within MAX_TILES, or null. */
export function chooseZoom(bounds: Bounds): number | null {
  for (const z of ZOOMS) {
    try {
      if (tilesForBounds(bounds, z).length <= MAX_TILES) return z
    } catch {
      /* tilesForBounds throws RangeError beyond MAX_TILES: try a coarser zoom */
    }
  }
  return null
}

const samplerCache = new Map<string, Promise<ElevationSampler | null>>()

export function loadSampler(
  camera: { lat: number; lon: number },
  target: { lat: number; lon: number },
  extra: readonly { lat: number; lon: number }[] = [],
  extraKey = '',
): Promise<ElevationSampler | null> {
  const key = `${camera.lat.toFixed(5)},${camera.lon.toFixed(5)}|${target.lat.toFixed(5)},${target.lon.toFixed(5)}|${extraKey}`
  const hit = samplerCache.get(key)
  if (hit) return hit
  const bounds = areaBoundsOf([camera, target, ...extra])
  const zoom = chooseZoom(bounds)
  const p: Promise<ElevationSampler | null> =
    zoom === null
      ? Promise.resolve(null)
      : terrainProvider()
          .loadArea(bounds, zoom)
          .catch(() => null)
  samplerCache.set(key, p)
  void p.then((v) => {
    if (v === null) samplerCache.delete(key)
  })
  while (samplerCache.size > 6) {
    const oldest = samplerCache.keys().next().value
    if (oldest === undefined) break
    samplerCache.delete(oldest)
  }
  return p
}

export const HORIZON_STEP_DEG = 0.05
export const HORIZON_MAX_RAYS = 900
export const REFRACTION_K = 0.13
/** Default radius around the camera whose terrain is ignored (DEM cannot resolve buildings/podiums), metres. */
export const DEFAULT_NEAR_FIELD_M = 200

export interface ViewRidges {
  readonly skyline: HorizonSample[]
  readonly nearField: HorizonSample[]
  readonly ridges: RidgeLine[]
}

/** Skyline plus interior ridgelines for the azimuth sector visible from `poseAzimuth`. */
export function ridgesAround(
  camera: GeodeticPosition,
  sampler: ElevationSampler,
  poseAzimuth: number,
  hfov: number,
  targetDistance: number,
  nearFieldDistance = 0,
): ViewRidges {
  const half = hfov / 2 + 1
  const span = half * 2
  const step = Math.max(HORIZON_STEP_DEG, span / HORIZON_MAX_RAYS)
  const start = (((poseAzimuth - half) % 360) + 360) % 360
  const result = calculateRidgelines(camera, sampler, {
    azimuthStart: deg(start),
    azimuthEnd: deg(start + span),
    azimuthStep: deg(step),
    maxDistance: m(targetDistance + 3000),
    refractionK: REFRACTION_K,
    nearFieldDistance: m(nearFieldDistance),
  })
  return {
    skyline: [...result.skyline.samples],
    nearField: [...result.nearField.samples],
    ridges: result.ridges.filter((r) => !r.isSkyline),
  }
}

/** Points on the far arc of the view sector (camera + azimuth range at `distance`), for area loading. */
export function viewArcPoints(
  camera: { lat: number; lon: number },
  azimuthCentre: number,
  halfSpan: number,
  distance: number,
): { lat: number; lon: number }[] {
  const n = Math.max(2, Math.ceil((halfSpan * 2) / 10))
  const out: { lat: number; lon: number }[] = []
  for (let i = 0; i <= n; i++) {
    const az = azimuthCentre - halfSpan + (2 * halfSpan * i) / n
    const r = (az * Math.PI) / 180
    const c = offsetCoordinate(
      { lat: deg(camera.lat), lon: deg(camera.lon) },
      m(distance * Math.sin(r)),
      m(distance * Math.cos(r)),
    )
    out.push({ lat: c.lat, lon: c.lon })
  }
  return out
}

/** True if the ray at `azimuth` reaches `distance` outside the loaded grid (its horizon is not real terrain). */
export function rayLeavesGrid(
  camera: { lat: number; lon: number },
  sampler: ElevationSampler,
  azimuth: number,
  distance: number,
): boolean {
  const r = (azimuth * Math.PI) / 180
  const c = offsetCoordinate(
    { lat: deg(camera.lat), lon: deg(camera.lon) },
    m(distance * Math.sin(r)),
    m(distance * Math.cos(r)),
  )
  return sampler.sample(c.lat, c.lon) === null
}
