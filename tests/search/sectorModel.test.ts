import { describe, expect, it } from 'vitest'
import type { SectorCell } from '../../src/core/search/sectors'
import { deg, m } from '../../src/core/units'
import {
  compositionOffset,
  DEFAULT_SECTOR_PARAMS,
  fanGroups,
  fillOpacity,
  groupByDate,
  paletteColor,
  sectorCollection,
  sectorEdgesCollection,
  sectorRange,
  summarize,
  topCells,
} from '../../src/features/sectors/sectorModel'

function cell(bearing: number, err: number, iso: string, visible: boolean | null = null): SectorCell {
  return {
    bearing: deg(bearing),
    distance: m(5000),
    bearingHalfWidth: deg(0.125),
    distanceInner: m(4500),
    distanceOuter: m(5500),
    lat: deg(22.3),
    lon: deg(114.2),
    groundHeight: 10,
    visible,
    best: {
      time: new Date(iso),
      offsetError: deg(err),
      bodyAzimuth: deg(bearing + 180),
      bodyApparentAltitude: deg(2),
      targetApparentAltitude: deg(2),
      direction: 'setting',
    },
  }
}

describe('sector model', () => {
  it('composition offsets and local-day ranges', () => {
    expect(compositionOffset({ ...DEFAULT_SECTOR_PARAMS, composition: 'centred' })).toBe(0)
    expect(compositionOffset({ ...DEFAULT_SECTOR_PARAMS, composition: 'above' })).toBe(0.26)
    expect(compositionOffset({ ...DEFAULT_SECTOR_PARAMS, composition: 'custom', customOffset: -0.4 })).toBe(-0.4)
    // 2027-03-05 18:30 HKT is 10:30Z; the local day starts at 2027-03-04T16:00Z.
    const r = sectorRange(Date.parse('2027-03-05T10:30:00Z'), 480, '30')
    expect(r.start.toISOString()).toBe('2027-03-04T16:00:00.000Z')
    expect(r.end.getTime() - r.start.getTime()).toBe(30 * 86_400_000)
    expect(sectorRange(Date.parse('2027-03-05T10:30:00Z'), 480, 'day').end.toISOString()).toBe('2027-03-05T16:00:00.000Z')
  })

  it('palette is sequential and fill opacity falls with error', () => {
    expect(paletteColor(0)).toBe('#79e0ee')
    expect(paletteColor(1)).toBe('#ff8a5b')
    expect(paletteColor(-3)).toBe('#79e0ee')
    expect(paletteColor(Number.NaN)).toBe('#79e0ee')
    expect(fillOpacity(0, 0.5)).toBeCloseTo(0.6)
    expect(fillOpacity(0.5, 0.5)).toBeCloseTo(0.15)
    expect(fillOpacity(0.25, 0.5)).toBeCloseTo(0.375)
  })

  it('builds polygons coloured by date, hidden cells flagged', () => {
    const cells = [
      cell(90, 0, '2027-01-01T10:00:00Z'),
      cell(91, 0.2, '2027-07-01T10:00:00Z', false),
    ]
    const fc = sectorCollection(cells, {
      landmark: { lat: 22.3531, lon: 114.18707 },
      startMs: Date.parse('2027-01-01T00:00:00Z'),
      endMs: Date.parse('2028-01-01T00:00:00Z'),
      tolerance: 0.5,
    })
    const [a, b] = fc.features as { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[]
    expect(a!.properties['i']).toBe(0)
    expect(a!.properties['h']).toBe(0)
    expect(b!.properties['h']).toBe(1)
    expect(a!.properties['color']).not.toBe(b!.properties['color'])
    expect(a!.geometry.coordinates[0]!.length).toBeGreaterThanOrEqual(5)
  })

  it('edge rays: two per fan, split at gaps, merged through north', () => {
    const lm = { lat: 22.3531, lon: 114.18707 }
    const two = [50, 50.25, 51, 250, 251].map((b) => cell(b, 0, '2027-01-01T10:00:00Z'))
    expect(fanGroups(two)).toHaveLength(2)
    expect(sectorEdgesCollection(two, lm).features).toHaveLength(4)
    const wrap = [358, 359, 0, 1, 2].map((b) => cell(b, 0, '2027-01-01T10:00:00Z'))
    expect(fanGroups(wrap)).toHaveLength(1)
    expect(sectorEdgesCollection([], lm).features).toHaveLength(0)
  })

  it('top cells by |error|, grouped by local date, and summary', () => {
    const cells = [
      cell(80, 0.3, '2027-01-02T10:00:00Z'),
      cell(81, -0.01, '2027-01-03T10:00:00Z'),
      cell(82, 0.02, '2027-01-03T09:00:00Z'),
      cell(83, 0.4, '2027-01-04T10:00:00Z'),
    ]
    const top = topCells(cells, 3)
    expect(top.map((c) => c.bearing)).toEqual([81, 82, 80])
    const groups = groupByDate(top, 480)
    expect(groups.map((g) => g.date)).toEqual(['2027-01-02', '2027-01-03'])
    expect(groups[1]!.cells.map((c) => c.bearing)).toEqual([82, 81])
    const s = summarize(cells)!
    expect(s.count).toBe(4)
    expect(s.bearingMin).toBe(80)
    expect(s.bearingMax).toBe(83)
    expect(s.distanceMaxKm).toBe(5)
    expect(summarize([])).toBeNull()
  })
})
