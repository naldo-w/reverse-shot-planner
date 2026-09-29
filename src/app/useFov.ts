import { useMemo, useState } from 'react'
import { fieldOfView } from '../core/camera/fov'
import { angularDiameter } from '../core/geometry/angles'
import type { FieldOfView } from '../core/types'
import { toRadians, deg, mm } from '../core/units'
import { CAMERA_PRESETS, DEFAULT_FOCAL_LENGTH_MM } from '../data/cameraPresets'

export const FOCAL_MIN_MM = 8
export const FOCAL_MAX_MM = 2000

const MOON_DIAMETER_M = 3474800
const MOON_MEAN_DISTANCE_M = 384400000

export interface FovResult {
  readonly fov: FieldOfView
  /** Moon width as a percentage of the frame width (rectilinear projection). */
  readonly moonPercent: number
}

export function computeFov(presetId: string, focalMm: number): FovResult | null {
  if (!Number.isFinite(focalMm) || focalMm < FOCAL_MIN_MM || focalMm > FOCAL_MAX_MM) return null
  const preset = CAMERA_PRESETS.find((p) => p.id === presetId) ?? CAMERA_PRESETS[0]
  if (!preset) return null
  const fov = fieldOfView({ ...preset.camera, focalLength: mm(focalMm) })
  const moon = angularDiameter(MOON_DIAMETER_M, MOON_MEAN_DISTANCE_M)
  const frac =
    Math.tan(toRadians(deg(moon / 2))) / Math.tan(toRadians(deg(fov.horizontal / 2)))
  return { fov, moonPercent: frac * 100 }
}

export function useFov() {
  const [presetId, setPresetId] = useState(CAMERA_PRESETS[0]?.id ?? '')
  const [focalText, setFocalText] = useState(String(DEFAULT_FOCAL_LENGTH_MM))
  const result = useMemo(() => computeFov(presetId, Number(focalText)), [presetId, focalText])
  return { presetId, setPresetId, focalText, setFocalText, result }
}
