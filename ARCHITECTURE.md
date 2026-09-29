# Architecture

Reverse Shot Planner answers one question: **where and when can this Sun/Moon composition occur?**
The search engine is the product; the map is its interface.

## Stack (Phase 0 audit)

The repository was empty, so the spec's default stack was adopted. Nothing was replaced.

| Concern | Choice | Version | License |
|---|---|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) | 6.0 | Apache-2.0 |
| Build | Vite | 8.3 | MIT |
| UI | React | 19.3 | MIT |
| Map renderer | MapLibre GL JS (Phase 6) | 6.11 | BSD-3-Clause |
| Astronomy | SunCalc, wrapped (Phase 2) | 2.0.2 | BSD-2-Clause |
| Tests | Vitest | 5.0 | MIT |
| Lint | oxlint (shipped with the Vite template; kept rather than adding ESLint) | 1.86 | MIT |

Scripts: `npm run verify` = typecheck → lint → test. Every phase must pass it before the next starts.

## Layering

```
┌──────────────────────── UI (React) ────────────────────────┐
│ features/*  components/*  app/*                             │  no math here
└───────────────┬─────────────────────────────▲───────────────┘
                │ postMessage (SearchRequest) │ results / progress
┌───────────────▼─────────────── workers/ ────┴───────────────┐
│ search.worker.ts (terrain + astronomy batch inside)          │
└───────────────┬──────────────────────────────────────────────┘
                │ pure function calls
┌───────────────▼──────────────── core/ ──────────────────────┐
│ search  →  visibility  →  terrain   astronomy   camera       │
│               ↓              ↓          ↓          ↓         │
│         coordinates (ECEF/ENU)   geometry (angles, geodesy)  │
│                      units.ts  types.ts  wgs84.ts            │
└───────────────┬──────────────────────────────────────────────┘
                │ interfaces only
┌───────────────▼──────────── providers/ ─────────────────────┐
│ terrain/ (Copernicus, SRTM, OpenTopography, LocalDEM, Mock)  │
│ geocoder/ (Nominatim, Photon, …)   maps/ (tile styles)       │
└──────────────────────────────────────────────────────────────┘
```

Rules:

1. `core/` never imports React, MapLibre, SunCalc, `fetch`, or a concrete provider. It is testable in plain Node.
2. SunCalc is imported in exactly one file (`core/astronomy/suncalcEngine.ts`, Phase 2) behind `CelestialEngine`.
3. Providers implement interfaces declared in `core/`; the UI selects a provider, the engine receives it.
4. Anything O(candidates × dates) runs in a Worker. The main thread renders and nothing else.
5. Mock/demo data is only available through explicitly named `Mock*` providers, and results carry the provider metadata so the UI can label them.

## Units and conventions

Defined in `src/core/units.ts`, `types.ts`, `wgs84.ts`.

- Branded `Degrees` / `Radians` / `Meters` / `Millimeters`. Trigonometry in radians; APIs and UI in degrees.
- Azimuth: 0 = north, clockwise, `[0, 360)`. Altitude: angle above the local horizontal plane (ellipsoid normal).
- Signed azimuth difference in `(-180, 180]`; positive = clockwise (right).
- Heights: ECEF/ENU maths is ellipsoidal. DEM heights are orthometric; see `TECHNICAL_NOTES.md` §3.
- Geometric look angles come from ECEF → ENU (`lookAngle`, `LocalFrame`), so Earth curvature is implicit. `LocalFrame` is the batched path for the search engine.

## Modules delivered in Phase 1

| Module | Responsibility |
|---|---|
| `core/units.ts` | Branded units, conversions |
| `core/types.ts` | Shared domain types (targets, horizon, celestial, camera) |
| `core/wgs84.ts` | Ellipsoid constants (single source) |
| `core/geometry/angles.ts` | Normalisation, wrap-safe differences, angular separation (Vincenty form), angular diameter, azimuth ranges |
| `core/geometry/geodesy.ts` | Vincenty inverse/direct, haversine, bearing, destination, curvature drop, local offsets, radius bounds |
| `core/coordinates/ecef.ts` | Geodetic ↔ ECEF (Bowring) |
| `core/coordinates/enu.ts` | ECEF ↔ ENU, horizontal direction, `lookAngle`, `LocalFrame` |
| `core/camera/fov.ts` | H/V/diagonal FOV, crop, inverse focal length |
| `core/camera/projection.ts` | Exact gnomonic projection direction ↔ normalised sensor coordinates, with roll |
| `data/cameraPresets.ts` | Sensor presets (data only; the engine does not depend on them) |

## Planned engine interfaces

```ts
interface CelestialEngine { getSunPosition; getMoonPosition; getSunEvents; getMoonEvents }   // Phase 2
interface TerrainProvider { getElevation; getElevationGrid; getTile; getMetadata }           // Phase 3
interface Geocoder { search(query): Promise<PlaceResult[]> }                                  // Phase 6
castRay(camera, target, terrain): VisibilityResult                                            // Phase 4
calculateHorizonProfile(camera, terrain, azStart, azEnd, step): HorizonProfile                 // Phase 4
runSearch(req: SearchRequest, onProgress): AsyncIterable<CandidateResult>                     // Phase 5
```
