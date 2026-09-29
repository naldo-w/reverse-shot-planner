import { useEffect, useMemo, useState } from 'react'
import { createCelestialEngine } from '../../core/astronomy'
import type { CelestialEngine } from '../../core/astronomy'
import type { HorizonSample } from '../../core/types'
import { computeSimulation, type SimCore, type SimInput } from './simulation'
import { loadBuildingSet, loadSampler, rayLeavesGrid, REFRACTION_K, ridgesAround, viewArcPoints } from './terrainService'
import type { BuildingSet } from './terrainService'
import { BuildingSurfaceSampler } from '../../core/terrain/composite'
import { rayVisibility } from '../../core/terrain/horizon'
import type { RidgeLine } from '../../core/terrain/ridges'
import type { ElevationSampler } from '../../core/terrain/types'
import { deg, m } from '../../core/units'

let engineSingleton: CelestialEngine | null = null
export function getEngine(): CelestialEngine {
  engineSingleton ??= createCelestialEngine()
  return engineSingleton
}

export type TerrainStatus =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly resolution: number }
  | { readonly state: 'partial'; readonly resolution: number }
  | { readonly state: 'unavailable' }

export type BuildingsStatus =
  | { readonly state: 'off' }
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly count: number; readonly partial: boolean }
  | { readonly state: 'unavailable' }

export interface TargetVisibility {
  readonly visible: boolean
  /** True when terrain inside the excluded near-field radius would hide a target that is visible beyond it. */
  readonly nearFieldBlocks?: boolean
  /** Target apparent altitude minus the highest terrain in front of it, degrees. */
  readonly margin: number
  readonly obstructionDistance?: number
  /** What limits the view when hidden; 'building' only with the OSM buildings layer on. */
  readonly obstructionKind?: 'terrain' | 'building'
}

export interface ViewRidge {
  readonly points: readonly { azimuth: number; altitude: number }[]
  readonly meanDistance: number
}

export interface Simulation {
  readonly core: SimCore
  readonly horizon: { azimuth: number; altitude: number }[]
  /** Interior ridgelines (skyline excluded), nearest first. */
  readonly ridges: readonly ViewRidge[]
  /** Max apparent angle of the ignored near-field terrain per azimuth (same azimuths as `horizon`). */
  readonly nearField: { azimuth: number; altitude: number }[]
  readonly targetVisibility: TargetVisibility | null
  readonly flatHorizonAltitude: number
  readonly terrain: TerrainStatus
  readonly buildings: BuildingsStatus
}

export type SimParams = Omit<SimInput, 'engine'> & {
  /** Terrain within this horizontal distance of the camera is ignored, metres. */
  readonly nearFieldMeters: number
  /** Include OSM buildings (OpenFreeMap) in skyline, ridgelines and landmark visibility. */
  readonly useBuildings: boolean
}

const EARTH_R = 6_371_008.8

/**
 * Apparent sea-level horizon for an eye at height h above the sea, degrees
 * (negative). Geometric dip γ, lifted by terrestrial refraction k·γ/2 so it
 * matches the terrain horizon (core/terrain/horizon.ts) used elsewhere.
 */
function seaDip(h: number): number {
  const gamma = Math.acos(EARTH_R / (EARTH_R + Math.max(0, h))) * (180 / Math.PI)
  return -gamma * (1 - REFRACTION_K / 2)
}

const DEBOUNCE_MS = 300

/** Diagnostics readable from the browser console as `window.__rspHorizon`. */
function publishHorizonDiagnostics(d: Record<string, unknown>): void {
  try {
    ;(globalThis as unknown as { __rspHorizon?: unknown }).__rspHorizon = { ...d, at: new Date().toISOString() }
  } catch {
    /* ignore */
  }
}

/** Horizon terrain for the current camera/landmark: sampler cached, profile recomputed per pose (debounced). */
function useHorizon(core: SimCore, hfov: number, nearField: number, buildingsOn: boolean, cameraGround: number) {
  const camLat = core.camera.lat
  const camLon = core.camera.lon
  const camH = core.camera.height
  const tgtLat = core.targetPos.lat
  const tgtLon = core.targetPos.lon
  const dist = Math.round(core.target.distance)
  // Coarse view key so slider ticks do not reload tiles: azimuth to 5 deg, FOV to 5 deg buckets.
  const az5 = (((Math.round(core.pose.azimuth / 5) * 5) % 360) + 360) % 360
  const fovBucket = Math.ceil(hfov / 5) * 5
  const areaKey = `${camLat.toFixed(5)},${camLon.toFixed(5)}|${tgtLat.toFixed(5)},${tgtLon.toFixed(5)}|${az5}|${fovBucket}|${Math.round(dist / 1000)}`
  const [loaded, setLoaded] = useState<{ key: string; sampler: ElevationSampler | null } | null>(null)
  const [profile, setProfile] = useState<{ key: string; samples: HorizonSample[]; nearSamples: HorizonSample[]; ridges: RidgeLine[]; partial: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      // Cover the whole view sector (rays reach target distance + 3 km), not just camera -> landmark.
      const arc = viewArcPoints({ lat: camLat, lon: camLon }, az5, fovBucket / 2 + 1 + 2.5, dist + 3000)
      void loadSampler({ lat: camLat, lon: camLon }, { lat: tgtLat, lon: tgtLon }, arc, `${az5}|${fovBucket}|${Math.round(dist / 1000)}`).then(
        (sampler) => {
          if (!cancelled) setLoaded({ key: areaKey, sampler })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [areaKey, camLat, camLon, tgtLat, tgtLon, az5, fovBucket, dist])

  const [bLoaded, setBLoaded] = useState<{ key: string; set: BuildingSet | null } | null>(null)
  useEffect(() => {
    if (!buildingsOn) return
    let cancelled = false
    const timer = setTimeout(() => {
      const arc = viewArcPoints({ lat: camLat, lon: camLon }, az5, fovBucket / 2 + 1 + 2.5, dist + 3000)
      void loadBuildingSet({ lat: camLat, lon: camLon }, { lat: tgtLat, lon: tgtLon }, arc, `${az5}|${fovBucket}|${Math.round(dist / 1000)}`).then(
        (set) => {
          if (!cancelled) setBLoaded({ key: areaKey, set })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [buildingsOn, areaKey, camLat, camLon, tgtLat, tgtLon, az5, fovBucket, dist])

  const terrainSampler = loaded && loaded.key === areaKey ? loaded.sampler : null
  const bset = buildingsOn && bLoaded && bLoaded.key === areaKey ? bLoaded.set : null
  const buildingsStatus: BuildingsStatus = !buildingsOn
    ? { state: 'off' }
    : bLoaded && bLoaded.key === areaKey
      ? bLoaded.set
        ? { state: 'ready', count: bLoaded.set.count, partial: bLoaded.set.partial }
        : { state: 'unavailable' }
      : { state: 'loading' }
  // Terrain + buildings surface; bare terrain inside the near-field radius is replaced by the camera's ground height.
  const sampler = useMemo(
    () =>
      terrainSampler && bset
        ? new BuildingSurfaceSampler(terrainSampler, bset.index, {
            camera: { lat: camLat, lon: camLon },
            cameraGround,
            nearFieldMeters: nearField,
          })
        : terrainSampler,
    [terrainSampler, bset, camLat, camLon, cameraGround, nearField],
  )
  // With buildings, the composite sampler applies the near-field rule itself (buildings stay in).
  const coreNearField = bset ? 0 : nearField
  const poseAz = Math.round(core.pose.azimuth * 20) / 20
  const profileKey = `${areaKey}|${poseAz}|${hfov.toFixed(3)}|${camH.toFixed(1)}|nf${nearField}|b${bset ? bset.count : -1}|g${cameraGround.toFixed(1)}`

  useEffect(() => {
    if (!sampler) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      try {
        const camera = { lat: deg(camLat), lon: deg(camLon), height: m(camH) }
        const { skyline: raw, nearField: nearSamples, ridges } = ridgesAround(camera, sampler, poseAz, hfov, dist, coreNearField)
        const maxD = dist + 3000
        const flat = seaDip(camH)
        let partial = false
        // A ray that left the loaded grid must not present grid-edge terrain as the horizon.
        const samples = raw.map((h) => {
          if (!rayLeavesGrid({ lat: camLat, lon: camLon }, sampler, h.azimuth, maxD)) return h
          partial = true
          return { azimuth: h.azimuth, altitude: deg(flat) }
        })
        publishHorizonDiagnostics({ state: 'ok', samples: samples.length, ridges: ridges.length, nearField, partial, resolution: sampler.resolutionMeters, buildings: bset ? bset.count : 0, buildingsOn })
        if (!cancelled) setProfile({ key: profileKey, samples, nearSamples, ridges, partial })
      } catch (err) {
        // Never fail silently: an empty skyline must be explainable.
        console.error('[horizon] profile computation failed', err)
        publishHorizonDiagnostics({ state: 'error', error: String(err) })
        if (!cancelled) setProfile({ key: profileKey, samples: [], nearSamples: [], ridges: [], partial: false })
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sampler, profileKey, camLat, camLon, camH, poseAz, hfov, dist, coreNearField, nearField, bset, buildingsOn])

  const res = terrainSampler ? Math.round(terrainSampler.resolutionMeters) : 0
  const status: TerrainStatus =
    loaded && loaded.key === areaKey
      ? terrainSampler
        ? profile?.partial
          ? { state: 'partial', resolution: res }
          : { state: 'ready', resolution: res }
        : { state: 'unavailable' }
      : { state: 'loading' }
  // Keep the last profile while a new one is computing so the skyline does not flicker.
  const samples = sampler && profile ? profile.samples : []
  const ridges = sampler && profile ? profile.ridges : []
  const nearSamples = sampler && profile ? profile.nearSamples : []
  return { status, samples, nearSamples, ridges, sampler, buildingsStatus, buildingsActive: bset !== null }
}

export function useSimulation(p: SimParams): Simulation {
  const engine = getEngine()
  const {
    landmark,
    spotCoordinate,
    groundHeight,
    eyeHeight,
    body,
    time,
    viewMode,
    multiDays,
    multiKind,
    aim,
    cameraDef,
    nearFieldMeters,
    useBuildings,
  } = p
  const timeMs = time.getTime()
  const core = useMemo(
    () =>
      computeSimulation({
        engine,
        landmark,
        spotCoordinate,
        groundHeight,
        eyeHeight,
        body,
        time: new Date(timeMs),
        viewMode,
        multiDays,
        multiKind,
        aim,
        cameraDef,
      }),
    [
      engine,
      landmark,
      spotCoordinate,
      groundHeight,
      eyeHeight,
      body,
      timeMs,
      viewMode,
      multiDays,
      multiKind,
      aim,
      cameraDef,
    ],
  )
  const { status, samples, nearSamples, ridges: ridgeLines, sampler, buildingsStatus, buildingsActive } = useHorizon(
    core,
    core.fov.horizontal,
    nearFieldMeters,
    useBuildings,
    groundHeight,
  )
  const ridges = useMemo(
    () =>
      ridgeLines.map((r) => ({
        points: r.points.map((p) => ({ azimuth: p.azimuth as number, altitude: p.altitude as number })),
        meanDistance: r.meanDistance as number,
      })),
    [ridgeLines],
  )
  const camLat = core.camera.lat
  const camLon = core.camera.lon
  const camH = core.camera.height
  const tgtLat = core.targetPos.lat
  const tgtLon = core.targetPos.lon
  const tgtH = core.targetPos.height
  const visNearField = buildingsActive ? 0 : nearFieldMeters
  const targetVisibility = useMemo((): TargetVisibility | null => {
    if (!sampler) return null
    try {
      const v = rayVisibility(
        { lat: deg(camLat), lon: deg(camLon), height: m(camH) },
        { lat: deg(tgtLat), lon: deg(tgtLon), height: m(tgtH) },
        sampler,
        REFRACTION_K,
        visNearField,
      )
      const nearFieldBlocks =
        v.visible &&
        visNearField > 0 &&
        !rayVisibility(
          { lat: deg(camLat), lon: deg(camLon), height: m(camH) },
          { lat: deg(tgtLat), lon: deg(tgtLon), height: m(tgtH) },
          sampler,
          REFRACTION_K,
        ).visible
      return {
        visible: v.visible,
        margin: v.angularMargin,
        ...(v.obstructionDistance === undefined ? {} : { obstructionDistance: v.obstructionDistance }),
        ...(v.obstructionKind === undefined ? {} : { obstructionKind: v.obstructionKind }),
        ...(nearFieldBlocks ? { nearFieldBlocks } : {}),
      }
    } catch (err) {
      console.error('[visibility] ray check failed', err)
      return null
    }
  }, [sampler, camLat, camLon, camH, tgtLat, tgtLon, tgtH, visNearField])
  const nearField = useMemo(
    () => nearSamples.map((n) => ({ azimuth: n.azimuth as number, altitude: n.altitude as number })),
    [nearSamples],
  )
  const horizon = useMemo(
    () => samples.map((s) => ({ azimuth: s.azimuth as number, altitude: s.altitude as number })),
    [samples],
  )
  return {
    core,
    horizon,
    ridges,
    nearField,
    targetVisibility,
    flatHorizonAltitude: seaDip(core.camera.height),
    terrain: status,
    buildings: buildingsStatus,
  }
}
