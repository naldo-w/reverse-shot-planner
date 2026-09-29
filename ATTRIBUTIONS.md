# Attributions

Every external dependency and data source used by Reverse Shot Planner. Update this file in the same commit that adds a dependency or data source.

## Runtime libraries

| Package | Use | License | Source |
|---|---|---|---|
| React / React DOM | UI | MIT | https://github.com/facebook/react |
| MapLibre GL JS | Map renderer (Phase 6) | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js |
| astronomy-engine | Default Sun/Moon engine, wrapped behind `CelestialEngine` | MIT, © Don Cross | https://github.com/cosinekitty/astronomy |
| SunCalc | Alternative Sun/Moon engine, wrapped behind `CelestialEngine` | BSD-2-Clause, © Volodymyr Agafonkin | https://github.com/mourner/suncalc |

## Development tools

| Package | License |
|---|---|
| TypeScript | Apache-2.0 |
| Vite, @vitejs/plugin-react | MIT |
| Vitest | MIT |
| oxlint | MIT |
| Skyfield (Python, fixture generation only) | MIT |
| skyfield-data (Python, fixture generation only) | MIT |

## Algorithms (independently implemented)

- Vincenty, T. (1975). *Direct and inverse solutions of geodesics on the ellipsoid.* Survey Review 23(176).
- Bowring, B. R. (1976). Transformation from spatial to geographical coordinates. Survey Review 23(181).
- WGS84 parameters: NIMA TR8350.2.
- Meeus, J. *Astronomical Algorithms* (refraction and parallax formulas, via SunCalc).
- Bennett, G. G. (1982). The calculation of astronomical refraction in marine navigation. J. Navigation 35(2) — refraction model.

## Reference data (tests only)

| Source | Use | License |
|---|---|---|
| JPL DE421 planetary ephemeris (NASA/JPL), via skyfield-data | Generates `tests/fixtures/ephemeris.json` | Public domain (US Government work) |
| IERS Earth orientation data (finals2000A), via skyfield-data | Time scales for fixtures | IERS, free use with attribution |

## Data sources (planned — not yet in use)

| Source | Purpose | License / terms | Attribution text |
|---|---|---|---|
| OpenStreetMap | Base map, geocoding | ODbL 1.0 | © OpenStreetMap contributors |
| Nominatim (public) | Geocoding, low volume only | OSMF usage policy (≤1 req/s, valid UA, caching) | Data © OpenStreetMap contributors |
| Copernicus DEM GLO-30 | Terrain | Copernicus DEM licence (free, attribution required) — confirm in Phase 3 | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA |
| SRTM GL1 / NASADEM | Terrain fallback | Public domain (NASA/USGS) | NASA SRTM / NASADEM |

## Fonts and icons

None yet. System font stack only.

## Not used

No code from PhotoPills, The Photographer's Ephemeris, PlanIt!, Sun Surveyor or any other commercial tool. No Google Maps, Mapbox proprietary services, Apple MapKit, or Google 3D Tiles.
