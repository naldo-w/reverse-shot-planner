# Implementation Plan

Each phase ends with `npm run verify` green and a commit. Failing tests are fixed, never skipped.

## Phase 0 — Audit & foundation ✅
- Empty repo → Vite + React + strict TS, Vitest, oxlint (template default), git.
- Dependency licence audit (see `ATTRIBUTIONS.md`).
- Shared contracts: `units.ts`, `types.ts`, `wgs84.ts`.
- Docs: this file, `ARCHITECTURE.md`, `TECHNICAL_NOTES.md`, `ATTRIBUTIONS.md`.

## Phase 1 — Domain geometry ✅
- Angles, geodesy, ECEF/ENU, camera FOV & gnomonic projection, camera presets.
- 114 tests incl. published references (Vincenty's Flinders Peak → Buninyong) and cross-module consistency tests (`tests/geometry.integration.test.ts`).

## Phase 2 — Astronomy ✅
Result: `CelestialEngine` with two adapters, both passing the shared conformance suite against 2,400 positions and 220 rise/set events generated from JPL DE421 with Skyfield (`scripts/ephemeris/`). Default: astronomy-engine (≤0.002°, ≤2 s). SunCalc: ≤0.014°, ≤11 s. Horizon-band accuracy is reported separately.

Original acceptance:
- `CelestialEngine` interface + `SuncalcEngine` adapter; SunCalc imported nowhere else.
- Sun/Moon position, rise/set events, Moon illumination, angular diameter from distance.
- Events computed for a **local** calendar day (SunCalc's moon times use the UTC day; HK is UTC+8).
- Reference fixtures from JPL Horizons (topocentric, airless *and* refracted) for Hong Kong and one high-latitude site, several dates across 2026–2027. Target tolerance: Sun ≤ 0.02°, Moon ≤ 0.05°. If SunCalc's Moon fails, add an `AstronomyEngineEngine` adapter (astronomy-engine, MIT) and make it the default — see TECHNICAL_NOTES §1.
- Expose both geometric (airless) and apparent altitude so the alignment model can apply one consistent refraction policy.

## Phase 3 — Terrain ✅
Delivered: `TerrariumProvider` (AWS Open Data Terrain Tiles, ~38 m at z12, IndexedDB + memory cache), `TileGridSampler` (bilinear), `MockTerrainProvider` for tests. Copernicus GLO-30 remains a planned alternative provider.

Original plan:
- `TerrainProvider` interface, `TerrainMetadata` (DTM/DSM, resolution, datum).
- First real provider: Copernicus GLO-30 via public cloud-optimised GeoTIFF tiles (no key) — confirm access/licence in Phase 3 kickoff; fallback: AWS Terrain Tiles (Terrarium PNG, Mapzen/Joerd, open licence).
- Bilinear elevation sampling on typed arrays; `MockTerrainProvider` with analytic surfaces (plane, cone hill, ridge, wall).
- IndexedDB tile cache keyed by `provider/dataset/z/x/y` + cache version.

## Phase 4 — Visibility ✅
Delivered: `calculateHorizonProfile` (curvature + terrestrial refraction k) and `rayVisibility`, tested on synthetic plane/hill/ridge/obstruction terrain.

Original plan:
- Ray casting in ENU using `LocalFrame`, curvature implicit, terrestrial refraction coefficient k as a parameter.
- `calculateHorizonProfile` (0.1° steps) — synthetic-terrain tests first.
- `VisibilityResult` with angular margin.

## Phase 5 — Reverse search (Worker) — in progress
Delivered first: location-first mode (spec §27) — `findAlignments` in a Web Worker (366 days < 1 s), daily rise/set, day/multi-day tracks, map alignment lines. Remaining: target-first search over an area with candidate grid.

Original plan:
- Candidate grid inside radius, coarse → fine subdivision.
- Per candidate: target look angle (static) → date loop over rise/set windows → golden-section time refinement on alignment error → visibility of target and of the body → transparent `AlignmentScore`.
- Pruning: a candidate can only ever align if target azimuth lies inside the body's annual rise/set azimuth band for that latitude; compute the band once and discard the rest before any date loop.

## Phase 6 — Map UI ✅ (v1)
MapLibre + OpenFreeMap (OSM data), click to set camera/landmark, preset spots, alignment lines, Nominatim search (throttled, cached).

Original plan:
MapLibre, OSM raster/vector style, terrain source, target by click/coordinates/geocoder (throttled Nominatim, cached), radius overlay, candidates as a GeoJSON layer, result list ↔ map linkage. Dark instrument-style UI.

## Phase 7 — Camera simulation ✅ (v1)
1px-outline SVG frame via exact gnomonic projection: terrain skyline, schematic structure outline, Sun/Moon to scale, day and multi-day paths, 1° scale bar.

Original plan:
Canvas viewport: horizon profile, target silhouette, body disc to scale, body trajectory, FOV frame.

## Phase 8 — UX polish
Loading/progress, errors, empty states, attribution panel, provider/resolution badge, sorting, URL state.

## Delegation model
The orchestrator owns contracts (`units`, `types`, interfaces) and integration; workers own disjoint files per phase with explicit acceptance criteria (tests, typecheck, lint). Cross-module integration tests are written by the orchestrator.
