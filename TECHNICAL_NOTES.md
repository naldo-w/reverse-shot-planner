# Technical Notes & Risks

Uncertainties are recorded here as they are found. Each item says what is known, what is not, and when it will be resolved.

## 1. Astronomy accuracy (HIGH risk, resolve in Phase 2)

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
