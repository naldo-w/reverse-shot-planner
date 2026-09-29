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
| Astronomy (default) | astronomy-engine, wrapped | 2.1.19 | MIT |
| Astronomy (alternative) | SunCalc, wrapped | 2.0.2 | BSD-2-Clause |
| Reference ephemeris (tests only) | Skyfield + JPL DE421 via skyfield-data (Python, offline) | 1.55 / 7.0.0 | MIT / public domain |
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
2. Astronomy libraries are imported only inside `core/astronomy/engines/`, behind `CelestialEngine`; application code imports `core/astronomy/index.ts`.
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
| `core/astronomy/types.ts` | `CelestialEngine` contract: geometric (airless) topocentric positions, upper-limb rise/set events, Moon phase |
| `core/astronomy/refraction.ts` | Bennett refraction with temperature/pressure — applied explicitly, never inside engines |
| `core/astronomy/engines/*` | `AstronomyEngineEngine` (default), `SuncalcEngine` |
| `core/astronomy/index.ts` | Engine factory and convenience wrappers |
| `tests/astronomy/conformance.ts` | Shared accuracy suite every engine must pass against DE421 fixtures |

## Planned engine interfaces

```ts
interface CelestialEngine { getPosition(body, t, obs); findEvents(body, obs, start, end); getMoonPhase(t) }   // Phase 2 ✅
interface TerrainProvider { getElevation; getElevationGrid; getTile; getMetadata }           // Phase 3
interface Geocoder { search(query): Promise<PlaceResult[]> }                                  // Phase 6
castRay(camera, target, terrain): VisibilityResult                                            // Phase 4
calculateHorizonProfile(camera, terrain, azStart, azEnd, step): HorizonProfile                 // Phase 4
runSearch(req: SearchRequest, onProgress): AsyncIterable<CandidateResult>                     // Phase 5
```
