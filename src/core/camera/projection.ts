/**
 * Gnomonic (rectilinear) projection for the composition preview.
 *
 * Camera frame (right-handed, expressed in local East/North/Up):
 *   forward = optical axis, right = +x on sensor, up = +y on sensor.
 * Roll rotates the camera about its optical axis; positive roll tilts the
 * camera's right side upward (counter-clockwise as seen through the viewfinder),
 * so scene content appears to rotate clockwise. Roll 0 = level.
 */
import type { CameraDefinition, HorizontalDirection } from '../types'
import { deg, rad, toDegrees, toRadians, type Degrees } from '../units'

export interface CameraPose {
  readonly azimuth: Degrees
  readonly altitude: Degrees
  readonly roll?: Degrees
}

type Vec3 = readonly [number, number, number]

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const normalizeAzimuth = (azimuth: number): Degrees => deg(((azimuth % 360) + 360) % 360)

/** Unit vector (east, north, up) for a horizontal direction. */
function toVector(dir: HorizontalDirection): Vec3 {
  const az = toRadians(dir.azimuth)
  const alt = toRadians(dir.altitude)
  const c = Math.cos(alt)
  return [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)]
}

function fromVector(v: Vec3): HorizontalDirection {
  const len = Math.hypot(v[0], v[1], v[2])
  const altitude = toDegrees(rad(Math.asin(Math.max(-1, Math.min(1, v[2] / len)))))
  const azimuth = normalizeAzimuth(toDegrees(rad(Math.atan2(v[0], v[1]))))
  return { azimuth, altitude }
}

interface CameraBasis {
  readonly right: Vec3
  readonly up: Vec3
  readonly forward: Vec3
}

function cameraBasis(pose: CameraPose): CameraBasis {
  const az = toRadians(normalizeAzimuth(pose.azimuth))
  const alt = toRadians(pose.altitude)
  const roll = toRadians(pose.roll ?? deg(0))
  const sa = Math.sin(az)
  const ca = Math.cos(az)
  const sl = Math.sin(alt)
  const cl = Math.cos(alt)
  const forward: Vec3 = [cl * sa, cl * ca, sl]
  const right0: Vec3 = [ca, -sa, 0]
  const up0: Vec3 = [-sl * sa, -sl * ca, cl]
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  return {
    forward,
    right: [
      cr * right0[0] + sr * up0[0],
      cr * right0[1] + sr * up0[1],
      cr * right0[2] + sr * up0[2],
    ],
    up: [
      -sr * right0[0] + cr * up0[0],
      -sr * right0[1] + cr * up0[1],
      -sr * right0[2] + cr * up0[2],
    ],
  }
}

/**
 * Project a sky direction onto the sensor. x,y are normalized: (0,0) centre,
 * x in [-1,1] spans sensor width (+right), y in [-1,1] spans height (+up).
 * Directions at or behind the image plane return inFront=false; their x,y are
 * the (mirrored) extension of the plane and should not be drawn.
 */
export function projectToSensor(
  dir: HorizontalDirection,
  pose: CameraPose,
  camera: CameraDefinition,
): { x: number; y: number; inFront: boolean } {
  const basis = cameraBasis(pose)
  const v = toVector(dir)
  const zc = dot(v, basis.forward)
  const inFront = zc > 0
  const z = Math.abs(zc) < 1e-12 ? 1e-12 : zc
  const f = camera.focalLength
  return {
    x: (dot(v, basis.right) / z) * ((2 * f) / camera.sensorWidth),
    y: (dot(v, basis.up) / z) * ((2 * f) / camera.sensorHeight),
    inFront,
  }
}

/** Inverse of {@link projectToSensor}: the sky direction seen at normalized sensor point (x, y). */
export function sensorToDirection(
  x: number,
  y: number,
  pose: CameraPose,
  camera: CameraDefinition,
): HorizontalDirection {
  const basis = cameraBasis(pose)
  const f = camera.focalLength
  const a = (x * camera.sensorWidth) / (2 * f)
  const b = (y * camera.sensorHeight) / (2 * f)
  return fromVector([
    a * basis.right[0] + b * basis.up[0] + basis.forward[0],
    a * basis.right[1] + b * basis.up[1] + basis.forward[1],
    a * basis.right[2] + b * basis.up[2] + basis.forward[2],
  ])
}

/** True if the direction lands within the sensor rectangle (edges inclusive). */
export function isInFrame(
  dir: HorizontalDirection,
  pose: CameraPose,
  camera: CameraDefinition,
): boolean {
  const p = projectToSensor(dir, pose, camera)
  const eps = 1e-12
  return p.inFront && Math.abs(p.x) <= 1 + eps && Math.abs(p.y) <= 1 + eps
}
