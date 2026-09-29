/** Project status shown on the entry page. The orchestrator updates this as phases complete. */
export type PhaseState = 'done' | 'in-progress' | 'planned'

export interface Phase {
  readonly id: number
  readonly nameKey: string
  readonly state: PhaseState
}

/** Phase names live in i18n.ts under `phase.<id>`. */
export const PHASES: readonly Phase[] = [
  { id: 0, nameKey: 'phase.0', state: 'done' },
  { id: 1, nameKey: 'phase.1', state: 'done' },
  { id: 2, nameKey: 'phase.2', state: 'done' },
  { id: 3, nameKey: 'phase.3', state: 'done' },
  { id: 4, nameKey: 'phase.4', state: 'done' },
  { id: 5, nameKey: 'phase.5', state: 'in-progress' },
  { id: 6, nameKey: 'phase.6', state: 'done' },
  { id: 7, nameKey: 'phase.7', state: 'done' },
  { id: 8, nameKey: 'phase.8', state: 'planned' },
]

export const TOTAL_PHASES = 8

/** Current phase = first in-progress one (falls back to the last completed). */
export function currentPhase(phases: readonly Phase[] = PHASES): Phase {
  return (
    phases.find((p) => p.state === 'in-progress') ??
    [...phases].reverse().find((p) => p.state === 'done') ??
    phases[0]!
  )
}
