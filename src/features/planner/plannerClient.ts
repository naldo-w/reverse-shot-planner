import { DEFAULT_ENGINE_ID } from '../../core/astronomy'
import type { EngineId } from '../../core/astronomy'
import type { Alignment, AlignmentQuery } from '../../core/planner/types'
import {
  reviveAlignments,
  serializeQuery,
  type PlannerRequest,
  type PlannerResponse,
} from '../../core/planner/wire'
import type { SectorCell } from '../../core/search/sectors'
import { reviveSectorCells, serializeSectorQuery, type SectorRequestQuery } from '../../core/search/wire'

export interface PlannerClient {
  findAlignments(q: AlignmentQuery, engineId?: EngineId): Promise<Alignment[]>
  /**
   * Sector (fan) search. The worker loads terrain itself; there is no
   * `groundHeight` in the query. Cancel by `dispose()`-ing the client
   * (terminates the worker; the promise rejects).
   */
  sectorField(
    q: SectorRequestQuery,
    engineId?: EngineId,
    onProgress?: (fraction: number) => void,
  ): Promise<SectorCell[]>
  dispose(): void
}

type Success = Extract<PlannerResponse, { ok: true }>

interface Pending {
  resolve(msg: Success): void
  reject(e: Error): void
  onProgress?: (fraction: number) => void
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
    if ('progress' in msg) {
      p.onProgress?.(msg.progress)
      return
    }
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg)
    else p.reject(new Error(msg.error))
  }
  worker.onerror = (e) => failAll(e.message || 'Planner worker error')

  const send = (
    build: (id: number) => PlannerRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<Success> => {
    if (disposed) return Promise.reject(new Error('Planner client disposed'))
    return new Promise<Success>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject, ...(onProgress ? { onProgress } : {}) })
      worker.postMessage(build(id))
    })
  }

  return {
    async findAlignments(q, engineId = DEFAULT_ENGINE_ID) {
      const msg = await send((id) => ({ id, type: 'findAlignments', engineId, query: serializeQuery(q) }))
      if (!('result' in msg)) throw new Error('Unexpected planner response')
      return reviveAlignments(msg.result)
    },
    async sectorField(q, engineId = DEFAULT_ENGINE_ID, onProgress) {
      const msg = await send(
        (id) => ({ id, type: 'sectorField', engineId, query: serializeSectorQuery(q) }),
        onProgress,
      )
      if (!('sector' in msg)) throw new Error('Unexpected planner response')
      return reviveSectorCells(msg.sector)
    },
    dispose() {
      disposed = true
      failAll('Planner client disposed')
      worker.terminate()
    },
  }
}
