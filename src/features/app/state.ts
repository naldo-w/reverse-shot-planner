import { useMemo, useReducer } from 'react'
import { fromLocalParts, toLocalParts } from '../../core/planner'
import type { Landmark } from '../../core/planner/types'
import { DEFAULT_EYE_HEIGHT } from '../../core/planner/types'
import type { CameraDefinition, CelestialBody, Coordinate } from '../../core/types'
import { deg, m, mm } from '../../core/units'
import { CAMERA_PRESETS, DEFAULT_FOCAL_LENGTH_MM } from '../../data/cameraPresets'
import {
  PRESET_LANDMARKS,
  PRESET_SPOTS,
  type PresetLandmark,
  type PresetSpot,
} from '../../data/presets'

export type ViewMode = 'single' | 'day' | 'multi'
export type MultiKind = 'clock' | 'rise' | 'set'
export type ClickMode = 'camera' | 'landmark'
export type AimMode = 'target' | 'body'

export const CUSTOM_ID = 'custom'
export const DEFAULT_OFFSET_MINUTES = 480

export interface PlannerState {
  readonly landmarkId: string
  readonly customLandmark: { lat: number; lon: number; top: number; offsetHours: number }
  readonly spotId: string
  readonly customSpot: { lat: number; lon: number }
  /** Manual ground height override (m); null = preset / terrain lookup. */
  readonly groundOverride: number | null
  readonly eyeHeight: number
  readonly body: CelestialBody
  /** Selected instant (UTC ms). */
  readonly timeMs: number
  readonly viewMode: ViewMode
  readonly multiDays: number
  readonly multiKind: MultiKind
  readonly cameraPresetId: string
  readonly focalMm: number
  readonly aim: AimMode
  readonly clickMode: ClickMode
  /** Bumped when the map should re-frame camera + landmark (not on map clicks). */
  readonly focusSeq: number
}

export function presetLandmark(id: string): PresetLandmark | null {
  return PRESET_LANDMARKS.find((l) => l.id === id) ?? null
}

export function spotsFor(landmarkId: string): readonly PresetSpot[] {
  return PRESET_SPOTS.filter((s) => s.landmarkId === landmarkId)
}

export function initialState(now: Date = new Date()): PlannerState {
  const lm = PRESET_LANDMARKS[0]!
  const spot = spotsFor(lm.id)[0]!
  const parts = toLocalParts(now, lm.utcOffsetMinutes)
  return {
    landmarkId: lm.id,
    customLandmark: { lat: lm.coordinate.lat, lon: lm.coordinate.lon, top: lm.topHeight, offsetHours: 8 },
    spotId: spot.id,
    customSpot: { lat: spot.coordinate.lat, lon: spot.coordinate.lon },
    groundOverride: null,
    eyeHeight: DEFAULT_EYE_HEIGHT,
    body: 'sun',
    timeMs: fromLocalParts({ ...parts, h: 18, mi: 0 }, lm.utcOffsetMinutes).getTime(),
    viewMode: 'single',
    multiDays: 30,
    multiKind: 'clock',
    cameraPresetId: CAMERA_PRESETS[0]?.id ?? '',
    focalMm: DEFAULT_FOCAL_LENGTH_MM,
    aim: 'target',
    clickMode: 'camera',
    focusSeq: 0,
  }
}

type Action =
  | { type: 'patch'; patch: Partial<PlannerState> }
  | { type: 'selectLandmark'; id: string }
  | { type: 'selectSpot'; id: string }
  | { type: 'cameraPoint'; lat: number; lon: number }
  | { type: 'landmarkPoint'; lat: number; lon: number }
  | { type: 'landmarkTop'; lat: number; lon: number; top: number }
  | { type: 'focus' }
  | { type: 'apply'; spotId: string | null; body: CelestialBody; timeMs: number }

/** Currently selected spot coordinate (preset or custom). */
export function currentSpotCoordinate(s: PlannerState): { lat: number; lon: number } {
  const p = PRESET_SPOTS.find((x) => x.id === s.spotId)
  return s.spotId !== CUSTOM_ID && p ? p.coordinate : s.customSpot
}

function reducer(s: PlannerState, a: Action): PlannerState {
  switch (a.type) {
    case 'patch':
      return { ...s, ...a.patch }
    case 'selectLandmark': {
      if (a.id === s.landmarkId) return s
      const preset = presetLandmark(a.id)
      if (!preset) {
        const cur = presetLandmark(s.landmarkId)
        return {
          ...s,
          landmarkId: CUSTOM_ID,
          customLandmark: cur
            ? {
                lat: cur.coordinate.lat,
                lon: cur.coordinate.lon,
                top: cur.topHeight,
                offsetHours: cur.utcOffsetMinutes / 60,
              }
            : s.customLandmark,
          spotId: CUSTOM_ID,
          customSpot: currentSpotCoordinate(s),
          groundOverride: null,
          focusSeq: s.focusSeq + 1,
        }
      }
      const first = spotsFor(preset.id)[0]
      return {
        ...s,
        landmarkId: preset.id,
        spotId: first?.id ?? CUSTOM_ID,
        customSpot: currentSpotCoordinate(s),
        groundOverride: null,
        focusSeq: s.focusSeq + 1,
      }
    }
    case 'selectSpot': {
      if (a.id === s.spotId) return s
      const customSpot = currentSpotCoordinate(s)
      return { ...s, spotId: a.id, customSpot, groundOverride: null, focusSeq: s.focusSeq + 1 }
    }
    case 'cameraPoint':
      return { ...s, spotId: CUSTOM_ID, customSpot: { lat: a.lat, lon: a.lon }, groundOverride: null }
    case 'landmarkPoint': {
      const cur = presetLandmark(s.landmarkId)
      const base = cur
        ? { top: cur.topHeight, offsetHours: cur.utcOffsetMinutes / 60 }
        : { top: s.customLandmark.top, offsetHours: s.customLandmark.offsetHours }
      return {
        ...s,
        landmarkId: CUSTOM_ID,
        customLandmark: { lat: a.lat, lon: a.lon, ...base },
        // Keep the current camera as a custom point when the landmark stops being a preset.
        spotId: cur ? CUSTOM_ID : s.spotId,
        customSpot: cur ? currentSpotCoordinate(s) : s.customSpot,
      }
    }
    case 'landmarkTop': {
      if (s.landmarkId !== CUSTOM_ID) return s
      if (s.customLandmark.lat !== a.lat || s.customLandmark.lon !== a.lon) return s
      return { ...s, customLandmark: { ...s.customLandmark, top: a.top } }
    }
    case 'focus':
      return { ...s, focusSeq: s.focusSeq + 1 }
    case 'apply': {
      const spotChange = a.spotId !== null && a.spotId !== s.spotId
      return {
        ...s,
        spotId: a.spotId ?? s.spotId,
        customSpot: spotChange ? currentSpotCoordinate(s) : s.customSpot,
        groundOverride: spotChange ? null : s.groundOverride,
        body: a.body,
        timeMs: a.timeMs,
        viewMode: 'single',
        aim: 'target',
        focusSeq: s.focusSeq + 1,
      }
    }
  }
}

export interface PlannerActions {
  patch(p: Partial<PlannerState>): void
  selectLandmark(id: string): void
  selectSpot(id: string): void
  setCameraPoint(lat: number, lon: number): void
  setLandmarkPoint(lat: number, lon: number): void
  setLandmarkTop(lat: number, lon: number, top: number): void
  focus(): void
  apply(spotId: string | null, body: CelestialBody, time: Date): void
}

export function usePlanner(): { state: PlannerState; actions: PlannerActions } {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState())
  const actions = useMemo<PlannerActions>(
    () => ({
      patch: (patch) => dispatch({ type: 'patch', patch }),
      selectLandmark: (id) => dispatch({ type: 'selectLandmark', id }),
      selectSpot: (id) => dispatch({ type: 'selectSpot', id }),
      setCameraPoint: (lat, lon) => dispatch({ type: 'cameraPoint', lat, lon }),
      setLandmarkPoint: (lat, lon) => dispatch({ type: 'landmarkPoint', lat, lon }),
      setLandmarkTop: (lat, lon, top) => dispatch({ type: 'landmarkTop', lat, lon, top }),
      focus: () => dispatch({ type: 'focus' }),
      apply: (spotId, body, time) => dispatch({ type: 'apply', spotId, body, timeMs: time.getTime() }),
    }),
    [],
  )
  return { state, actions }
}

// ---------------------------------------------------------------- derived

export interface Derived {
  readonly landmark: Landmark
  readonly preset: PresetLandmark | null
  readonly spots: readonly PresetSpot[]
  readonly presetSpot: PresetSpot | null
  readonly spotCoordinate: Coordinate
  readonly offset: number
  readonly cameraDef: CameraDefinition
}

export function useDerived(s: PlannerState): Derived {
  const preset = presetLandmark(s.landmarkId)
  const { lat, lon, top, offsetHours } = s.customLandmark
  const landmark = useMemo<Landmark>(
    () =>
      preset ?? {
        id: CUSTOM_ID,
        name: { en: 'Custom landmark', zhTW: '自訂地標' },
        kind: 'mountain',
        coordinate: { lat: deg(lat), lon: deg(lon) },
        topHeight: m(top),
        baseHeight: m(0),
        utcOffsetMinutes: Math.round(offsetHours * 60),
        sources: [],
      },
    [preset, lat, lon, top, offsetHours],
  )
  const spots = useMemo(() => (preset ? spotsFor(preset.id) : []), [preset])
  const presetSpot = spots.find((x) => x.id === s.spotId) ?? null
  const spotLat = presetSpot ? presetSpot.coordinate.lat : s.customSpot.lat
  const spotLon = presetSpot ? presetSpot.coordinate.lon : s.customSpot.lon
  const spotCoordinate = useMemo<Coordinate>(
    () => ({ lat: deg(spotLat), lon: deg(spotLon) }),
    [spotLat, spotLon],
  )
  const camPreset = CAMERA_PRESETS.find((p) => p.id === s.cameraPresetId) ?? CAMERA_PRESETS[0]
  const sw = camPreset?.camera.sensorWidth ?? mm(36)
  const sh = camPreset?.camera.sensorHeight ?? mm(24)
  const cameraDef = useMemo<CameraDefinition>(
    () => ({ sensorWidth: sw, sensorHeight: sh, focalLength: mm(s.focalMm) }),
    [sw, sh, s.focalMm],
  )
  return {
    landmark,
    preset,
    spots,
    presetSpot,
    spotCoordinate,
    offset: landmark.utcOffsetMinutes,
    cameraDef,
  }
}
