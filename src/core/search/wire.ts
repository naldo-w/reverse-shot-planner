/** Worker wire format for sector (fan) searches: Dates cross postMessage as ISO strings. */

import type { Meters } from '../units'
import type { AccessPoint, AccessSummary } from './access'
import type { SectorBest, SectorCell, SectorQuery } from './sectors'

/**
 * A sector query as the UI states it. `groundHeight` is a function and cannot
 * cross postMessage: the worker loads terrain and samples it itself.
 */
export type SectorRequestQuery = Omit<SectorQuery, 'groundHeight'> & {
  /** Cells (best |error| first) that get a terrain line-of-sight check. Default 300. */
  readonly visibilityLimit?: number
  /** Terrain closer than this to the camera is ignored by the visibility check, metres. Default 200. */
  readonly nearFieldDistance?: Meters
}

export type WireSectorQuery = Omit<SectorRequestQuery, 'start' | 'end'> & { start: string; end: string }
export type WireSectorCell = Omit<SectorCell, 'best'> & {
  best: Omit<SectorBest, 'time'> & { time: string }
}

export const serializeSectorQuery = (q: SectorRequestQuery): WireSectorQuery => ({
  ...q,
  start: q.start.toISOString(),
  end: q.end.toISOString(),
})

export const reviveSectorQuery = (q: WireSectorQuery): SectorRequestQuery => ({
  ...q,
  start: new Date(q.start),
  end: new Date(q.end),
})

export const serializeSectorCells = (cells: readonly SectorCell[]): WireSectorCell[] =>
  cells.map((c) => ({ ...c, best: { ...c.best, time: c.best.time.toISOString() } }))

export const reviveSectorCells = (cells: readonly WireSectorCell[]): SectorCell[] =>
  cells.map((c) => ({ ...c, best: { ...c.best, time: new Date(c.best.time) } }))

// ------------------------------------------------------------ access field

/** Result of an access (reachable + unobstructed points) search. */
export interface AccessFieldResult {
  /** Geometric fan cells; AccessPoint.cellRef indexes this array. */
  readonly cells: SectorCell[]
  readonly points: AccessPoint[]
  readonly summary: AccessSummary
}

export type WireAccessPoint = Omit<AccessPoint, 'best'> & { best: Omit<SectorBest, 'time'> & { time: string } }
export interface WireAccessResult {
  readonly cells: WireSectorCell[]
  readonly points: WireAccessPoint[]
  readonly summary: AccessSummary
}

export const serializeAccess = (r: AccessFieldResult): WireAccessResult => ({
  cells: serializeSectorCells(r.cells),
  points: r.points.map((p) => ({ ...p, best: { ...p.best, time: p.best.time.toISOString() } })),
  summary: r.summary,
})

export const reviveAccess = (r: WireAccessResult): AccessFieldResult => ({
  cells: reviveSectorCells(r.cells),
  points: r.points.map((p) => ({ ...p, best: { ...p.best, time: new Date(p.best.time) } })),
  summary: r.summary,
})

/** Phases reported while an access search runs. */
export type AccessPhase = 'geometry' | 'terrain' | 'features' | 'evaluation' | 'buildings' | 'visibility'
