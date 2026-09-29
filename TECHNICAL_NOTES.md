# Technical Notes & Risks

Uncertainties are recorded here as they are found. Each item says what is known, what is not, and when it will be resolved.

## 1. Astronomy accuracy (RESOLVED in Phase 2)

**Resolution.** Both engines were measured against JPL DE421 via Skyfield (fixtures in `tests/fixtures/ephemeris.json`, 5 sites from −34° to +70° latitude, 3 seasons). Max errors, geometric topocentric:

| Engine | Sun az·cos(alt) / alt | Moon az·cos(alt) / alt | Sun events | Moon events |
|---|---|---|---|---|
| astronomy-engine 2.1.19 | 0.0007° / 0.0007° | 0.0017° / 0.0017° | 2.0 s | 1.3 s |
| SunCalc 2.0.2 | 0.0077° / 0.0100° | 0.0070° / 0.0135° | 4.2 s | 10.4 s |

astronomy-engine is the default (10k Moon positions ≈ 150 ms). The skyfield generator itself agrees with a JPL Horizons point to 1.6″.

Azimuth error is measured as |Δaz|·cos(alt) over |alt| < 85°: raw azimuth is ill-conditioned near zenith/nadir (an early suite version reported a 0.42° "error" at alt −89.4°). In the −2°…+15° horizon band raw |Δaz| is asserted too.

Original analysis:

SunCalc **2.x** differs from 1.x: angles are degrees, azimuth is north-based clockwise (1.x: radians, south-based). Any 1.x snippet copied from the web will be wrong by 180°.

Findings from reading `node_modules/suncalc/index.js` (v2.0.2):
- Moon altitude includes topocentric parallax (Meeus ch. 40) with a spherical Earth, altitude only. Azimuth parallax (small, ≲0.01° at HK latitude) is ignored.
- Returned altitudes are **apparent** (Meeus 16.4 refraction added). The refraction term clamps negative altitudes to 0, so for bodies below the geometric horizon — common when the camera is on a summit — the correction is ~0.48°, not the true value.
- The Moon uses a low-precision orbital theory. Error of a few arcminutes is plausible; our alignment tolerances are 0.05–0.5°.

Decision: the engine will compare **geometric** body altitude with **geometric** target altitude, then add refraction consistently (celestial refraction for the body, terrestrial k·d/2R for the target) as a separate, visible step. Phase 2 must validate against JPL Horizons fixtures; if the Moon misses 0.05°, adopt `astronomy-engine` (MIT) behind the same `CelestialEngine` interface.

## 2. Moon rise/set day boundaries

`SunCalc.getMoonTimes` searches the **UTC** calendar day. For Hong Kong (UTC+8) a local-day search must query two UTC days and filter. Handle in the adapter, test at 00:00–08:00 local.

## 3. Height datums

ECEF/ENU uses ellipsoidal height. DEMs (Copernicus: EGM2008; SRTM: EGM96) give orthometric height. For a camera and target a few km apart the geoid undulation N is nearly identical at both ends, so feeding orthometric heights into both yields look-angle errors of order ΔN/d (≈0.1 m / 10 km ≈ 0.0006°) — negligible. Mixing datums (ellipsoidal camera, orthometric target) would cause errors up to |N|/d (HK N ≈ −3 m → ~0.02° at 10 km). Rule: every height entering one computation must share a datum; `TerrainMetadata.verticalDatum` is mandatory for real providers.

## 4. Normal-section vs geodesic azimuth

`lookAngle` gives the normal-section azimuth (what a level camera sees); `initialBearing` gives the geodesic azimuth. They agree within 1e-5° up to 50 km (integration test). The engine uses `lookAngle` for photography; `initialBearing` is for map drawing only.

## 5. DEM ≠ photographic skyline

30 m DTM/DSM smooths summits: a sharp peak can read 5–20 m low, shifting its apparent altitude by ~0.05° at 10 km. Vegetation and buildings are absent in DTMs and only partly present in DSMs. Results must show provider, dataset, resolution and surface type, and should present alignment error with an uncertainty band once Phase 4 exists.

## 6. Terrestrial refraction

Coefficient k varies 0.07–0.25 by day/night and inversions, and is large over water at dawn. It is a parameter (default 0.13), never hidden. At 20 km, changing k from 0.13 to 0.2 moves a target by ~0.006°.

## 7. Performance budget (to measure in Phase 5, not before)

100k candidates × 180 days naively = 18M position evaluations. Planned cuts: annual azimuth-band pruning (§ Phase 5 plan), evaluating only rise/set windows, coarse grid first. `LocalFrame` exists so the inner loop avoids repeated trig on the origin.

## 8. Test reference values

The orchestrator's original 400 mm FOV expectations were wrong (5.1550°/6.1924°); exact values are H 5.1531°, D 6.1915° (2·atan(18/400), 2·atan(21.633/400)). Tests use the exact values. The Flinders→Buninyong final azimuth reference is 307°10′25.07″ (forward convention).

## 9. Reference ephemeris access (superseded — see §1)

- The workspace shell cannot reach `ssd.jpl.nasa.gov` (network allowlist). Horizons is reachable through the WebFetch tool, but WebFetch caches/collapses query strings: six different queries returned identical rows. Only the first response is trusted.
- Trusted point — Moon, topocentric airless, site 114.18°E 22.35°N h=0, 2026-10-06 06:00 UT: Horizons az 281.247717°, el 15.734218°. SunCalc 2.0.2 gives az 281.244°, apparent el 15.800° (≈ airless + 0.06° refraction, as expected at 15.8°). Azimuth agrees to 0.004°.
- Resolved differently, per the owner's request for open-source data: fixtures are generated offline with Skyfield (MIT) and the DE421 kernel shipped in the `skyfield-data` PyPI package (the `de421` PyPI package's installer is broken on current setuptools and holds an obsolete .npy format). Reproduce: `pip install skyfield==1.55 skyfield-data==7.0.0 && python3 scripts/ephemeris/generate_fixtures.py`.

## 11. Preset coordinates (open issue)

Landmark coordinates are sourced (Wikipedia); shooting-spot coordinates are approximate (OSM/Nominatim/Overpass could not be queried from the build environment: permission prompt timeout, robots.txt). The Danjiang Bridge point is the bridge's published coordinate, not the surveyed pylon; at 3 km, a 200 m error is ~4° of azimuth. Cross-check with the Central Weather Administration sunset seasons: the Tamsui-side spots give pylon bearings 274–285° (consistent with CWA's Mar–Oct windows), but the Bali-side spot gives 352°, inconsistent with CWA's June window — the Bali spot and/or pylon position must be corrected on the map. Alignment results are always computed for the exact points currently set.

## 10. astronomy-engine rise/set and observer height

`SearchRiseSet` derives horizon dip and air density from observer height. The contract defines events on a sea-level astronomical horizon, so the adapter searches with height 0; positions still use the real height. Terrain horizons belong to the visibility engine (Phase 4).
