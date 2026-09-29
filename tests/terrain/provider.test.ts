import { describe, expect, it } from 'vitest'
import { TerrariumProvider, terrariumUrl } from '../../src/providers/terrain/terrariumProvider'
import { MockTerrainProvider } from '../../src/providers/terrain/mockProvider'
import { deg } from '../../src/core/units'

describe('TerrariumProvider', () => {
  it('has correct metadata', () => {
    const md = new TerrariumProvider().getMetadata()
    expect(md.provider).toBe('AWS Terrain Tiles (Mapzen)')
    expect(md.surfaceType).toBe('DTM')
    expect(md.resolutionMeters).toBeCloseTo(38.2, 0)
  })

  it('builds the AWS URL', () => {
    expect(terrariumUrl(12, 3347, 1786)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/3347/1786.png',
    )
  })

  it('loads tiles once, caches in memory, and returns a sampler', async () => {
    const urls: string[] = []
    const p = new TerrariumProvider({
      useIndexedDb: false,
      fetchImpl: (url) => {
        urls.push(url)
        return Promise.resolve(new Response(new Blob([new Uint8Array([1])]), { status: 200 }))
      },
      decodeImpl: () => Promise.resolve(new Float32Array(256 * 256).fill(123)),
    })
    const b = { north: deg(22.36), south: deg(22.34), east: deg(114.2), west: deg(114.17) }
    const sampler = await p.loadArea(b, 12)
    expect(sampler.sample(deg(22.35), deg(114.18))).toBe(123)
    const n = urls.length
    await p.loadArea(b, 12)
    expect(urls.length).toBe(n)
    expect(await p.getElevation(deg(22.35), deg(114.18))).toBe(123)
  })

  it('rejects on HTTP errors', async () => {
    const p = new TerrariumProvider({
      useIndexedDb: false,
      fetchImpl: () => Promise.resolve(new Response('no', { status: 404 })),
      decodeImpl: () => Promise.resolve(new Float32Array(0)),
    })
    await expect(p.getElevation(deg(0), deg(0))).rejects.toThrow(/404/)
  })
})

describe('MockTerrainProvider', () => {
  it('is labelled as mock', async () => {
    const p = new MockTerrainProvider(() => 5)
    expect(p.getMetadata().provider).toBe('MOCK (tests only)')
    expect(p.getMetadata().surfaceType).toBe('UNKNOWN')
    expect(await p.getElevation(deg(1), deg(1))).toBe(5)
  })
})
