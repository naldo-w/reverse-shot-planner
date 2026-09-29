import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { targetPosition } from '../../core/planner'
import type { Landmark } from '../../core/planner/types'
import type { SectorCell } from '../../core/search/sectors'
import type { CelestialBody } from '../../core/types'
import { deg, m } from '../../core/units'
import { createPlannerClient } from '../planner/plannerClient'
import type { PlannerClient } from '../planner/plannerClient'
import {
  compositionOffset,
  DEFAULT_SECTOR_PARAMS,
  MAX_SECTOR_KM,
  MIN_SECTOR_KM,
  sectorRange,
} from './sectorModel'
import type { SectorParams } from './sectorModel'

/** Cells that get a terrain line-of-sight check (best |error| first). */
const VISIBILITY_CELLS = 1000

export interface SectorResult {
  readonly cells: readonly SectorCell[]
  /** Identifies the landmark/body/eye height the cells were computed for. */
  readonly key: string
  readonly startMs: number
  readonly endMs: number
  readonly tolerance: number
  readonly maxKm: number
}

export type SectorStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly progress: number }
  | { readonly state: 'done'; readonly result: SectorResult }
  | { readonly state: 'error'; readonly message: string }

export interface SectorSearchInputs {
  readonly landmark: Landmark
  readonly body: CelestialBody
  readonly timeMs: number
  readonly eyeHeight: number
  readonly nearFieldMeters: number
}

export function distancesValid(p: SectorParams): boolean {
  return p.minKm >= MIN_SECTOR_KM && p.maxKm <= MAX_SECTOR_KM && p.minKm < p.maxKm
}

/** Runs sector searches in a dedicated worker per run; cancelling terminates that worker. */
export function useSectorSearch(inputs: SectorSearchInputs) {
  const { landmark, body, timeMs, eyeHeight, nearFieldMeters } = inputs
  const [params, setParams] = useState<SectorParams>(DEFAULT_SECTOR_PARAMS)
  const [status, setStatus] = useState<SectorStatus>({ state: 'idle' })
  const client = useRef<PlannerClient | null>(null)
  const token = useRef(0)

  const key = `${landmark.coordinate.lat.toFixed(5)},${landmark.coordinate.lon.toFixed(5)},${landmark.topHeight}|${body}|${eyeHeight}`

  const stop = useCallback(() => {
    token.current++
    client.current?.dispose()
    client.current = null
  }, [])
  useEffect(() => stop, [stop])

  const patch = useCallback((p: Partial<SectorParams>) => setParams((cur) => ({ ...cur, ...p })), [])

  const run = useCallback(() => {
    if (!distancesValid(params)) return
    stop()
    const id = token.current
    const { start, end } = sectorRange(timeMs, landmark.utcOffsetMinutes, params.range)
    const c = createPlannerClient()
    client.current = c
    setStatus({ state: 'running', progress: 0 })
    c.sectorField(
      {
        target: targetPosition(landmark),
        body,
        start,
        end,
        event: params.event,
        minDistance: m(params.minKm * 1000),
        maxDistance: m(params.maxKm * 1000),
        eyeHeight: m(eyeHeight),
        desiredOffset: deg(compositionOffset(params)),
        tolerance: deg(params.tolerance),
        visibilityLimit: VISIBILITY_CELLS,
        nearFieldDistance: m(nearFieldMeters),
      },
      undefined,
      (progress) => {
        if (id === token.current) setStatus({ state: 'running', progress })
      },
    ).then(
      (cells) => {
        if (id !== token.current) return
        c.dispose()
        client.current = null
        setStatus({
          state: 'done',
          result: {
            cells,
            key,
            startMs: start.getTime(),
            endMs: end.getTime(),
            tolerance: params.tolerance,
            maxKm: params.maxKm,
          },
        })
      },
      (err: unknown) => {
        if (id !== token.current) return
        c.dispose()
        client.current = null
        setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      },
    )
  }, [params, stop, timeMs, landmark, body, eyeHeight, nearFieldMeters, key])

  const cancel = useCallback(() => {
    stop()
    setStatus({ state: 'idle' })
  }, [stop])

  // A result belongs to one landmark/body/eye height; hide it when those change.
  const result = useMemo<SectorResult | null>(
    () => (status.state === 'done' && status.result.key === key ? status.result : null),
    [status, key],
  )

  return { params, patch, status, result, run, cancel }
}
