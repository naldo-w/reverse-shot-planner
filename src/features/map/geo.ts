/** Pure GeoJSON builders for the map layers. */

export interface LatLon {
  readonly lat: number
  readonly lon: number
}

export interface MapSpot extends LatLon {
  readonly id: string
  readonly name: string
}

export interface MapLine {
  readonly body: 'sun' | 'moon'
  readonly kind: 'rise' | 'set'
  readonly label: string
  readonly from: LatLon
  readonly to: LatLon
}

export interface FeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly unknown[]
}

const collection = (features: unknown[]): FeatureCollection => ({ type: 'FeatureCollection', features })

const lngLat = (p: LatLon): [number, number] => [p.lon, p.lat]

export function losCollection(camera: LatLon, landmark: LatLon): FeatureCollection {
  return collection([
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [lngLat(camera), lngLat(landmark)] },
    },
  ])
}

export function spotsCollection(spots: readonly MapSpot[], selectedId: string): FeatureCollection {
  return collection(
    spots.map((s) => ({
      type: 'Feature',
      properties: { id: s.id, name: s.name, selected: s.id === selectedId },
      geometry: { type: 'Point', coordinates: lngLat(s) },
    })),
  )
}

export function alignLinesCollection(lines: readonly MapLine[]): FeatureCollection {
  return collection(
    lines.map((l) => ({
      type: 'Feature',
      properties: { body: l.body, kind: l.kind },
      geometry: { type: 'LineString', coordinates: [lngLat(l.from), lngLat(l.to)] },
    })),
  )
}

export function alignLabelsCollection(lines: readonly MapLine[]): FeatureCollection {
  return collection(
    lines.map((l) => ({
      type: 'Feature',
      properties: { body: l.body, kind: l.kind, label: l.label },
      geometry: { type: 'Point', coordinates: lngLat(l.to) },
    })),
  )
}

export const RISE_COLOR = '#58a6ff'
export const SET_COLOR = '#d29922'
