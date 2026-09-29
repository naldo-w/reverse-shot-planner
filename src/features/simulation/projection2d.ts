/** Pure 2D helpers: sky directions -> SVG viewBox coordinates via the exact gnomonic sensor projection. */
import { projectToSensor, type CameraPose } from '../../core/camera/projection'
import type { CameraDefinition } from '../../core/types'
import { deg } from '../../core/units'

/** Plain-number direction (degrees); branded at the projection boundary. */
export interface SkyDir {
  readonly azimuth: number
  readonly altitude: number
}

export interface ViewPoint {
  readonly x: number
  readonly y: number
}

/** Map a direction to viewBox coords (origin top-left, y down). Returns null when behind the camera. */
export function toViewBox(
  dir: SkyDir,
  pose: CameraPose,
  camera: CameraDefinition,
  viewW: number,
  viewH: number,
): ViewPoint | null {
  const p = projectToSensor({ azimuth: deg(dir.azimuth), altitude: deg(dir.altitude) }, pose, camera)
  if (!p.inFront) return null
  return { x: ((p.x + 1) / 2) * viewW, y: ((1 - p.y) / 2) * viewH }
}

/**
 * Project a polyline into runs of viewBox points. Behind-camera points break the run.
 * Consecutive points that jump more than half the frame AND where an endpoint lies far outside
 * the frame (> 1 frame size from the edge, i.e. a grazing-angle blow-up) also break the run;
 * plain long on-frame segments stay connected. Runs with < 2 points are dropped.
 * Azimuth wrap-around (359 -> 1) is continuous because projection works on unit vectors.
 */
export function splitPolyline(
  points: readonly SkyDir[],
  pose: CameraPose,
  camera: CameraDefinition,
  viewW: number,
  viewH: number,
): ViewPoint[][] {
  const runs: ViewPoint[][] = []
  let cur: ViewPoint[] = []
  const flush = (): void => {
    if (cur.length >= 2) runs.push(cur)
    cur = []
  }
  const far = (p: ViewPoint): boolean =>
    p.x < -viewW || p.x > 2 * viewW || p.y < -viewH || p.y > 2 * viewH
  for (const dir of points) {
    const p = toViewBox(dir, pose, camera, viewW, viewH)
    if (!p) {
      flush()
      continue
    }
    const prev = cur[cur.length - 1]
    if (
      prev &&
      (Math.abs(p.x - prev.x) > viewW / 2 || Math.abs(p.y - prev.y) > viewH / 2) &&
      (far(p) || far(prev))
    ) {
      flush()
    }
    cur.push(p)
  }
  flush()
  return runs
}
