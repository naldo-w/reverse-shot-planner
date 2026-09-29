import { describe, expect, it } from 'vitest'
import { AnalyticSampler, TileGridSampler } from '../../src/core/terrain/grid'
import { deg } from '../../src/core/units'

const SIZE = 4
const data = new Float32Array(SIZE * SIZE)
for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) data[r * SIZE + c] = 10 * c + 100 * r

// z=1 tile (0,0): global pixel grid is 8x8 across the world.
const lonOf = (px: number): number => (px / 8) * 360 - 180
const latOf = (py: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / 8))) * 180) / Math.PI

describe('TileGridSampler', () => {
  const s = new TileGridSampler([{ z: 1, x: 0, y: 0, data, size: SIZE }])

  it('returns pixel values at pixel centres', () => {
    expect(s.sample(deg(latOf(1.5)), deg(lonOf(1.5)))).toBeCloseTo(110, 3)
  })

  it('interpolates bilinearly between pixel centres', () => {
    // Between centres (1,1) and (2,2): 10*1.5 + 100*1.5
    expect(s.sample(deg(latOf(2)), deg(lonOf(2)))).toBeCloseTo(165, 3)
  })

  it('returns null outside loaded tiles', () => {
    expect(s.sample(deg(10), deg(10))).toBeNull()
    expect(s.sample(deg(-10), deg(-90))).toBeNull()
  })

  it('reports bounds and resolution', () => {
    expect(s.bounds.west).toBeCloseTo(-180, 6)
    expect(s.bounds.east).toBeCloseTo(0, 6)
    expect(s.resolutionMeters).toBeGreaterThan(0)
  })
})

describe('AnalyticSampler', () => {
  it('wraps a function and respects bounds', () => {
    const a = new AnalyticSampler(
      (lat) => lat * 2,
      { north: deg(10), south: deg(0), east: deg(10), west: deg(0) },
    )
    expect(a.sample(deg(5), deg(5))).toBe(10)
    expect(a.sample(deg(20), deg(5))).toBeNull()
  })
})
