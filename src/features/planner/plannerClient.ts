import { DEFAULT_ENGINE_ID } from '../../core/astronomy'
import type { EngineId } from '../../core/astronomy'
import type { Alignment, AlignmentQuery } from '../../core/planner/types'
import {
  reviveAlignments,
  serializeQuery,
  type PlannerRequest,
  type PlannerResponse,
} from '../../core/planner/wire'

export interface PlannerClient {
  findAlignments(q: AlignmentQuery, engineId?: EngineId): Promise<Alignment[]>
  dispose(): void
}

interface Pending {
  resolve(a: Alignment[]): void
  reject(e: Error): void
}

export function createPlannerClient(): PlannerClient {
  const worker = new Worker(new URL('../../workers/planner.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, Pending>()
  let nextId = 1
  let disposed = false

  const failAll = (message: string): void => {
    for (const p of pending.values()) p.reject(new Error(message))
    pending.clear()
  }

  worker.onmessage = (e: MessageEvent<PlannerResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(reviveAlignments(msg.result))
    else p.reject(new Error(msg.error))
  }
  worker.onerror = (e) => failAll(e.message || 'Planner worker error')

  return {
    findAlignments(q, engineId = DEFAULT_ENGINE_ID) {
      if (disposed) return Promise.reject(new Error('Planner client disposed'))
      return new Promise<Alignment[]>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        const req: PlannerRequest = { id, type: 'findAlignments', engineId, query: serializeQuery(q) }
        worker.postMessage(req)
      })
    },
    dispose() {
      disposed = true
      failAll('Planner client disposed')
      worker.terminate()
    },
  }
}
