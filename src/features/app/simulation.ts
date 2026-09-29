/**
 * Pure simulation maths for the planner view (no React). Everything the
 * SimulationView needs except terrain, which is loaded asynchronously.
 */

import { refract } from '../../core/astronomy'
import type { CelestialEngine } from '../../core/astronomy'
import { fieldOfView } from '../../core/camera/fov'
import {
  cameraPosition,
  dailyEvents,
  dayTrack,
  landmarkOutline,
  multiDayTrack,
  targetDirection,
  targetPosition,
  toLocalParts,
} from '../../core/planner'
import type { Landmark, TrackPoint } from '../../core/planner/types'
import type {
  CameraDefinition,
  CelestialBody,
  Coordinate,
  FieldOfView,
  GeodeticPosition,
  HorizontalDirection,
} from '../../core/types'
import { deg, m, type Degrees } from '../../core/units'
import { fmtDate, pad2 } from './format'
import type { AimMode, MultiKind, ViewMode } from './state'
import { REFRACTION_K } from './terrainService'

export interface SimInput {
  readonly engine: CelestialEngine
  readonly landmark: Landmark
  readonly spotCoordinate: Coordinate
  readonly groundHeight: number
  readonly eyeHeight: number
  readonly body: CelestialBody
  readonly time: Date
  readonly viewMode: ViewMode
  readonly multiDays: number
  readonly multiKind: MultiKind
  readonly aim: AimMode
  readonly cameraDef: CameraDefinition
}

export interface BodyView {
  readonly kind: CelestialBody
  readonly azimuth: number
  /** Apparent (refracted) altitude. */
  readonly altitude: number
  readonly geometricAltitude: number
  readonly diameter: number
  readonly illumination?: number
  readonly waxing?: boolean
}

export interface SimTrack {
  readonly id: string
  readonly points: { azimuth: number; altitude: number; label?: string }[]
  readonly style: 'day' | 'multi'
}

export interface SimGhost {
  readonly azimuth: number
  readonly altitude: number
  readonly diameter: number
  readonly label?: string
}

export type TargetInfo = ReturnType<typeof targetDirection>

export interface SimCore {
  readonly camera: GeodeticPosition
  readonly targetPos: GeodeticPosition
  readonly target: TargetInfo
  readonly pose: { azimuth: Degrees; altitude: Degrees }
  readonly bodyView: BodyView
  readonly tracks: SimTrack[]
  readonly ghosts: SimGhost[]
  readonly outline: HorizontalDirection[][]
  readonly fov: FieldOfView
  readonly localDate: string
}

export function bodyView(
  engine: CelestialEngine,
  body: CelestialBody,
  time: Date,
  camera: GeodeticPosition,
): BodyView {
  const s = engine.getPosition(body, time, camera)
  const base = {
    kind: body,
    azimuth: s.azimuth,
    altitude: refract(s.altitude),
    geometricAltitude: s.altitude,
    diameter: s.angularDiameter,
  }
  if (body === 'moon') {
    const ph = engine.getMoonPhase(time)
    return { ...base, illumination: ph.illumination, waxing: ph.waxing }
  }
  return base
}

const toPoint = (p: TrackPoint) => ({ azimuth: p.azimuth as number, altitude: p.apparentAltitude as number })

const MAX_GHOSTS = 10

export function computeSimulation(input: SimInput): SimCore {
  const { engine, landmark, body, time, viewMode, aim, cameraDef } = input
  const off = landmark.utcOffsetMinutes
  const camera = cameraPosition(input.spotCoordinate, m(input.groundHeight), m(input.eyeHeight))
  const targetPos = targetPosition(landmark)
  const target = targetDirection(camera, targetPos, REFRACTION_K)
  const bv = bodyView(engine, body, time, camera)
  const pose =
    aim === 'body'
      ? { azimuth: deg(bv.azimuth), altitude: deg(bv.altitude) }
      : { azimuth: deg(target.azimuth), altitude: deg(target.apparentAltitude) }
  const parts = toLocalParts(time, off)
  const localDate = fmtDate(time, off)

  const tracks: SimTrack[] = []
  const ghosts: SimGhost[] = []

  if (viewMode === 'day') {
    const pts = dayTrack(engine, body, camera, localDate, off, 5)
    tracks.push({ id: 'day', points: pts.map(toPoint), style: 'day' })
    for (const p of pts) {
      const lp = toLocalParts(p.time, off)
      if (lp.mi !== 0 || p.apparentAltitude < -1) continue
      const d = engine.getPosition(body, p.time, camera).angularDiameter
      ghosts.push({
        azimuth: p.azimuth,
        altitude: p.apparentAltitude,
        diameter: d,
        label: `${pad2(lp.h)}:00`,
      })
    }
  } else if (viewMode === 'multi') {
    const days = Math.max(2, Math.min(60, Math.round(input.multiDays)))
    let pts: { time: Date; azimuth: number; altitude: number }[]
    if (input.multiKind === 'clock') {
      pts = multiDayTrack(engine, body, camera, localDate, days, parts.h * 60 + parts.mi, off).map(
        (p) => ({ time: p.time, azimuth: p.azimuth, altitude: p.apparentAltitude }),
      )
    } else {
      const kind = input.multiKind === 'rise' ? 'rise' : 'set'
      pts = []
      for (const day of dailyEvents(engine, camera, localDate, days, off)) {
        for (const ev of day.events) {
          if (ev.body !== body || ev.kind !== kind) continue
          const s = engine.getPosition(body, ev.time, camera)
          pts.push({ time: ev.time, azimuth: ev.azimuth, altitude: refract(s.altitude) })
        }
      }
    }
    tracks.push({
      id: 'multi',
      points: pts.map((p) => ({ azimuth: p.azimuth, altitude: p.altitude })),
      style: 'multi',
    })
    const every = Math.max(1, Math.ceil(pts.length / MAX_GHOSTS))
    pts.forEach((p, i) => {
      if (i % every !== 0 && i !== pts.length - 1) return
      const lp = toLocalParts(p.time, off)
      ghosts.push({
        azimuth: p.azimuth,
        altitude: p.altitude,
        diameter: engine.getPosition(body, p.time, camera).angularDiameter,
        label: `${pad2(lp.mo)}-${pad2(lp.d)}`,
      })
    })
  }

  return {
    camera,
    targetPos,
    target,
    pose,
    bodyView: bv,
    tracks,
    ghosts,
    outline: landmarkOutline(camera, landmark, REFRACTION_K),
    fov: fieldOfView(cameraDef),
    localDate,
  }
}

