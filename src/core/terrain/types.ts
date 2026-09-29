/**
 * Terrain contract (spec §3–4). Providers load elevation into an in-memory,
 * synchronous sampler so heavy geometry (ray casting, horizon profiles) runs
 * without awaiting per sample.
 */

import type { Bounds, HorizonProfile } from '../types'
import type { Degrees, Meters } from '../units'

export interface TerrainMetadata {
  readonly provider: string
  readonly dataset: string
  /** Nominal ground resolution at the equator for the zoom used, metres. */
  readonly resolutionMeters: number
  readonly verticalDatum?: string
  readonly surfaceType: 'DTM' | 'DSM' | 'UNKNOWN'
  readonly license: string
  readonly attribution: string
  readonly updatedAt?: string
}

/** Synchronous elevation lookup over a loaded area. Metres above sea level; null outside coverage. */
export interface ElevationSampler {
  readonly bounds: Bounds
  readonly resolutionMeters: number
  sample(lat: Degrees, lon: Degrees): number | null
}

export interface TerrainProvider {
  getMetadata(): TerrainMetadata
  /** Single-point elevation (loads the covering tile). */
  getElevation(lat: Degrees, lon: Degrees): Promise<number | null>
  /** Load an area at a zoom level into a sampler. */
  loadArea(bounds: Bounds, zoom: number): Promise<ElevationSampler>
}

export interface HorizonOptions {
  readonly azimuthStart: Degrees
  readonly azimuthEnd: Degrees
  readonly azimuthStep: Degrees
  /** Max ray length, metres. */
  readonly maxDistance: Meters
  /** Terrestrial refraction coefficient (0 = geometric). */
  readonly refractionK: number
  /**
   * Terrain closer than this (horizontal distance, metres) is ignored: at ~30 m DEM
   * resolution, buildings/podiums near the camera are smoothed into false slopes.
   * Default 0.
   */
  readonly nearFieldDistance?: Meters
}

export type { HorizonProfile }
