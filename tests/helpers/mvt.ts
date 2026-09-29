/** Minimal Mapbox Vector Tile encoder for tests (extent 4096, string and number properties). */

import { PbfWriter } from 'pbf'

export type Props = Record<string, string | number>

export type MvtFeature =
  | { readonly kind: 'point'; readonly x: number; readonly y: number; readonly props: Props }
  | { readonly kind: 'line'; readonly pts: readonly (readonly [number, number])[]; readonly props: Props }
  | {
      readonly kind: 'rect'
      readonly x0: number
      readonly y0: number
      readonly x1: number
      readonly y1: number
      readonly props: Props
    }

export interface MvtLayer {
  readonly name: string
  readonly features: readonly MvtFeature[]
}

const zz = (n: number): number => (n << 1) ^ (n >> 31)

function geometry(f: MvtFeature): { type: number; cmds: number[] } {
  if (f.kind === 'point') return { type: 1, cmds: [9, zz(f.x), zz(f.y)] }
  if (f.kind === 'line') {
    const [first, ...rest] = f.pts
    if (!first) return { type: 2, cmds: [] }
    const cmds = [9, zz(first[0]), zz(first[1]), (rest.length << 3) | 2]
    let px = first[0]
    let py = first[1]
    for (const [x, y] of rest) {
      cmds.push(zz(x - px), zz(y - py))
      px = x
      py = y
    }
    return { type: 2, cmds }
  }
  return {
    type: 3,
    cmds: [
      9,
      zz(f.x0),
      zz(f.y0),
      (3 << 3) | 2,
      zz(0),
      zz(f.y1 - f.y0),
      zz(f.x1 - f.x0),
      zz(0),
      zz(0),
      zz(-(f.y1 - f.y0)),
      15,
    ],
  }
}

export function encodeTile(layers: readonly MvtLayer[]): ArrayBuffer {
  const w = new PbfWriter()
  for (const layer of layers) {
    const keys = [...new Set(layer.features.flatMap((f) => Object.keys(f.props)))]
    const values: (string | number)[] = []
    w.writeMessage(
      3,
      (_: null, p: PbfWriter) => {
        p.writeStringField(1, layer.name)
        for (const f of layer.features) {
          const tags: number[] = []
          for (const [k, v] of Object.entries(f.props)) {
            let vi = values.findIndex((x) => x === v)
            if (vi < 0) {
              vi = values.length
              values.push(v)
            }
            tags.push(keys.indexOf(k), vi)
          }
          const g = geometry(f)
          p.writeMessage(
            2,
            (_2: null, ff: PbfWriter) => {
              ff.writePackedVarint(2, tags)
              ff.writeVarintField(3, g.type)
              ff.writePackedVarint(4, g.cmds)
            },
            null,
          )
        }
        keys.forEach((k) => p.writeStringField(3, k))
        values.forEach((v) =>
          p.writeMessage(
            4,
            (_3: null, vw: PbfWriter) => (typeof v === 'string' ? vw.writeStringField(1, v) : vw.writeDoubleField(3, v)),
            null,
          ),
        )
        p.writeVarintField(5, 4096)
        p.writeVarintField(15, 2)
      },
      null,
    )
  }
  const bytes = w.finish()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const TILE_TEMPLATE = 'https://tiles.example/planet/20260101_000000_pt/{z}/{x}/{y}.pbf'

/** fetch stub serving TileJSON and the given tile bytes for every tile. */
export function fakeTileFetch(tile: ArrayBuffer, log: string[] = []): (url: string) => Promise<Response> {
  return (url) => {
    log.push(url)
    if (url === 'https://tiles.openfreemap.org/planet') {
      return Promise.resolve(new Response(JSON.stringify({ tiles: [TILE_TEMPLATE] }), { status: 200 }))
    }
    return Promise.resolve(new Response(tile.slice(0), { status: 200 }))
  }
}
