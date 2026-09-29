import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
} from 'maplibre-gl'
import {
  alignLabelsCollection,
  alignLinesCollection,
  losCollection,
  RISE_COLOR,
  SET_COLOR,
  spotsCollection,
  type FeatureCollection,
  type LatLon,
  type MapLine,
  type MapSpot,
} from './geo'

const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'
const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty'
const FONT = ['Noto Sans Regular']

export interface MapViewProps {
  readonly landmark: LatLon
  readonly camera: LatLon
  readonly landmarkLabel: string
  readonly cameraLabel: string
  readonly spots: readonly MapSpot[]
  readonly selectedSpotId: string
  readonly lines: readonly MapLine[]
  readonly focusSeq: number
  /** Plain map click (behaviour chosen by the parent's click mode). */
  readonly onClickPoint: (lat: number, lon: number) => void
  readonly onSelectSpot: (id: string) => void
  readonly onMoveCamera: (lat: number, lon: number) => void
  readonly onMoveLandmark: (lat: number, lon: number) => void
}

function makeMarker(kind: 'camera' | 'landmark', label: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `mk mk-${kind}`
  el.title = label
  el.setAttribute('aria-label', label)
  el.addEventListener('click', (e) => e.stopPropagation())
  return el
}

function setData(map: MapLibreMap, id: string, data: FeatureCollection): void {
  const src = map.getSource(id) as GeoJSONSource | undefined
  src?.setData(data as Parameters<GeoJSONSource['setData']>[0])
}

export default function MapView(props: MapViewProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const camMarker = useRef<Marker | null>(null)
  const lmMarker = useRef<Marker | null>(null)
  const latest = useRef(props)
  const lastFocus = useRef(props.focusSeq)
  const apply = useRef<() => void>(() => undefined)

  useEffect(() => {
    latest.current = props
  })

  // ---- create once
  useEffect(() => {
    const el = host.current
    if (!el) return
    const p = latest.current
    const bounds = new LngLatBounds([p.landmark.lon, p.landmark.lat], [p.landmark.lon, p.landmark.lat])
    bounds.extend([p.camera.lon, p.camera.lat])
    const map = new MapLibreMap({
      container: el,
      style: STYLE_DARK,
      bounds,
      fitBoundsOptions: { padding: 50, maxZoom: 13 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(
      new AttributionControl({
        compact: false,
        customAttribution: ['OpenFreeMap © OpenMapTiles', 'Data © OpenStreetMap contributors'],
      }),
      'bottom-right',
    )

    const cam = new Marker({ element: makeMarker('camera', p.cameraLabel), draggable: true })
      .setLngLat([p.camera.lon, p.camera.lat])
      .addTo(map)
    const lm = new Marker({ element: makeMarker('landmark', p.landmarkLabel), draggable: true })
      .setLngLat([p.landmark.lon, p.landmark.lat])
      .addTo(map)
    camMarker.current = cam
    lmMarker.current = lm
    cam.on('dragend', () => {
      const ll = cam.getLngLat()
      latest.current.onMoveCamera(ll.lat, ll.lng)
    })
    lm.on('dragend', () => {
      const ll = lm.getLngLat()
      latest.current.onMoveLandmark(ll.lat, ll.lng)
    })

    const ensureLayers = () => {
      const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
      for (const id of ['los', 'spots', 'aligns', 'align-labels']) {
        if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty as never })
      }
      const byKind = ['match', ['get', 'kind'], 'rise', RISE_COLOR, SET_COLOR] as never
      if (!map.getLayer('los')) {
        map.addLayer({
          id: 'los',
          type: 'line',
          source: 'los',
          paint: { 'line-color': '#e6edf3', 'line-width': 1, 'line-opacity': 0.85 },
        })
      }
      if (!map.getLayer('aligns-sun')) {
        map.addLayer({
          id: 'aligns-sun',
          type: 'line',
          source: 'aligns',
          filter: ['==', ['get', 'body'], 'sun'],
          paint: { 'line-color': byKind, 'line-width': 1 },
        })
      }
      if (!map.getLayer('aligns-moon')) {
        map.addLayer({
          id: 'aligns-moon',
          type: 'line',
          source: 'aligns',
          filter: ['==', ['get', 'body'], 'moon'],
          paint: { 'line-color': byKind, 'line-width': 1, 'line-dasharray': [3, 2] },
        })
      }
      if (!map.getLayer('align-labels')) {
        map.addLayer({
          id: 'align-labels',
          type: 'symbol',
          source: 'align-labels',
          layout: {
            'text-field': ['get', 'label'],
            'text-font': FONT,
            'text-size': 11,
            'text-anchor': 'bottom',
            'text-offset': [0, -0.3],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': byKind,
            'text-halo-color': '#0d1117',
            'text-halo-width': 1.5,
          },
        })
      }
      if (!map.getLayer('spots')) {
        map.addLayer({
          id: 'spots',
          type: 'circle',
          source: 'spots',
          paint: {
            'circle-radius': 4,
            'circle-color': '#0d1117',
            'circle-stroke-width': 1,
            'circle-stroke-color': ['case', ['get', 'selected'], '#d29922', '#8b949e'],
          },
        })
      }
    }

    apply.current = () => {
      const q = latest.current
      cam.setLngLat([q.camera.lon, q.camera.lat])
      lm.setLngLat([q.landmark.lon, q.landmark.lat])
      cam.getElement().title = q.cameraLabel
      lm.getElement().title = q.landmarkLabel
      if (!map.getSource('los')) return
      setData(map, 'los', losCollection(q.camera, q.landmark))
      setData(map, 'spots', spotsCollection(q.spots, q.selectedSpotId))
      setData(map, 'aligns', alignLinesCollection(q.lines))
      setData(map, 'align-labels', alignLabelsCollection(q.lines))
    }

    let fellBack = false
    let styleLoaded = false
    map.on('style.load', () => {
      styleLoaded = true
      ensureLayers()
      apply.current()
    })
    map.on('error', () => {
      // Primary style unreachable before it ever loaded → try the fallback once.
      if (!fellBack && !styleLoaded) {
        fellBack = true
        map.setStyle(STYLE_FALLBACK)
      }
    })
    map.on('click', (e) => {
      if (map.getLayer('spots')) {
        const hit = map.queryRenderedFeatures(
          [
            [e.point.x - 6, e.point.y - 6],
            [e.point.x + 6, e.point.y + 6],
          ],
          { layers: ['spots'] },
        )[0]
        const id = hit?.properties?.['id']
        if (typeof id === 'string') {
          latest.current.onSelectSpot(id)
          return
        }
      }
      latest.current.onClickPoint(e.lngLat.lat, e.lngLat.lng)
    })
    map.getCanvas().style.cursor = 'crosshair'

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      cam.remove()
      lm.remove()
      map.remove()
      mapRef.current = null
      camMarker.current = null
      lmMarker.current = null
      apply.current = () => undefined
    }
  }, [])

  // ---- data updates
  const { camera, landmark, spots, selectedSpotId, lines, cameraLabel, landmarkLabel } = props
  useEffect(() => {
    apply.current()
  }, [camera.lat, camera.lon, landmark.lat, landmark.lon, spots, selectedSpotId, lines, cameraLabel, landmarkLabel])

  // ---- re-frame on selection changes (not on plain map clicks)
  useEffect(() => {
    if (props.focusSeq === lastFocus.current) return
    lastFocus.current = props.focusSeq
    const map = mapRef.current
    if (!map) return
    const b = new LngLatBounds([landmark.lon, landmark.lat], [landmark.lon, landmark.lat])
    b.extend([camera.lon, camera.lat])
    map.fitBounds(b, { padding: 50, maxZoom: 13, duration: 0 })
  }, [props.focusSeq, camera.lat, camera.lon, landmark.lat, landmark.lon])

  return <div ref={host} className="map-host" />
}
