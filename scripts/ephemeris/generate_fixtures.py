#!/usr/bin/env python3
"""
Generate reference Sun/Moon ephemeris fixtures for the astronomy tests.

Fully open-source and offline-reproducible:
  pip install skyfield==1.55 skyfield-data==7.0.0
  python3 scripts/ephemeris/generate_fixtures.py

- Skyfield (MIT) — https://rhodesmill.org/skyfield/
- JPL DE421 planetary ephemeris (public domain, NASA/JPL), shipped in the
  `skyfield-data` package (MIT) together with IERS Earth-orientation data.

Output: tests/fixtures/ephemeris.json. Deterministic: no wall-clock input.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

import skyfield
import skyfield_data
from skyfield import almanac
from skyfield.api import Loader, wgs84

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "tests", "fixtures", "ephemeris.json")

load = Loader(skyfield_data.get_skyfield_data_path())
ts = load.timescale(builtin=True)
eph = load("de421.bsp")
earth = eph["earth"]
BODIES = {"sun": eph["sun"], "moon": eph["moon"]}

# Standard atmosphere used for every refracted value (Skyfield uses Bennett's formula).
TEMPERATURE_C = 10.0
PRESSURE_MBAR = 1010.0

SITES = [
    # id, lat, lon, height_m  (generic locations, chosen for latitude coverage)
    ("hk-sea-level", 22.35, 114.18, 0.0),
    ("hk-ridge-495m", 22.3525, 114.1872, 495.0),
    ("tromso", 69.65, 18.96, 0.0),
    ("quito", -0.18, -78.47, 2850.0),
    ("sydney", -33.87, 151.21, 0.0),
]

# Sampling windows (UTC). A 3 h 7 min step walks through all hours of day.
WINDOWS = [
    (datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 10, 15, tzinfo=timezone.utc)),
    (datetime(2027, 1, 10, tzinfo=timezone.utc), datetime(2027, 1, 20, tzinfo=timezone.utc)),
    (datetime(2027, 6, 18, tzinfo=timezone.utc), datetime(2027, 6, 25, tzinfo=timezone.utc)),
]
STEP = timedelta(hours=3, minutes=7)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def positions() -> list[dict]:
    rows: list[dict] = []
    for site_id, lat, lon, h in SITES:
        topos = wgs84.latlon(lat, lon, elevation_m=h)
        observer = earth + topos
        for start, end in WINDOWS:
            t = start
            while t < end:
                st = ts.from_datetime(t)
                for body_id, body in BODIES.items():
                    app = observer.at(st).observe(body).apparent()
                    alt, az, dist = app.altaz()  # airless (geometric, topocentric)
                    alt_r, _, _ = app.altaz(temperature_C=TEMPERATURE_C, pressure_mbar=PRESSURE_MBAR)
                    rows.append({
                        "site": site_id,
                        "body": body_id,
                        "utc": iso(t),
                        "azimuth": round(az.degrees, 6),
                        "altitudeAirless": round(alt.degrees, 6),
                        "altitudeRefracted": round(alt_r.degrees, 6),
                        "distanceKm": round(dist.km, 1),
                    })
                t += STEP
    return rows


def events() -> list[dict]:
    """Rise/set instants per Skyfield's almanac (upper limb, standard refraction)."""
    rows: list[dict] = []
    spans = [
        ("hk-sea-level", datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 11, 1, tzinfo=timezone.utc)),
        ("tromso", datetime(2027, 3, 1, tzinfo=timezone.utc), datetime(2027, 3, 15, tzinfo=timezone.utc)),
        ("sydney", datetime(2027, 1, 1, tzinfo=timezone.utc), datetime(2027, 1, 15, tzinfo=timezone.utc)),
    ]
    site_map = {s[0]: s for s in SITES}
    for site_id, start, end in spans:
        _, lat, lon, h = site_map[site_id]
        observer = earth + wgs84.latlon(lat, lon, elevation_m=h)
        t0, t1 = ts.from_datetime(start), ts.from_datetime(end)
        for body_id, body in BODIES.items():
            for kind, finder in (("rise", almanac.find_risings), ("set", almanac.find_settings)):
                times, ok = finder(observer, body, t0, t1)
                for t, good in zip(times, ok):
                    if not good:
                        continue
                    app = observer.at(t).observe(body).apparent()
                    _, az, _ = app.altaz()
                    rows.append({
                        "site": site_id,
                        "body": body_id,
                        "event": kind,
                        "utc": t.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "azimuth": round(az.degrees, 4),
                    })
    rows.sort(key=lambda r: (r["site"], r["body"], r["utc"]))
    return rows


def main() -> None:
    data = {
        "generator": "scripts/ephemeris/generate_fixtures.py",
        "sources": {
            "skyfield": skyfield.__version__,
            "ephemeris": "JPL DE421 (public domain) via skyfield-data",
            "timescale": "Skyfield builtin (IERS finals2000A)",
        },
        "conventions": {
            "azimuth": "degrees, 0 = north, clockwise",
            "altitudeAirless": "topocentric geometric altitude of body centre, no refraction (includes parallax)",
            "altitudeRefracted": f"altitudeAirless + Bennett refraction at {TEMPERATURE_C} C, {PRESSURE_MBAR} mbar",
            "events": "Skyfield almanac.find_risings/find_settings: upper limb on horizon incl. standard refraction",
            "height": "site heights are metres above WGS84 ellipsoid",
        },
        "sites": [{"id": s[0], "lat": s[1], "lon": s[2], "heightM": s[3]} for s in SITES],
        "positions": positions(),
        "events": events(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(data['positions'])} positions, {len(data['events'])} events")


if __name__ == "__main__":
    main()
