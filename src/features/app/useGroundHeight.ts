import { useEffect, useState } from 'react'
import { elevationAt } from './terrainService'

export type GroundSource = 'manual' | 'preset' | 'terrain' | 'loading' | 'unavailable'

export interface GroundInfo {
  /** Height used for the camera ground (m above sea level). */
  readonly value: number
  readonly source: GroundSource
  /** Value found from terrain (or preset) ignoring the manual override; null if unknown. */
  readonly auto: number | null
}

/** Camera ground height: manual override → preset → Terrarium lookup (debounced). */
export function useGroundHeight(
  lat: number,
  lon: number,
  preset: number | null,
  override: number | null,
): GroundInfo {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`
  const [fetched, setFetched] = useState<{ key: string; value: number | null } | null>(null)
  const needLookup = preset === null

  useEffect(() => {
    if (!needLookup) return
    let cancelled = false
    const timer = setTimeout(() => {
      void elevationAt(lat, lon).then((value) => {
        if (!cancelled) setFetched({ key, value })
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [needLookup, key, lat, lon])

  let auto: number | null = preset
  let source: GroundSource = preset !== null ? 'preset' : 'loading'
  if (preset === null && fetched && fetched.key === key) {
    auto = fetched.value
    source = fetched.value === null ? 'unavailable' : 'terrain'
  }
  if (override !== null) return { value: override, source: 'manual', auto }
  return { value: auto ?? 0, source, auto }
}
