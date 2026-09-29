import type { CameraDefinition, FieldOfView } from '../types'
import { mm, toDegrees, type Degrees, type Millimeters, type Radians } from '../units'

/**
 * Angle of view of a rectilinear lens for one sensor dimension:
 * FOV = 2 * atan(dim / (2 * f)).
 *
 * Assumes the lens is focused at infinity. Focus breathing / close-focus
 * extension (effective focal length changes) and lens distortion are ignored.
 */
const fovRadians = (dim: Millimeters, focalLength: Millimeters): Radians =>
  (2 * Math.atan(dim / (2 * focalLength))) as Radians

export function fieldOfView(camera: CameraDefinition): FieldOfView {
  const { sensorWidth, sensorHeight, focalLength } = camera
  const diagonal = Math.hypot(sensorWidth, sensorHeight) as Millimeters
  return {
    horizontal: toDegrees(fovRadians(sensorWidth, focalLength)),
    vertical: toDegrees(fovRadians(sensorHeight, focalLength)),
    diagonal: toDegrees(fovRadians(diagonal, focalLength)),
  }
}

/** Sensor width / height. */
export function aspectRatio(camera: CameraDefinition): number {
  return camera.sensorWidth / camera.sensorHeight
}

/** Largest centered crop of the sensor with the given aspect (width / height). Focal length is unchanged. */
export function cropSensor(camera: CameraDefinition, aspect: number): CameraDefinition {
  if (!(aspect > 0) || !Number.isFinite(aspect)) {
    throw new RangeError('aspect must be a positive finite number')
  }
  if (aspect >= aspectRatio(camera)) {
    return { ...camera, sensorHeight: mm(camera.sensorWidth / aspect) }
  }
  return { ...camera, sensorWidth: mm(camera.sensorHeight * aspect) }
}

/** Inverse of the FOV formula: focal length giving `fov` across `sensorDim`. */
export function focalLengthForFov(sensorDim: Millimeters, fov: Degrees): Millimeters {
  const half = (fov * Math.PI) / 360
  return mm(sensorDim / (2 * Math.tan(half)))
}

