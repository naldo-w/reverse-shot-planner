/**
 * Mock terrain provider. TESTS ONLY: never wire this into the app as if it were
 * real data. Metadata is labelled accordingly so any UI that shows provenance
 * exposes it.
 */

import { AnalyticSampler } from '../../core/terrain/grid'
import type { Bounds } from '../../core/types'
import type { Degrees } from '../../core/units'
import type { ElevationSampler, TerrainMetadata, TerrainProvider } from '../../core/terrain/types'

export class MockTerrainProvider implements TerrainProvider {
  private readonly fn: (lat: number, lon: number) => number
  private readonly resolution: number

  constructor(fn: (lat: number, lon: number) => number, resolutionMeters = 30) {
    this.fn = fn
    this.resolution = resolutionMeters
  }

  getMetadata(): TerrainMetadata {
    return {
      provider: 'MOCK (tests only)',
      dataset: 'Synthetic analytic terrain',
      resolutionMeters: this.resolution,
      surfaceType: 'UNKNOWN',
      license: 'n/a',
      attribution: 'MOCK terrain — not real data',
    }
  }

  getElevation(lat: Degrees, lon: Degrees): Promise<number | null> {
    return Promise.resolve(this.fn(lat, lon))
  }

  loadArea(bounds: Bounds, _zoom: number): Promise<ElevationSampler> {
    return Promise.resolve(new AnalyticSampler(this.fn, bounds, this.resolution))
  }
}
