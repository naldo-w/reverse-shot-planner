/** Pure model for the fan-search UI: parameters, presets, palette and GeoJSON builders. */

import { destinationPoint } from '../../core/geometry/geodesy'
import { fromLocalParts, toLocalParts } from '../../core/planner'
import type { AccessKind, AccessPoint } from '../../core/search/access'
import { cellPolygon } from '../../core/search/sectors'
import type { SectorCell } from '../../core/search/sectors'
import { deg, m } from '../../core/units'
import { fmtDate } from '../app/format'
import type { FeatureCollection, LatLon } from '../map/geo'

export type SectorRange = 'day' | '30' | '90' | '365'
export type SectorComposition = 'centred' | 'above' | 'custom'
export type SectorEvent = 'rise' | 'set' | 'any'

export interface SectorParams {
  readonly event: SectorEvent
  readonly range: SectorRange
  readonly composition: SectorComposition
  /** Body centre above the summit, degrees (used when composition = custom). */
  readonly customOffset: number
  readonly tolerance: 0.25 | 0.5 | 1
  readonly minKm: number
  readonly maxKm: number
  /** Only show reachable, unobstructed points (OSM roads / paths / parks + buildings). */
  readonly accessOnly: boolean
}

export const DEFAULT_SECTOR_PARAMS: SectorParams = {
  event: 'set',
  range: '365',
  composition: 'centred',
  customOffset: 0,
  tolerance: 0.5,
  minKm: 0.5,
  maxKm: 20,
  accessOnly: true,
}

/** Sun and Moon both subtend ~0.5 deg: touching the summit from above = centre + 0.26 deg. */
export const TOUCHING_OFFSET_DEG = 0.26
export const MAX_SECTOR_KM = 30
export const MIN_SECTOR_KM = 0.1
const DAY_MS = 86_400_000

export const RANGE_DAYS: Readonly<Record<SectorRange, number>> = { day: 1, '30': 30, '90': 90, '365': 365 }

export function compositionOffset(p: SectorParams): number {
  return p.composition === 'centred' ? 0 : p.composition === 'above' ? TOUCHING_OFFSET_DEG : p.customOffset
}

/** [local midnight of the selected day, + N days) as UTC instants. */
export function sectorRange(timeMs: number, utcOffsetMinutes: number, range: SectorRange): { start: Date; end: Date } {
  const p = toLocalParts(new Date(timeMs), utcOffsetMinutes)
  const start = fromLocalParts({ ...p, h: 0, mi: 0 }, utcOffsetMinutes)
  return { start, end: new Date(start.getTime() + RANGE_DAYS[range] * DAY_MS) }
}

// ---------------------------------------------------------------- palette

/** Sequential, light-to-warm ramp that stays legible on the dark basemap. */
export const PALETTE_STOPS = ['#79e0ee', '#4ea8de', '#7b6cf6', '#d45bc0', '#ff8a5b'] as const

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
]

/** Colour for a fraction 0..1 along the date range. */
export function paletteColor(fraction: number): string {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const pos = f * (PALETTE_STOPS.length - 1)
  const i = Math.min(PALETTE_STOPS.length - 2, Math.floor(pos))
  const a = hex(PALETTE_STOPS[i] as string)
  const b = hex(PALETTE_STOPS[i + 1] as string)
  const k = pos - i
  const c = a.map((v, n) => Math.round(v + ((b[n] as number) - v) * k))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export const paletteGradient = (): string => `linear-gradient(90deg, ${PALETTE_STOPS.join(', ')})`

// --------------------------------------------------------------- GeoJSON

/** Fill opacity by |error|: 0.6 at 0 down to 0.15 at the tolerance. */
export function fillOpacity(absError: number, tolerance: number): number {
  const f = tolerance > 0 ? Math.min(1, Math.max(0, absError / tolerance)) : 0
  return 0.6 - 0.45 * f
}

export interface SectorFeatureOptions {
  readonly landmark: LatLon
  readonly startMs: number
  readonly endMs: number
  readonly tolerance: number
  /** Access mode: cells are only context (fill opacity 0.08, outline kept). */
  readonly dim?: boolean
}

/** Fill opacity of a dimmed fan cell. */
export const DIM_FILL_OPACITY = 0.08

/** One polygon per cell. Properties: i (index in `cells`), color, opacity, h (1 = hidden by terrain). */
export function sectorCollection(cells: readonly SectorCell[], o: SectorFeatureOptions): FeatureCollection {
  const span = o.endMs - o.startMs
  return {
    type: 'FeatureCollection',
    features: cells.map((c, i) => ({
      type: 'Feature',
      properties: {
        i,
        color: paletteColor(span > 0 ? (c.best.time.getTime() - o.startMs) / span : 0),
        opacity: o.dim ? DIM_FILL_OPACITY : fillOpacity(Math.abs(c.best.offsetError), o.tolerance),
        h: c.visible === false ? 1 : 0,
      },
      geometry: { type: 'Polygon', coordinates: [cellPolygon(c, o.landmark)] },
    })),
  }
}

/** Contiguous bearing groups (gap > 5 deg splits, wrapping through north). Each is [first, last] edge bearing. */
export function fanGroups(cells: readonly SectorCell[]): { from: number; to: number; outer: number }[] {
  if (cells.length === 0) return []
  const items = [...cells].sort((a, b) => a.bearing - b.bearing)
  const groups: { from: number; to: number; outer: number }[] = []
  const first = items[0] as SectorCell
  let cur = {
    from: first.bearing - first.bearingHalfWidth,
    to: first.bearing + first.bearingHalfWidth,
    outer: first.distanceOuter as number,
  }
  for (const c of items.slice(1)) {
    if (c.bearing - c.bearingHalfWidth - cur.to > 5) {
      groups.push(cur)
      cur = { from: c.bearing - c.bearingHalfWidth, to: c.bearing + c.bearingHalfWidth, outer: c.distanceOuter }
    } else {
      cur.to = Math.max(cur.to, c.bearing + c.bearingHalfWidth)
      cur.outer = Math.max(cur.outer, c.distanceOuter)
    }
  }
  groups.push(cur)
  // Merge the last and first group when the fan wraps through north.
  const g0 = groups[0]
  const gl = groups[groups.length - 1]
  if (groups.length > 1 && g0 && gl && g0.from + 360 - gl.to <= 5) {
    groups.pop()
    groups[0] = { from: gl.from - 360, to: g0.to, outer: Math.max(g0.outer, gl.outer) }
  }
  return groups
}

/** The two edge rays of every fan, from the landmark out to the farthest cell. */
export function sectorEdgesCollection(cells: readonly SectorCell[], landmark: LatLon): FeatureCollection {
  const origin = { lat: deg(landmark.lat), lon: deg(landmark.lon) }
  const features: unknown[] = []
  for (const g of fanGroups(cells)) {
    for (const b of [g.from, g.to]) {
      const end = destinationPoint(origin, deg(((b % 360) + 360) % 360), m(g.outer))
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[origin.lon, origin.lat], [end.lon, end.lat]] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// --------------------------------------------------------------- results

/** The `n` cells with the smallest |error| (earlier first on ties). */
export function topCells(cells: readonly SectorCell[], n = 20): SectorCell[] {
  return [...cells]
    .sort(
      (a, b) =>
        Math.abs(a.best.offsetError) - Math.abs(b.best.offsetError) ||
        a.best.time.getTime() - b.best.time.getTime(),
    )
    .slice(0, n)
}

export interface DateGroup {
  readonly date: string
  readonly cells: readonly SectorCell[]
}

/** Groups by local date (ascending), each group by time. */
export function groupByDate(cells: readonly SectorCell[], utcOffsetMinutes: number): DateGroup[] {
  const map = new Map<string, SectorCell[]>()
  for (const c of [...cells].sort((a, b) => a.best.time.getTime() - b.best.time.getTime())) {
    const date = fmtDate(c.best.time, utcOffsetMinutes)
    const list = map.get(date)
    if (list) list.push(c)
    else map.set(date, [c])
  }
  return [...map.entries()].map(([date, list]) => ({ date, cells: list }))
}

export interface SectorSummary {
  readonly count: number
  readonly bearingMin: number
  readonly bearingMax: number
  readonly distanceMinKm: number
  readonly distanceMaxKm: number
}

export function summarize(cells: readonly SectorCell[]): SectorSummary | null {
  if (cells.length === 0) return null
  let b0 = Infinity
  let b1 = -Infinity
  let d0 = Infinity
  let d1 = -Infinity
  for (const c of cells) {
    b0 = Math.min(b0, c.bearing)
    b1 = Math.max(b1, c.bearing)
    d0 = Math.min(d0, c.distance)
    d1 = Math.max(d1, c.distance)
  }
  return { count: cells.length, bearingMin: b0, bearingMax: b1, distanceMinKm: d0 / 1000, distanceMaxKm: d1 / 1000 }
}

// ------------------------------------------------------------ access points

/** Circles for access points, coloured by date. Properties: p (index in `points`), color, pr (priority). */
export function accessCollection(
  points: readonly AccessPoint[],
  o: { readonly startMs: number; readonly endMs: number },
): FeatureCollection {
  const span = o.endMs - o.startMs
  return {
    type: 'FeatureCollection',
    features: points.map((pt, p) => ({
      type: 'Feature',
      properties: {
        p,
        pr: pt.priority,
        color: paletteColor(span > 0 ? (pt.best.time.getTime() - o.startMs) / span : 0),
      },
      geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
    })),
  }
}

/** The user-facing family of a kind: minor roads and roads share one label. */
export type AccessFamily = 'viewpoint' | 'park' | 'path' | 'road'
export const accessFamily = (k: AccessKind): AccessFamily => (k === 'minor-road' || k === 'road' ? 'road' : k)
export const ACCESS_FAMILY_ORDER: readonly AccessFamily[] = ['viewpoint', 'park', 'path', 'road']

export interface FamilyGroup {
  readonly family: AccessFamily
  readonly points: readonly AccessPoint[]
}

/** Groups (already ranked) points by family, in priority order; keeps each group's order. */
export function groupByFamily(points: readonly AccessPoint[]): FamilyGroup[] {
  return ACCESS_FAMILY_ORDER.map((family) => ({ family, points: points.filter((p) => accessFamily(p.kind) === family) })).filter(
    (g) => g.points.length > 0,
  )
}
