/** Worker wire format for sector (fan) searches: Dates cross postMessage as ISO strings. */

import type { Meters } from '../units'
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
