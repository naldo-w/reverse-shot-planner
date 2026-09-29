import { describe, expect, it } from 'vitest'
import { areaBounds, chooseZoom } from './terrainService'

describe('chooseZoom', () => {
  it('uses zoom 13 for a short baseline', () => {
    expect(chooseZoom(areaBounds({ lat: 25.03, lon: 121.56 }, { lat: 25.04, lon: 121.6 }))).toBe(13)
  })
  it('falls back to a lower zoom instead of throwing when zoom 13 exceeds the tile cap', () => {
    // ~100 km diagonal: too many tiles at z12, fine at z10/z9.
    const z = chooseZoom(areaBounds({ lat: 25.0, lon: 121.0 }, { lat: 25.9, lon: 121.9 }))
    expect(z).not.toBeNull()
    expect(z as number).toBeLessThan(13)
  })
  it('returns null (not throw) when even zoom 9 is too large', () => {
    expect(chooseZoom(areaBounds({ lat: 0, lon: 0 }, { lat: 0, lon: 60 }))).toBeNull()
  })
})
