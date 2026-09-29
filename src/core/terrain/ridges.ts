/**
 * Ridgeline extraction: the visible crests along each azimuth ray, linked
 * across azimuths into polylines, so a simulated frame can show the layered
 * form of terrain and not only its top skyline (TECHNICAL_NOTES §5).
 *
 * Per azimuth the ray is marched exactly like `calculateHorizonProfile` (same
 * curvature and refraction). A sample is visible when its apparent angle is at
 * least the running maximum M of all nearer samples. A crest is the last
 * visible sample of a visible run: the following samples fall below it by at
 * least `minProminence` before terrain becomes visible again. The final crest
 * (the global maximum) is the skyline point of that azimuth.
 *
 * Linking (greedy, azimuth by azimuth): a crest continues a line ending at the
 * previous azimuth when
 *   |Δdistance| <= max(3 * resolution, 0.08 * distance)   and
 *   |Δaltitude| <= 3 * azimuthStep + minProminence.
 * The altitude bound is the apparent climb of a ridge crossing the view: at
 * constant range, a slope s raises the crest by about s * Δazimuth degrees, so
 * 3 * azimuthStep admits slopes up to ~70 degrees; minProminence absorbs
 * sampling noise on flat crests. Candidate pairs are ranked by normalised
 * distance + altitude difference and assigned nearest first; unmatched crests
 * start new lines. Non-skyline lines under 4 points are dropped. Lines do not
 * bridge azimuth gaps, so a ridge hidden behind a nearer one for a while
 * reappears as a separate line.
 *
 * `nearFieldDistance` (default 0) drops samples closer than that from skyline,
 * ridges and crest logic; their per-azimuth maximum is returned as `nearField`.
 */

import { LocalFrame } from '../coordinates/enu'
import { normalizeAzimuth } from '../geometry/angles'
import type { GeodeticPosition, HorizonProfile, HorizonSample } from '../types'
import { deg, m } from '../units'
import type { Degrees, Meters } from '../units'
import { marchRay, seaHorizonAltitude } from './horizon'
import type { ElevationSampler, HorizonOptions } from './types'

const RAD = Math.PI / 180
const DEFAULT_PROMINENCE = 0.03
const MIN_RIDGE_POINTS = 4

export interface RidgePoint {
  readonly azimuth: Degrees
  readonly altitude: Degrees
  readonly distance: Meters
}

export interface RidgeLine {
  readonly points: readonly RidgePoint[]
  readonly meanDistance: Meters
  readonly isSkyline: boolean
}

export interface RidgelineResult {
  readonly skyline: HorizonProfile
  /** Per-azimuth max apparent angle of the ignored near-field samples (altitude = -90 where none). */
  readonly nearField: HorizonProfile
  readonly ridges: RidgeLine[]
}

interface Crest {
  readonly az: number
  readonly alt: number
  readonly dist: number
}

interface OpenLine {
  readonly points: Crest[]
}

const meanOf = (pts: readonly { dist: number }[]): number =>
  pts.reduce((a, p) => a + p.dist, 0) / Math.max(1, pts.length)

function toLine(pts: readonly Crest[], isSkyline: boolean): RidgeLine {
  return {
    points: pts.map((p) => ({ azimuth: deg(p.az), altitude: deg(p.alt), distance: m(p.dist) })),
    meanDistance: m(meanOf(pts)),
    isSkyline,
  }
}

export function calculateRidgelines(
  camera: GeodeticPosition,
  sampler: ElevationSampler,
  opts: HorizonOptions & { minProminence?: Degrees },
): RidgelineResult {
  const step = opts.azimuthStep
  if (!(step > 0)) throw new RangeError('azimuthStep must be positive')
  const prominence = opts.minProminence ?? DEFAULT_PROMINENCE
  const span = opts.azimuthEnd - opts.azimuthStart
  const sweep = span >= 0 ? span : ((span % 360) + 360) % 360
  const count = Math.floor(sweep / step + 1e-9) + 1
  const res = sampler.resolutionMeters
  const k = opts.refractionK
  const frame = new LocalFrame(camera)
  const seaLevel = seaHorizonAltitude(camera.height, k)
  const altTol = 3 * step + prominence

  const near = opts.nearFieldDistance ?? 0
  const samples: HorizonSample[] = []
  const nearSamples: HorizonSample[] = []
  const skyPoints: Crest[] = []
  const finished: Crest[][] = []
  let open: OpenLine[] = []

  for (let i = 0; i < count; i++) {
    const az = normalizeAzimuth(deg(opts.azimuthStart + i * step))
    const sinAz = Math.sin(az * RAD)
    const cosAz = Math.cos(az * RAD)
    const crests: Crest[] = []
    let has = false
    let candAlt = 0
    let candDist = 0
    let minSince = Number.POSITIVE_INFINITY
    let nearBest = Number.NEGATIVE_INFINITY
    let nearDist = 0

    marchRay(
      frame,
      camera,
      sampler,
      sinAz,
      cosAz,
      opts.maxDistance,
      k,
      (alt, horiz) => {
        if (!has || alt >= candAlt) {
          if (has && candAlt - minSince >= prominence) crests.push({ az, alt: candAlt, dist: candDist })
          has = true
          candAlt = alt
          candDist = horiz
          minSince = Number.POSITIVE_INFINITY
        } else if (alt < minSince) {
          minSince = alt
        }
      },
      near,
      (alt, horiz) => {
        if (alt > nearBest) {
          nearBest = alt
          nearDist = horiz
        }
      },
    )
    nearSamples.push(
      nearBest === Number.NEGATIVE_INFINITY
        ? { azimuth: az, altitude: deg(-90) }
        : { azimuth: az, altitude: deg(nearBest), distance: m(nearDist) },
    )

    if (!has) {
      samples.push({ azimuth: az, altitude: deg(seaLevel) })
    } else {
      samples.push({ azimuth: az, altitude: deg(candAlt), distance: m(candDist) })
      skyPoints.push({ az, alt: candAlt, dist: candDist })
    }

    // Greedy nearest-first assignment of this azimuth's crests to open lines.
    const pairs: { line: number; crest: number; cost: number }[] = []
    open.forEach((line, li) => {
      const last = line.points[line.points.length - 1]
      if (!last) return
      const distTol = Math.max(3 * res, 0.08 * last.dist)
      crests.forEach((c, ci) => {
        const dd = Math.abs(c.dist - last.dist)
        const da = Math.abs(c.alt - last.alt)
        if (dd <= distTol && da <= altTol) pairs.push({ line: li, crest: ci, cost: dd / distTol + da / altTol })
      })
    })
    pairs.sort((a, b) => a.cost - b.cost)
    const lineTaken = new Set<number>()
    const crestTaken = new Set<number>()
    const next: OpenLine[] = []
    for (const p of pairs) {
      if (lineTaken.has(p.line) || crestTaken.has(p.crest)) continue
      lineTaken.add(p.line)
      crestTaken.add(p.crest)
      const line = open[p.line]
      const crest = crests[p.crest]
      if (!line || !crest) continue
      line.points.push(crest)
      next.push(line)
    }
    open.forEach((line, li) => {
      if (!lineTaken.has(li)) finished.push(line.points)
    })
    crests.forEach((c, ci) => {
      if (!crestTaken.has(ci)) next.push({ points: [c] })
    })
    open = next
  }
  for (const line of open) finished.push(line.points)

  const ridges: RidgeLine[] = finished.filter((l) => l.length >= MIN_RIDGE_POINTS).map((l) => toLine(l, false))
  if (skyPoints.length >= 2) ridges.push(toLine(skyPoints, true))
  ridges.sort((a, b) => a.meanDistance - b.meanDistance)
  return { skyline: { samples }, nearField: { samples: nearSamples }, ridges }
}
