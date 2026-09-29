/**
 * OSM features that say where a person can plausibly stand, from OpenFreeMap
 * vector tiles (OpenMapTiles schema, zoom 14):
 *  - transportation: footways / paths / steps / cycleways / tracks -> 'path';
 *    minor and service roads -> 'minor-road'; tertiary / secondary / primary -> 'road'.
 *    Motorway, trunk, rail, ferry, busway, raceway etc. are excluded, so are
 *    tunnels (brunnel = tunnel), driveways and access = no / private.
 *    brunnel = bridge stays (a bridge is accessible).
 *  - park (class park), landuse (park, recreation_ground, garden, playground,
 *    village_green) and landcover (grass whose subclass is park / garden /
 *    recreation_ground / village_green): public open space polygons. Country
 *    park / nature reserve polygons are NOT used: their interior is not
 *    necessarily walkable (their trails come in through transportation).
 *  - poi: viewpoint and attraction -> 'viewpoint'; park, playground, garden and
 *    pier -> 'park'.
 *  - water polygons, to drop non-bridge points that fall in the sea or a lake.
 *  - transportation_name: road names, matched to a point on demand.
 *
 * Accessibility is inferred from tags only: private land, fences and opening
 * hours are not known. Data © OpenStreetMap contributors (ODbL).
 */

import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import type { VectorTileFeature } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { TileId } from '../../core/terrain/tiles'
import type {
  AccessArea,
  AccessFeatures,
  AccessLine,
  AccessPoi,
  LonLat,
  NamedLine,
} from '../../core/search/access'
import { loadTiles, tilePointToLonLat } from './tiles'
import type { TileFetchOptions } from './tiles'

const PATH_SUBCLASSES = new Set(['path', 'footway', 'pedestrian', 'steps', 'cycleway', 'bridleway'])
const PATH_CLASSES = new Set(['path', 'track'])
const MINOR_CLASSES = new Set(['minor', 'service'])
const ROAD_CLASSES = new Set(['tertiary', 'secondary', 'primary'])
const PRIVATE_ACCESS = new Set(['no', 'private'])
const PRIVATE_SERVICE = new Set(['driveway'])
const OPEN_LANDUSE = new Set(['park', 'recreation_ground', 'garden', 'playground', 'village_green'])
const OPEN_LANDCOVER_SUBCLASS = new Set(['park', 'garden', 'recreation_ground', 'village_green'])
const VIEWPOINT_POI = new Set(['viewpoint', 'attraction'])
const PARK_POI = new Set(['park', 'playground', 'garden', 'pier'])

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function lineKind(p: VectorTileFeature['properties']): AccessLine['kind'] | null {
  const cls = str(p['class'])
  if (!cls) return null
  const brunnel = str(p['brunnel'])
  if (brunnel === 'tunnel') return null
  if (PRIVATE_ACCESS.has(str(p['access']) ?? '')) return null
  if (cls === 'service' && PRIVATE_SERVICE.has(str(p['service']) ?? '')) return null
  if (PATH_CLASSES.has(cls)) {
    const sub = str(p['subclass'])
    return cls === 'path' && sub !== undefined && !PATH_SUBCLASSES.has(sub) ? null : 'path'
  }
  if (MINOR_CLASSES.has(cls)) return 'minor-road'
  if (ROAD_CLASSES.has(cls)) return 'road'
  return null
}

function nameOf(p: VectorTileFeature['properties']): string | undefined {
  return str(p['name']) ?? str(p['name_en']) ?? str(p['name:latin'])
}

function areaFrom(f: VectorTileFeature, t: TileId, name: string | undefined, out: AccessArea[]): void {
  for (const poly of classifyRings(f.loadGeometry())) {
    const rings = poly
      .filter((r) => r.length >= 4)
      .map((r): LonLat[] => r.map((pt) => tilePointToLonLat(t, pt.x, pt.y, f.extent)))
    if (rings.length > 0) out.push({ ...(name === undefined ? {} : { name }), rings })
  }
}

/** Decode every layer this module uses from one tile. Empty bytes give an empty set. */
export function decodeFeatureTile(bytes: ArrayBuffer, t: TileId): AccessFeatures {
  const lines: AccessLine[] = []
  const areas: AccessArea[] = []
  const water: AccessArea[] = []
  const pois: AccessPoi[] = []
  const names: NamedLine[] = []
  if (bytes.byteLength === 0) return { lines, areas, water, pois, names }
  const tile = new VectorTile(new PbfReader(bytes))

  const each = (layer: string, fn: (f: VectorTileFeature) => void): void => {
    const l = tile.layers[layer]
    if (!l) return
    for (let i = 0; i < l.length; i++) fn(l.feature(i))
  }

  each('transportation', (f) => {
    if (f.type !== 2) return
    const kind = lineKind(f.properties)
    if (!kind) return
    const bridge = str(f.properties['brunnel']) === 'bridge'
    for (const line of f.loadGeometry()) {
      if (line.length < 2) continue
      lines.push({ kind, bridge, coords: line.map((p) => tilePointToLonLat(t, p.x, p.y, f.extent)) })
    }
  })

  each('transportation_name', (f) => {
    if (f.type !== 2) return
    const name = nameOf(f.properties)
    if (!name || str(f.properties['brunnel']) === 'tunnel') return
    for (const line of f.loadGeometry()) {
      if (line.length >= 2) names.push({ name, coords: line.map((p) => tilePointToLonLat(t, p.x, p.y, f.extent)) })
    }
  })

  each('park', (f) => {
    if (f.type !== 3) return
    const cls = str(f.properties['class'])
    if (cls !== undefined && cls !== 'park') return
    areaFrom(f, t, nameOf(f.properties), areas)
  })

  each('landuse', (f) => {
    if (f.type !== 3 || !OPEN_LANDUSE.has(str(f.properties['class']) ?? '')) return
    areaFrom(f, t, nameOf(f.properties), areas)
  })

  each('landcover', (f) => {
    if (f.type !== 3 || str(f.properties['class']) !== 'grass') return
    if (!OPEN_LANDCOVER_SUBCLASS.has(str(f.properties['subclass']) ?? '')) return
    areaFrom(f, t, nameOf(f.properties), areas)
  })

  each('water', (f) => {
    if (f.type === 3) areaFrom(f, t, undefined, water)
  })

  each('poi', (f) => {
    if (f.type !== 1) return
    const sub = str(f.properties['subclass'])
    const cls = str(f.properties['class'])
    const kind: AccessPoi['kind'] | null =
      (sub && VIEWPOINT_POI.has(sub)) || (cls && VIEWPOINT_POI.has(cls))
        ? 'viewpoint'
        : (sub && PARK_POI.has(sub)) || (cls && PARK_POI.has(cls))
          ? 'park'
          : null
    if (!kind) return
    const name = nameOf(f.properties)
    for (const pts of f.loadGeometry()) {
      const p = pts[0]
      if (!p) continue
      const [lon, lat] = tilePointToLonLat(t, p.x, p.y, f.extent)
      pois.push({ kind, lon, lat, ...(name === undefined ? {} : { name }) })
    }
  })

  return { lines, areas, water, pois, names }
}

export interface OsmFeatureLoad {
  readonly features: AccessFeatures
  readonly tilesRequested: number
  readonly tilesFailed: number
}

/** Fetch and decode the given z14 tiles. Throws only if every tile failed. */
export async function loadOsmFeatures(tiles: readonly TileId[], opts: TileFetchOptions = {}): Promise<OsmFeatureLoad> {
  const results = await loadTiles(tiles, opts, decodeFeatureTile)
  const ok = results.filter((r): r is AccessFeatures => r !== null)
  return {
    features: {
      lines: ok.flatMap((r) => r.lines),
      areas: ok.flatMap((r) => r.areas),
      water: ok.flatMap((r) => r.water),
      pois: ok.flatMap((r) => r.pois),
      names: ok.flatMap((r) => r.names),
    },
    tilesRequested: tiles.length,
    tilesFailed: results.length - ok.length,
  }
}
