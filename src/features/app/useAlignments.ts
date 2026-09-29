import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  alignmentLines,
  cameraPosition,
  fromLocalParts,
  targetPosition,
  toLocalParts,
} from '../../core/planner'
import type { Alignment, Landmark } from '../../core/planner/types'
import type { CelestialBody, GeodeticPosition } from '../../core/types'
import { m } from '../../core/units'
import type { PresetSpot } from '../../data/presets'
import { createPlannerClient } from '../planner/plannerClient'
import { getEngine } from './useSimulation'
import { elevationAt } from './terrainService'

type PlannerClient = ReturnType<typeof createPlannerClient>

const DAY_MS = 86_400_000
export const SEARCH_DAYS = 365
const SEARCH_DEBOUNCE_MS = 500

/** Lazily created worker client, disposed on unmount (StrictMode-safe). */
function useClient(): { get: () => PlannerClient; reset: () => void } {
  const ref = useRef<PlannerClient | null>(null)
  const reset = useCallback(() => {
    ref.current?.dispose()
    ref.current = null
  }, [])
  useEffect(() => reset, [reset])
  const get = useCallback(() => {
    ref.current ??= createPlannerClient()
    return ref.current
  }, [])
  return { get, reset }
}

// ------------------------------------------------------ alignment finder

export type FinderState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly key: string }
  | { readonly status: 'done'; readonly key: string; readonly results: readonly Alignment[] }
  | { readonly status: 'error'; readonly key: string }

export function useAlignmentFinder(
  camera: GeodeticPosition,
  target: GeodeticPosition,
  body: CelestialBody,
  landmark: Landmark,
  timeMs: number,
) {
  const { get: getClient, reset: resetClient } = useClient()
  const [state, setState] = useState<FinderState>({ status: 'idle' })
  const token = useRef(0)
  const off = landmark.utcOffsetMinutes
  const geometryKey = `${body}|${camera.lat.toFixed(5)},${camera.lon.toFixed(5)},${camera.height.toFixed(1)}|${target.lat.toFixed(5)},${target.lon.toFixed(5)},${target.height.toFixed(1)}`

  const run = useCallback(() => {
    const id = ++token.current
    const p = toLocalParts(new Date(timeMs), off)
    const start = fromLocalParts({ ...p, h: 0, mi: 0 }, off)
    const end = new Date(start.getTime() + SEARCH_DAYS * DAY_MS)
    setState({ status: 'loading', key: geometryKey })
    getClient()
      .findAlignments({ camera, target, body, start, end })
      .then((results) => {
        if (id !== token.current) return
        const sorted = [...results].sort((a, b) => a.time.getTime() - b.time.getTime())
        setState({ status: 'done', key: geometryKey, results: sorted })
      })
      .catch(() => {
        if (id === token.current) setState({ status: 'error', key: geometryKey })
      })
  }, [camera, target, body, timeMs, off, geometryKey, getClient])

  // Inputs changed: drop any in-flight search (terminates the worker) so stale results never land.
  useEffect(
    () => () => {
      token.current++
      resetClient()
    },
    [geometryKey, resetClient],
  )

  // Results belong to one camera/target/body; hide them when those change.
  const visible: FinderState =
    state.status !== 'idle' && state.key !== geometryKey ? { status: 'idle' } : state
  return { state: visible, run }
}

// ------------------------------------------------- recommended spot frames

export type SpotRec =
  | { readonly status: 'queued' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'done'
      readonly sun: readonly Alignment[]
      readonly moon: readonly Alignment[]
    }
  | { readonly status: 'error' }

const NEXT_COUNT = 3

/**
 * For a preset landmark, computes (one spot at a time, in the worker) the next
 * three Sun and Moon alignments in 12 months for each preset spot.
 */
export function useSpotRecommendations(
  landmark: Landmark,
  spots: readonly PresetSpot[],
  eyeHeight: number,
): ReadonlyMap<string, SpotRec> {
  const { get: getClient, reset: resetClient } = useClient()
  const [recs, setRecs] = useState<{ key: string; map: ReadonlyMap<string, SpotRec> }>({
    key: '',
    map: new Map(),
  })
  const [startedAt] = useState(() => Date.now())
  const runKey = `${landmark.id}|${eyeHeight}|${spots.map((s) => s.id).join(',')}`

  useEffect(() => {
    if (spots.length === 0) return
    let cancelled = false
    const initial = new Map<string, SpotRec>(spots.map((s) => [s.id, { status: 'queued' }]))
    let current = initial
    const publish = (next: Map<string, SpotRec>) => {
      current = next
      if (!cancelled) setRecs({ key: runKey, map: next })
    }
    publish(initial)
    // Start now (not UTC midnight) so "next" alignments are never already in the past.
    const startDay = new Date(startedAt)
    const end = new Date(startDay.getTime() + SEARCH_DAYS * DAY_MS)
    const target = targetPosition(landmark)

    const timer = setTimeout(() => void (async () => {
      for (const spot of spots) {
        if (cancelled) return
        publish(new Map(current).set(spot.id, { status: 'loading' }))
        try {
          const ground = spot.groundHeight ?? (await elevationAt(spot.coordinate.lat, spot.coordinate.lon)) ?? 0
          const camera = cameraPosition(spot.coordinate, m(ground), m(eyeHeight))
          const client = getClient()
          const sun = await client.findAlignments({ camera, target, body: 'sun', start: startDay, end })
          if (cancelled) return
          const moon = await client.findAlignments({ camera, target, body: 'moon', start: startDay, end })
          if (cancelled) return
          const first = (list: readonly Alignment[]) =>
            [...list].sort((a, b) => a.time.getTime() - b.time.getTime()).slice(0, NEXT_COUNT)
          publish(new Map(current).set(spot.id, { status: 'done', sun: first(sun), moon: first(moon) }))
        } catch {
          publish(new Map(current).set(spot.id, { status: 'error' }))
        }
      }
    })(), SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      resetClient() // terminate the worker so an obsolete search stops computing
    }
    // runKey encodes landmark, spots and eye height
  }, [runKey, getClient, resetClient, landmark, spots, eyeHeight, startedAt])

  return recs.key === runKey ? recs.map : EMPTY
}

const EMPTY: ReadonlyMap<string, SpotRec> = new Map()

// ------------------------------------------------------ map alignment lines

export interface MapAlignLine {
  readonly body: CelestialBody
  readonly kind: 'rise' | 'set'
  readonly time: Date
  readonly azimuth: number
  readonly from: { lat: number; lon: number }
  readonly to: { lat: number; lon: number }
}

export const ALIGN_LINE_LENGTH_M = 25_000

export function useAlignLines(landmark: Landmark, localDate: string): MapAlignLine[] {
  return useMemo(() => {
    const engine = getEngine()
    const out: MapAlignLine[] = []
    for (const body of ['sun', 'moon'] as const) {
      try {
        for (const l of alignmentLines(engine, body, landmark, localDate, landmark.utcOffsetMinutes, ALIGN_LINE_LENGTH_M)) {
          out.push({ body, kind: l.kind, time: l.time, azimuth: l.azimuth, from: l.from, to: l.to })
        }
      } catch {
        /* no lines for this body on this date */
      }
    }
    return out
  }, [landmark, localDate])
}
