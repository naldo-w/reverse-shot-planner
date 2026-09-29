import type { CameraDefinition } from '../core/types'
import { mm } from '../core/units'

/** Data only: the camera engine never depends on these presets. */
export interface CameraPreset {
  readonly id: string
  readonly label: string
  readonly camera: CameraDefinition
}

export const DEFAULT_FOCAL_LENGTH_MM = mm(400)

const preset = (id: string, label: string, w: number, h: number): CameraPreset => ({
  id,
  label,
  camera: { sensorWidth: mm(w), sensorHeight: mm(h), focalLength: DEFAULT_FOCAL_LENGTH_MM },
})

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  preset('full-frame', 'Full frame (36 × 24)', 36, 24),
  // 35.9 x 23.9 mm: verify against manufacturer spec
  preset('sony-a7c-ii', 'Sony A7C II (35.9 × 23.9)', 35.9, 23.9),
  preset('aps-c-sony', 'APS-C Sony (23.5 × 15.6)', 23.5, 15.6),
  preset('mft', 'Micro Four Thirds (17.3 × 13)', 17.3, 13.0),
  preset('medium-format', 'Medium format (44 × 33)', 44, 33),
]
