/// Module worker: runs planner searches off the main thread.

import { createCelestialEngine } from '../core/astronomy'
import type { CelestialEngine, EngineId } from '../core/astronomy'
import { findAlignments } from '../core/planner/alignments'
import {
  reviveQuery,
  serializeAlignments,
  type PlannerRequest,
  type PlannerResponse,
} from '../core/planner/wire'

interface WorkerScope {
  onmessage: ((e: MessageEvent<PlannerRequest>) => void) | null
  postMessage(message: PlannerResponse): void
}
const ctx = self as unknown as WorkerScope

const engines = new Map<EngineId, CelestialEngine>()
function engineFor(id: EngineId): CelestialEngine {
  let e = engines.get(id)
  if (!e) {
    e = createCelestialEngine(id)
    engines.set(id, e)
  }
  return e
}

ctx.onmessage = (e) => {
  const { id, type, engineId, query } = e.data
  try {
    if (type !== 'findAlignments') throw new Error(`Unknown request type: ${String(type)}`)
    const result = findAlignments(engineFor(engineId), reviveQuery(query))
    ctx.postMessage({ id, ok: true, result: serializeAlignments(result) })
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
