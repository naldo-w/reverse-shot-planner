/**
 * Target-first "sector (fan) mode": from a landmark's top, find the ground
 * area a camera can stand on so that the Sun/Moon appears behind the landmark
 * on some day of a date range.
 *
 * Geometry. A camera at bearing b (landmark -> camera) and distance d sees the
 * landmark in direction (b + 180 deg, apparent altitude alpha(d)). The body is
 * "behind" it when its azimuth equals that direction AND its apparent
 * altitude equals alpha(d) + desiredOffset. Over a date range the azimuth
 * condition sweeps a fan of bearings out of the landmark; the altitude
 * condition then selects a band of distances (a higher body needs a closer
 * camera, because alpha(d) grows as the camera approaches).
 *
 * Algorithm
 *  (a) BODY TRACKS at the LANDMARK position. Parallax between the landmark and
 *      any camera within 30 km is at most 30 km / 384 400 km = 0.0045 deg
 *      (Moon; the Sun is 400x smaller), so one ephemeris serves every cell.
 *      The range is scanned every 16 min; blocks whose altitude lies within
 *      6 deg of the window [-1, maxBodyAltitude] deg are sampled every 2 min.
 *      Contiguous in-window samples form runs, split at altitude extrema so
 *      every run is purely rising or setting; runs are filtered by `event`.
 *      Each sample stores its direction as an ECEF unit vector.
 *  (b) CANDIDATE BEARINGS. A run covers an azimuth interval; bearing b can only
 *      match it if b + 180 lies inside (1 deg margin for meridian convergence).
 *      The union over runs is the fan; other bearings are never evaluated.
 *  (c) For each candidate bearing and log-spaced distance: camera coordinate
 *      = destinationPoint(target, b, d), ground = groundHeight() (skipped when
 *      null), lens = ground + eyeHeight, target direction from targetDirection()
 *      (apparent, terrestrial refraction).
 *  (d) The body direction from the camera is the landmark-frame vector
 *      re-expressed in the camera's ENU frame. This is NOT optional: the
 *      local vertical turns by d/R between the two places (0.18 deg at 20 km,
 *      the camera sees a body lying behind the landmark that much LOWER), and
 *      north converges. For each run the azimuth crossing (sign change of
 *      sin(bodyAz - targetAz), bisected on a monotone run) is interpolated
 *      linearly in time; error = (bodyApparentAlt - targetApparentAlt) -
 *      desiredOffset; the day with the smallest |error| wins the cell.
 *      Cells with |error| <= tolerance are returned. What is neglected is only
 *      parallax (< 0.0045 deg) and 2-min linear interpolation (< 0.001 deg).
 */

import { refract } from '../astronomy'
import type { CelestialEngine } from '../astronomy'
import { normalizeAzimuth } from '../geometry/angles'
import { destinationPoint } from '../geometry/geodesy'
import { targetDirection } from '../planner/geometry'
import { DEFAULT_REFRACTION_K } from '../planner/types'
import { MAX_TILES, tilesForBounds } from '../terrain/tiles'
import type { Bounds, CelestialBody, GeodeticPosition } from '../types'
import { deg, m } from '../units'
import type { Degrees, Meters } from '../units'

export interface SectorQuery {
  /** Landmark top (aim point). */
  readonly target: GeodeticPosition
  readonly body: CelestialBody
  /** Half-open range [start, end). */
  readonly start: Date
  readonly end: Date
  readonly event: 'rise' | 'set' | 'any'
  readonly minDistance: Meters
  readonly maxDistance: Meters
  /** Bearing grid step, degrees. Default 0.25. */
  readonly bearingStep?: Degrees
  /** Number of log-spaced distances. Default 40. */
  readonly distanceSteps?: number
  readonly eyeHeight: Meters
  /** Ground height above sea level at (lat, lon), or null when unknown (cell skipped). */
  readonly groundHeight: (lat: number, lon: number) => number | null
  /** Body centre apparent altitude minus target apparent altitude wanted. 0 = centred on the summit. */
  readonly desiredOffset: Degrees
  /** Keep cells with |error| <= tolerance, degrees. Default 0.5. */
  readonly tolerance?: Degrees
  readonly refractionK?: number
  /** Ignore body altitudes above this (apparent), degrees. Default 20. */
  readonly maxBodyAltitude?: Degrees
}

export interface SectorBest {
  readonly time: Date
  /** Signed, actual - desired, degrees. */
  readonly offsetError: Degrees
  readonly bodyAzimuth: Degrees
  readonly bodyApparentAltitude: Degrees
  readonly targetApparentAltitude: Degrees
  readonly direction: 'rising' | 'setting'
  readonly illumination?: number
}

export interface SectorCell {
  /** Landmark -> camera bearing at the cell centre, degrees. */
  readonly bearing: Degrees
  /** Distance of the cell centre, metres. */
  readonly distance: Meters
  readonly bearingHalfWidth: Degrees
  readonly distanceInner: Meters
  readonly distanceOuter: Meters
  readonly lat: Degrees
  readonly lon: Degrees
  readonly groundHeight: number
  readonly best: SectorBest
  /** Terrain line of sight camera -> target: true visible, false hidden, null not computed. */
  readonly visible: boolean | null
}

export const DEFAULT_BEARING_STEP = 0.25
export const DEFAULT_DISTANCE_STEPS = 40
export const DEFAULT_TOLERANCE = 0.5
export const DEFAULT_MAX_BODY_ALTITUDE = 20

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const COARSE_MS = 16 * 60_000
const FINE_MS = 2 * 60_000
const FINE_PER_BLOCK = COARSE_MS / FINE_MS
const MIN_APPARENT = -1
const HOT_PAD = 6
const WINDOW_PAD = 0.4
/** Azimuth margin when deciding which bearings a run can serve, degrees. */
const BAND_MARGIN = 1
/** Largest |apparent - geometric| altitude gap inside the search window, degrees. */
const MAX_REFRACTION_LIFT = 0.75
const NARROW_SPAN = 60

interface SectorTrack {
  readonly n: number
  readonly t: Float64Array
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly azMin: number
  readonly azMax: number
  readonly rising: boolean
  /** Monotone and narrow enough for bisection. */
  readonly narrow: boolean
}

export interface PreparedSector {
  readonly tracks: readonly SectorTrack[]
  /** Candidate bearings (grid multiples of the step), ascending. */
  readonly bearings: readonly number[]
  /** tracks serving each candidate bearing (parallel to `bearings`). */
  readonly cover: readonly (readonly number[])[]
  readonly step: number
}

interface RawSample {
  readonly t: number
  readonly az: number
  readonly alt: number
  readonly app: number
}

function unwrapStep(prev: number, next: number): number {
  let d = next - prev
  while (d > 180) d -= 360
  while (d <= -180) d += 360
  return d
}

function buildTracks(
  engine: CelestialEngine,
  q: SectorQuery,
  onProgress?: (fraction: number) => void,
): SectorTrack[] {
  const startMs = q.start.getTime()
  const endMs = q.end.getTime()
  if (!(endMs > startMs)) return []
  const observer: GeodeticPosition = { lat: q.target.lat, lon: q.target.lon, height: q.target.height }
  const maxAlt = q.maxBodyAltitude ?? DEFAULT_MAX_BODY_ALTITUDE
  const winLo = MIN_APPARENT - WINDOW_PAD
  const winHi = maxAlt + WINDOW_PAD
  const hotLo = MIN_APPARENT - HOT_PAD
  const hotHi = maxAlt + HOT_PAD

  const at = (ms: number): RawSample => {
    const s = engine.getPosition(q.body, new Date(ms), observer)
    return { t: ms, az: s.azimuth, alt: s.altitude, app: refract(s.altitude) }
  }

  const blocks = Math.ceil((endMs - startMs) / COARSE_MS)
  const samples: RawSample[] = []
  let cur = at(startMs)
  const tick = Math.max(1, Math.floor(blocks / 100))
  for (let j = 0; j < blocks; j++) {
    const t0 = startMs + j * COARSE_MS
    const nxt = at(t0 + COARSE_MS)
    const hot = (cur.app >= hotLo && cur.app <= hotHi) || (nxt.app >= hotLo && nxt.app <= hotHi)
    if (hot) {
      for (let k = 0; k < FINE_PER_BLOCK; k++) {
        const t = t0 + k * FINE_MS
        if (t >= endMs) break
        samples.push(k === 0 ? cur : at(t))
      }
    }
    cur = nxt
    if (onProgress && j % tick === 0) onProgress(j / blocks)
  }
  onProgress?.(1)

  const phi = observer.lat * RAD
  const lam = observer.lon * RAD
  const sinP = Math.sin(phi)
  const cosP = Math.cos(phi)
  const sinL = Math.sin(lam)
  const cosL = Math.cos(lam)

  const tracks: SectorTrack[] = []
  const flush = (run: RawSample[]): void => {
    if (run.length < 2) return
    const first = run[0]
    const last = run[run.length - 1]
    if (!first || !last) return
    const rising = last.alt > first.alt
    if (q.event === 'rise' && !rising) return
    if (q.event === 'set' && rising) return
    const n = run.length
    const t = new Float64Array(n)
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    const z = new Float64Array(n)
    let az = first.az
    let azMin = az
    let azMax = az
    let mono = true
    let sign = 0
    for (let i = 0; i < n; i++) {
      const s = run[i] as RawSample
      if (i > 0) {
        const d = unwrapStep((run[i - 1] as RawSample).az, s.az)
        az += d
        if (az < azMin) azMin = az
        if (az > azMax) azMax = az
        const sg = Math.sign(d)
        if (sg !== 0) {
          if (sign !== 0 && sg !== sign) mono = false
          sign = sg
        }
      }
      const a = s.az * RAD
      const h = s.alt * RAD
      const east = Math.cos(h) * Math.sin(a)
      const north = Math.cos(h) * Math.cos(a)
      const up = Math.sin(h)
      t[i] = s.t
      x[i] = -sinL * east - sinP * cosL * north + cosP * cosL * up
      y[i] = cosL * east - sinP * sinL * north + cosP * sinL * up
      z[i] = cosP * north + sinP * up
    }
    tracks.push({ n, t, x, y, z, azMin, azMax, rising, narrow: mono && azMax - azMin < NARROW_SPAN })
  }

  let run: RawSample[] = []
  let dir = 0
  for (const s of samples) {
    const prev = run[run.length - 1]
    const inWin = s.app >= winLo && s.app <= winHi
    if (!inWin || (prev && s.t - prev.t !== FINE_MS)) {
      flush(run)
      run = []
      dir = 0
      if (!inWin) continue
    }
    const p = run[run.length - 1]
    if (p) {
      const d = Math.sign(s.alt - p.alt)
      if (d !== 0 && dir !== 0 && d !== dir) {
        // Altitude extremum: end the run at the extremum, start the next there.
        flush(run)
        run = [p]
      }
      if (d !== 0) dir = d
    }
    run.push(s)
  }
  flush(run)
  return tracks
}

/** Azimuth band (a): tracks, candidate bearings and which tracks serve each. */
export function prepareSector(
  engine: CelestialEngine,
  q: SectorQuery,
  onProgress?: (fraction: number) => void,
): PreparedSector {
  const step = q.bearingStep ?? DEFAULT_BEARING_STEP
  if (!(step > 0)) throw new RangeError('bearingStep must be positive')
  const tracks = buildTracks(engine, q, onProgress)
  const count = Math.round(360 / step)
  const cover: number[][] = Array.from({ length: count }, () => [])
  tracks.forEach((tr, ti) => {
    if (tr.azMax - tr.azMin + 2 * BAND_MARGIN >= 360) {
      for (const c of cover) c.push(ti)
      return
    }
    const low = tr.azMin - BAND_MARGIN + 180
    const high = tr.azMax + BAND_MARGIN + 180
    for (let k = Math.ceil(low / step); k <= Math.floor(high / step); k++) {
      const idx = ((k % count) + count) % count
      cover[idx]?.push(ti)
    }
  })
  const bearings: number[] = []
  const used: (readonly number[])[] = []
  for (let i = 0; i < count; i++) {
    const c = cover[i]
    if (c && c.length > 0) {
      bearings.push(i * step)
      used.push(c)
    }
  }
  return { tracks, bearings, cover: used, step }
}

/** Log-spaced distances min..max, and the cell edges between them (clamped to min/max). */
export function sectorDistances(
  min: number,
  max: number,
  steps: number,
): { centre: number[]; inner: number[]; outer: number[] } {
  const n = Math.max(1, Math.floor(steps))
  if (n === 1 || !(max > min)) {
    const c = Math.sqrt(min * max)
    return { centre: [c], inner: [min], outer: [max] }
  }
  const ratio = (max / min) ** (1 / (n - 1))
  const centre: number[] = []
  for (let i = 0; i < n; i++) centre.push(i === n - 1 ? max : min * ratio ** i)
  const inner: number[] = []
  const outer: number[] = []
  for (let i = 0; i < n; i++) {
    inner.push(i === 0 ? min : (centre[i - 1] as number) * Math.sqrt(ratio))
    outer.push(i === n - 1 ? max : (centre[i] as number) * Math.sqrt(ratio))
  }
  return { centre, inner, outer }
}

/** Evaluate (c)-(d) over the prepared fan. */
export function evaluateSector(
  engine: CelestialEngine,
  q: SectorQuery,
  prep: PreparedSector,
  onProgress?: (fraction: number) => void,
): SectorCell[] {
  const tol = q.tolerance ?? DEFAULT_TOLERANCE
  const k = q.refractionK ?? DEFAULT_REFRACTION_K
  const desired = q.desiredOffset
  const dist = sectorDistances(q.minDistance, q.maxDistance, q.distanceSteps ?? DEFAULT_DISTANCE_STEPS)
  const cells: SectorCell[] = []
  const illumCache = new Map<number, number>()
  const illumination = (ms: number): number => {
    const key = Math.round(ms / 600_000)
    let v = illumCache.get(key)
    if (v === undefined) {
      v = engine.getMoonPhase(new Date(ms)).illumination
      illumCache.set(key, v)
    }
    return v
  }
  const tick = Math.max(1, Math.floor(prep.bearings.length / 100))

  for (let bi = 0; bi < prep.bearings.length; bi++) {
    const bearing = prep.bearings[bi] as number
    const serving = prep.cover[bi] as readonly number[]
    for (let di = 0; di < dist.centre.length; di++) {
      const d = dist.centre[di] as number
      const cp = destinationPoint(q.target, deg(bearing), m(d))
      const ground = q.groundHeight(cp.lat, cp.lon)
      if (ground === null) continue
      const camera: GeodeticPosition = { lat: cp.lat, lon: cp.lon, height: m(ground + q.eyeHeight) }
      const td = targetDirection(camera, q.target, k)
      const sinT = Math.sin(td.azimuth * RAD)
      const cosT = Math.cos(td.azimuth * RAD)
      const phi = camera.lat * RAD
      const lam = camera.lon * RAD
      const sinP = Math.sin(phi)
      const cosP = Math.cos(phi)
      const sinL = Math.sin(lam)
      const cosL = Math.cos(lam)
      // Camera ENU axes in ECEF.
      const ex = -sinL
      const ey = cosL
      const nx = -sinP * cosL
      const ny = -sinP * sinL
      const nz = cosP
      const ux = cosP * cosL
      const uy = cosP * sinL
      const uz = sinP

      const cross = (tr: SectorTrack, i: number): number => {
        const e = ex * (tr.x[i] as number) + ey * (tr.y[i] as number)
        const n = nx * (tr.x[i] as number) + ny * (tr.y[i] as number) + nz * (tr.z[i] as number)
        return e * cosT - n * sinT
      }
      const ahead = (tr: SectorTrack, i: number): boolean => {
        const e = ex * (tr.x[i] as number) + ey * (tr.y[i] as number)
        const n = nx * (tr.x[i] as number) + ny * (tr.y[i] as number) + nz * (tr.z[i] as number)
        return n * cosT + e * sinT > 0
      }

      const hit = { found: false, abs: tol, ms: 0, err: 0, az: 0, app: 0, rising: false }

      const consider = (tr: SectorTrack, lo: number, s: number): void => {
        const hi = lo + 1
        const vx = (tr.x[lo] as number) + s * ((tr.x[hi] as number) - (tr.x[lo] as number))
        const vy = (tr.y[lo] as number) + s * ((tr.y[hi] as number) - (tr.y[lo] as number))
        const vz = (tr.z[lo] as number) + s * ((tr.z[hi] as number) - (tr.z[lo] as number))
        const e = ex * vx + ey * vy
        const n = nx * vx + ny * vy + nz * vz
        const u = ux * vx + uy * vy + uz * vz
        const altGeo = Math.atan2(u, Math.hypot(e, n)) * DEG
        const g = altGeo - td.apparentAltitude - desired
        // Apparent altitude exceeds geometric by 0..MAX_REFRACTION_LIFT in the window.
        if (g > hit.abs || g + MAX_REFRACTION_LIFT < -hit.abs) return
        const app = refract(deg(altGeo))
        if (app < MIN_APPARENT || app > (q.maxBodyAltitude ?? DEFAULT_MAX_BODY_ALTITUDE)) return
        const err = app - td.apparentAltitude - desired
        if (Math.abs(err) > hit.abs) return
        hit.found = true
        hit.abs = Math.abs(err)
        hit.ms = (tr.t[lo] as number) + s * ((tr.t[hi] as number) - (tr.t[lo] as number))
        hit.err = err
        hit.az = normalizeAzimuth(deg(Math.atan2(e, n) * DEG))
        hit.app = app
        hit.rising = tr.rising
      }

      for (const ti of serving) {
        const tr = prep.tracks[ti] as SectorTrack
        if (tr.narrow) {
          let lo = 0
          let hi = tr.n - 1
          let fLo = cross(tr, lo)
          let fHi = cross(tr, hi)
          if (fLo * fHi > 0 || !ahead(tr, lo) || !ahead(tr, hi)) continue
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1
            const fm = cross(tr, mid)
            if (fm * fLo <= 0) {
              hi = mid
              fHi = fm
            } else {
              lo = mid
              fLo = fm
            }
          }
          const den = fLo - fHi
          consider(tr, lo, den === 0 ? 0 : fLo / den)
        } else {
          let fPrev = cross(tr, 0)
          for (let i = 0; i < tr.n - 1; i++) {
            const fNext = cross(tr, i + 1)
            if (fPrev * fNext <= 0 && ahead(tr, i) && ahead(tr, i + 1)) {
              const den = fPrev - fNext
              consider(tr, i, den === 0 ? 0 : fPrev / den)
            }
            fPrev = fNext
          }
        }
      }

      if (!hit.found) continue
      cells.push({
        bearing: deg(bearing),
        distance: m(d),
        bearingHalfWidth: deg(prep.step / 2),
        distanceInner: m(dist.inner[di] as number),
        distanceOuter: m(dist.outer[di] as number),
        lat: cp.lat,
        lon: cp.lon,
        groundHeight: ground,
        visible: null,
        best: {
          time: new Date(hit.ms),
          offsetError: deg(hit.err),
          bodyAzimuth: deg(hit.az),
          bodyApparentAltitude: deg(hit.app),
          targetApparentAltitude: deg(td.apparentAltitude),
          direction: hit.rising ? 'rising' : 'setting',
          ...(q.body === 'moon' ? { illumination: illumination(hit.ms) } : {}),
        },
      })
    }
    if (onProgress && bi % tick === 0) onProgress(bi / prep.bearings.length)
  }
  onProgress?.(1)
  return cells
}

/**
 * Cells where the body sits behind the target within `tolerance` on some day
 * of [start, end). See the file header for the algorithm.
 */
export function computeSectorField(
  engine: CelestialEngine,
  q: SectorQuery,
  onProgress?: (fraction: number) => void,
): SectorCell[] {
  const prep = prepareSector(engine, q, onProgress && ((f) => onProgress(f * 0.5)))
  return evaluateSector(engine, q, prep, onProgress && ((f) => onProgress(0.5 + f * 0.5)))
}

// ------------------------------------------------------------- geometry

const MAX_ARC_SEGMENT_DEG = 2

/**
 * Closed (lon, lat) ring of the cell's annular sector, for map rendering.
 * `origin` (the landmark) makes the ring exact; without it the origin is
 * reconstructed from the cell centre along the back bearing (error of a few
 * tens of metres at 20 km from meridian convergence).
 */
export function cellPolygon(
  cell: SectorCell,
  origin: { readonly lat: number; readonly lon: number } = destinationPoint(
    { lat: cell.lat, lon: cell.lon },
    deg((cell.bearing + 180) % 360),
    cell.distance,
  ),
): [number, number][] {
  const o = { lat: deg(origin.lat), lon: deg(origin.lon) }
  const width = cell.bearingHalfWidth * 2
  const segments = Math.max(1, Math.ceil(width / MAX_ARC_SEGMENT_DEG))
  const arc = (distance: number): [number, number][] => {
    const pts: [number, number][] = []
    for (let i = 0; i <= segments; i++) {
      const b = cell.bearing - cell.bearingHalfWidth + (width * i) / segments
      const p = destinationPoint(o, deg(((b % 360) + 360) % 360), m(distance))
      pts.push([p.lon, p.lat])
    }
    return pts
  }
  const ring = [...arc(cell.distanceOuter), ...arc(cell.distanceInner).reverse()]
  const first = ring[0]
  if (first) ring.push([first[0], first[1]])
  return ring
}

/** Bounding box of the fan (bearings x [minDistance, maxDistance]) plus a margin, metres. */
export function sectorBounds(
  target: { readonly lat: Degrees; readonly lon: Degrees },
  bearings: readonly number[],
  minDistance: number,
  maxDistance: number,
  marginMeters = 500,
): Bounds | null {
  if (bearings.length === 0) return null
  let north = -90
  let south = 90
  let east = -180
  let west = 180
  const take = (b: number, d: number): void => {
    const p = destinationPoint(target, deg(b), m(d))
    north = Math.max(north, p.lat)
    south = Math.min(south, p.lat)
    east = Math.max(east, p.lon)
    west = Math.min(west, p.lon)
  }
  const stride = Math.max(1, Math.floor(bearings.length / 60))
  for (let i = 0; i < bearings.length; i += stride) {
    take(bearings[i] as number, minDistance)
    take(bearings[i] as number, maxDistance)
  }
  const lastB = bearings[bearings.length - 1] as number
  take(lastB, minDistance)
  take(lastB, maxDistance)
  const dLat = marginMeters / 111_320
  const dLon = marginMeters / (111_320 * Math.max(0.2, Math.cos(((north + south) / 2) * RAD)))
  return { north: deg(north + dLat), south: deg(south - dLat), east: deg(east + dLon), west: deg(west - dLon) }
}

/** Finest zoom in [minZoom, maxZoom] whose tile count fits MAX_TILES, or null. */
export function sectorTerrainZoom(bounds: Bounds, maxZoom = 13, minZoom = 8): number | null {
  for (let z = maxZoom; z >= minZoom; z--) {
    try {
      if (tilesForBounds(bounds, z).length <= MAX_TILES) return z
    } catch {
      /* RangeError: too many tiles at this zoom; try coarser */
    }
  }
  return null
}
