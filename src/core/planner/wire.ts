/** Worker wire format: Dates cross postMessage as ISO strings. */

import type { EngineId } from '../astronomy'
import type { Alignment, AlignmentQuery } from './types'

export type WireQuery = Omit<AlignmentQuery, 'start' | 'end'> & { start: string; end: string }
export type WireAlignment = Omit<Alignment, 'time'> & { time: string }

export interface PlannerRequest {
  readonly id: number
  readonly type: 'findAlignments'
  readonly engineId: EngineId
  readonly query: WireQuery
}

export type PlannerResponse =
  | { readonly id: number; readonly ok: true; readonly result: WireAlignment[] }
  | { readonly id: number; readonly ok: false; readonly error: string }

export const serializeQuery = (q: AlignmentQuery): WireQuery => ({
  ...q,
  start: q.start.toISOString(),
  end: q.end.toISOString(),
})

export const reviveQuery = (q: WireQuery): AlignmentQuery => ({
  ...q,
  start: new Date(q.start),
  end: new Date(q.end),
})

export const serializeAlignments = (a: readonly Alignment[]): WireAlignment[] =>
  a.map((x) => ({ ...x, time: x.time.toISOString() }))

export const reviveAlignments = (a: readonly WireAlignment[]): Alignment[] =>
  a.map((x) => ({ ...x, time: new Date(x.time) }))
