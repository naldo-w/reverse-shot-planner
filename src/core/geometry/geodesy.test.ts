import { describe, it, expect } from "vitest";
import { deg, m } from "../units";
import type { Coordinate } from "../types";
import {
  WGS84,
  boundsFromRadius,
  destinationPoint,
  distance,
  earthCurvatureDrop,
  haversineDistance,
  initialBearing,
  isInsideRadius,
  offsetCoordinate,
  vincentyInverse,
} from "./geodesy";

const c = (lat: number, lon: number): Coordinate => ({
  lat: deg(lat),
  lon: deg(lon),
});
const dms = (d: number, min: number, s: number): number =>
  d + min / 60 + s / 3600;

describe("WGS84", () => {
  it("has consistent derived constants", () => {
    expect(WGS84.a).toBe(6378137);
    expect(WGS84.b).toBeCloseTo(6356752.314245, 5);
    expect(WGS84.e2).toBeCloseTo(0.00669437999014, 12);
  });
});

describe("initialBearing", () => {
  const o = c(0, 0);
  it("returns cardinal bearings", () => {
    expect(initialBearing(o, c(1, 0))).toBeCloseTo(0, 9);
    expect(initialBearing(o, c(0, 1))).toBeCloseTo(90, 9);
    expect(initialBearing(o, c(-1, 0))).toBeCloseTo(180, 9);
    expect(initialBearing(o, c(0, -1))).toBeCloseTo(270, 9);
  });
  it("stays within [0, 360)", () => {
    const b = initialBearing(c(22.35, 114.18), c(22.3, 114.0));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
  it("falls back to something finite for near-antipodal points", () => {
    const b = initialBearing(c(0, 0), c(0.5, 179.7));
    expect(Number.isFinite(b)).toBe(true);
  });
});

describe("vincentyInverse", () => {
  it("reproduces Vincenty 1975 Flinders Peak -> Buninyong", () => {
    const flinders = c(-dms(37, 57, 3.7203), dms(144, 25, 29.5244));
    const buninyong = c(-dms(37, 39, 10.1561), dms(143, 55, 35.3839));
    const r = vincentyInverse(flinders, buninyong);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(Math.abs(r.distance - 54972.271)).toBeLessThan(0.001);
    expect(Math.abs(r.initialBearing - dms(306, 52, 5.37))).toBeLessThan(1e-4);
    // Published reverse azimuth 127 10 25.07 => forward final azimuth 307 10 25.07
    expect(Math.abs(r.finalBearing - dms(307, 10, 25.07))).toBeLessThan(1e-3);
  });
  it("returns null for nearly antipodal points that do not converge", () => {
    expect(vincentyInverse(c(0, 0), c(0.5, 179.7))).toBeNull();
  });
  it("handles coincident points", () => {
    const r = vincentyInverse(c(22.35, 114.18), c(22.35, 114.18));
    expect(r).toEqual({ distance: 0, initialBearing: 0, finalBearing: 0 });
  });
});

describe("destinationPoint round trip", () => {
  const hk = c(22.35, 114.18);
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const km of [5, 15, 50]) {
    it(`recovers distance and bearing at ${km} km for 8 bearings`, () => {
      for (const b of bearings) {
        const dest = destinationPoint(hk, deg(b), m(km * 1000));
        const r = vincentyInverse(hk, dest);
        expect(r).not.toBeNull();
        if (!r) return;
        expect(Math.abs(r.distance - km * 1000)).toBeLessThan(0.001);
        expect(Math.abs(r.initialBearing - b)).toBeLessThan(1e-8);
      }
    });
  }
  it("normalises longitude across the antimeridian", () => {
    const dest = destinationPoint(c(0, 179.9), deg(90), m(50000));
    expect(dest.lon).toBeLessThanOrEqual(180);
    expect(dest.lon).toBeGreaterThan(-180);
    expect(dest.lon).toBeCloseTo(-179.65, 1);
    const west = destinationPoint(c(10, -179.9), deg(270), m(50000));
    expect(west.lon).toBeGreaterThan(0);
    expect(west.lon).toBeCloseTo(179.65, 1);
  });
  it("crosses the equator", () => {
    const dest = destinationPoint(c(0.1, 100), deg(180), m(30000));
    expect(dest.lat).toBeLessThan(0);
    const r = vincentyInverse(c(0.1, 100), dest);
    expect(Math.abs((r?.distance ?? 0) - 30000)).toBeLessThan(0.001);
  });
  it("measures distance across the antimeridian correctly", () => {
    const d = distance(c(0, 179.9), c(0, -179.9));
    expect(Math.abs(d - 0.2 * ((Math.PI / 180) * WGS84.a))).toBeLessThan(0.01);
    expect(initialBearing(c(0, 179.9), c(0, -179.9))).toBeCloseTo(90, 9);
  });
  it("equatorial distance matches a * dLon", () => {
    const d = distance(c(0, 0), c(0, 1));
    expect(Math.abs(d - WGS84.a * (Math.PI / 180))).toBeLessThan(1e-6);
  });
});

describe("haversineDistance", () => {
  it("agrees with Vincenty within 0.5% at 15 km", () => {
    const hk = c(22.35, 114.18);
    for (const b of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const dest = destinationPoint(hk, deg(b), m(15000));
      const h = haversineDistance(hk, dest);
      const v = distance(hk, dest);
      expect(Math.abs(h - v) / v).toBeLessThan(0.005);
    }
  });
  it("is zero for identical points", () => {
    expect(haversineDistance(c(10, 10), c(10, 10))).toBe(0);
  });
  it("honours a custom radius", () => {
    expect(haversineDistance(c(0, 0), c(0, 90), m(1000))).toBeCloseTo(
      (Math.PI / 2) * 1000,
      9,
    );
  });
});

describe("earthCurvatureDrop", () => {
  it("is ~7.85 m at 10 km without refraction", () => {
    expect(earthCurvatureDrop(m(10000))).toBeCloseTo(7.85, 2);
  });
  it("is ~6.83 m at 10 km with k = 0.13", () => {
    expect(earthCurvatureDrop(m(10000), 0.13)).toBeCloseTo(6.83, 2);
  });
  it("is zero at zero distance", () => {
    expect(earthCurvatureDrop(m(0))).toBe(0);
  });
});

describe("offsetCoordinate", () => {
  const hk = c(22.35, 114.18);
  it("agrees with destinationPoint within 1 m at 10 km", () => {
    for (let b = 0; b < 360; b += 45) {
      const rad = (b * Math.PI) / 180;
      const east = 10000 * Math.sin(rad);
      const north = 10000 * Math.cos(rad);
      const approx = offsetCoordinate(hk, east, north);
      const exact = destinationPoint(hk, deg(b), m(10000));
      expect(distance(approx, exact)).toBeLessThan(1);
    }
  });
  it("returns the origin for a zero offset", () => {
    const p = offsetCoordinate(hk, 0, 0);
    expect(p.lat).toBeCloseTo(hk.lat, 12);
    expect(p.lon).toBeCloseTo(hk.lon, 12);
  });
  it("wraps longitude across the antimeridian", () => {
    const p = offsetCoordinate(c(0, 179.99), 5000, 0);
    expect(p.lon).toBeLessThan(0);
  });
});

describe("boundsFromRadius / isInsideRadius", () => {
  const hk = c(22.35, 114.18);
  it("contains points at the radius in cardinal directions", () => {
    const b = boundsFromRadius(hk, m(15000));
    const n = destinationPoint(hk, deg(0), m(15000));
    const e = destinationPoint(hk, deg(90), m(15000));
    expect(b.north).toBeCloseTo(n.lat, 4);
    expect(b.east).toBeGreaterThanOrEqual(e.lon - 1e-3);
    expect(b.north).toBeGreaterThan(b.south);
    expect(b.east).toBeGreaterThan(b.west);
  });
  it("clamps at the poles", () => {
    const b = boundsFromRadius(c(89.99, 0), m(50000));
    expect(b.north).toBe(90);
    expect(b.west).toBe(-180);
    expect(b.east).toBe(180);
  });
  it("tests membership", () => {
    const inside = destinationPoint(hk, deg(30), m(9999));
    const outside = destinationPoint(hk, deg(30), m(10001));
    expect(isInsideRadius(hk, inside, m(10000))).toBe(true);
    expect(isInsideRadius(hk, outside, m(10000))).toBe(false);
  });
});

describe("degenerate inputs", () => {
  it("coincident points give zero distance and no NaN", () => {
    const p = c(22.35, 114.18);
    expect(distance(p, p)).toBe(0);
    expect(initialBearing(p, p)).toBe(0);
    expect(haversineDistance(p, p)).toBe(0);
    const dest = destinationPoint(p, deg(123), m(0));
    expect(dest.lat).toBeCloseTo(p.lat, 12);
    expect(dest.lon).toBeCloseTo(p.lon, 12);
    expect(isInsideRadius(p, p, m(0))).toBe(true);
    const b = boundsFromRadius(p, m(0));
    for (const v of [b.north, b.south, b.east, b.west])
      expect(Number.isNaN(v)).toBe(false);
  });
  it("poles do not produce NaN", () => {
    const d = distance(c(90, 0), c(89, 0));
    expect(Number.isNaN(d)).toBe(false);
    expect(Math.abs(d - 111693.9)).toBeLessThan(10);
    const dest = destinationPoint(c(0, 0), deg(0), m(1000));
    expect(Number.isNaN(dest.lat)).toBe(false);
  });
});
