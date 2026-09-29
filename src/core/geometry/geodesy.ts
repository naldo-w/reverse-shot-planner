/**
 * Geodesy primitives on the WGS84 ellipsoid.
 *
 * All functions are pure. Public APIs take/return Degrees and Meters; internal
 * trigonometry is done in plain radians.
 */

import { deg, m, toRadians } from "../units";
import type { Degrees, Meters } from "../units";
import type { Bounds, Coordinate } from "../types";

import { MEAN_EARTH_RADIUS, WGS84 } from "../wgs84";

export { WGS84 };

const MEAN_RADIUS = MEAN_EARTH_RADIUS;
const TOLERANCE = 1e-12;
const MAX_ITERATIONS = 200;
const RAD_TO_DEG = 180 / Math.PI;

/** Normalise an angle in degrees to [0, 360). */
function normalizeBearing(degrees: number): Degrees {
  const v = ((degrees % 360) + 360) % 360;
  // ((-1e-20 % 360) + 360) % 360 can round to 360.
  return deg(v >= 360 ? 0 : v);
}

/** Normalise longitude in degrees to (-180, 180]. */
function normalizeLongitude(lon: number): Degrees {
  if (lon > -180 && lon <= 180) return deg(lon);
  const v = ((((lon + 180) % 360) + 360) % 360) - 180;
  return deg(v === -180 ? 180 : v);
}

export interface VincentyResult {
  readonly distance: Meters;
  /** Forward azimuth at `from`, [0, 360). */
  readonly initialBearing: Degrees;
  /** Forward azimuth at `to` (direction of travel on arrival), [0, 360). */
  readonly finalBearing: Degrees;
}

/**
 * Vincenty's inverse geodesic solution on WGS84.
 *
 * Accuracy: sub-millimetre distance and ~1e-9 degree azimuth when converged.
 * Iteration tolerance 1e-12 rad on lambda, max 200 iterations.
 *
 * @returns null when the iteration does not converge (nearly antipodal points).
 *   Coincident points return distance 0 and bearings 0.
 */
export function vincentyInverse(
  from: Coordinate,
  to: Coordinate,
): VincentyResult | null {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const rawL: number = toRadians(deg(to.lon - from.lon));
  const L = Math.atan2(Math.sin(rawL), Math.cos(rawL)); // wrap to [-pi, pi]

  const { a, b, f } = WGS84;
  const U1 = Math.atan((1 - f) * Math.tan(phi1));
  const U2 = Math.atan((1 - f) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda: number = L;
  let sinLambda = 0;
  let cosLambda = 1;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cos2Alpha = 1;
  let cos2SigmaM = 0;
  let converged = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    const t1 = cosU2 * sinLambda;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLambda;
    sinSigma = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinSigma === 0) {
      return { distance: m(0), initialBearing: deg(0), finalBearing: deg(0) };
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM =
      cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const next =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    const delta = Math.abs(next - lambda);
    lambda = next;
    if (!Number.isFinite(lambda) || Math.abs(lambda) > Math.PI) {
      return null;
    }
    if (delta < TOLERANCE) {
      converged = true;
      break;
    }
  }
  if (!converged) return null;

  // Recompute trig of the converged lambda for the bearings.
  sinLambda = Math.sin(lambda);
  cosLambda = Math.cos(lambda);

  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const s = b * A * (sigma - dSigma);

  const alpha1 = Math.atan2(
    cosU2 * sinLambda,
    cosU1 * sinU2 - sinU1 * cosU2 * cosLambda,
  );
  const alpha2 = Math.atan2(
    cosU1 * sinLambda,
    -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda,
  );

  return {
    distance: m(s),
    initialBearing: normalizeBearing(alpha1 * RAD_TO_DEG),
    finalBearing: normalizeBearing(alpha2 * RAD_TO_DEG),
  };
}

/** Spherical initial bearing, degrees [0, 360). */
function sphericalBearing(from: Coordinate, to: Coordinate): Degrees {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const dLon = toRadians(deg(to.lon - from.lon));
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  if (x === 0 && y === 0) return deg(0);
  return normalizeBearing(Math.atan2(y, x) * RAD_TO_DEG);
}

/**
 * Initial bearing (forward azimuth) from `from` to `to`, degrees clockwise
 * from north, in [0, 360).
 *
 * Computed on the WGS84 ellipsoid with Vincenty's inverse (~1e-9 deg). If
 * Vincenty fails to converge (nearly antipodal points) it falls back to the
 * spherical formula (error up to ~0.2 deg). Coincident points return 0.
 */
export function initialBearing(from: Coordinate, to: Coordinate): Degrees {
  const r = vincentyInverse(from, to);
  return r ? r.initialBearing : sphericalBearing(from, to);
}

/**
 * Haversine great-circle distance on a sphere.
 *
 * Accuracy: within ~0.5% of the ellipsoidal distance depending on latitude and
 * azimuth (the sphere ignores flattening).
 *
 * @param radius Sphere radius, metres (default IUGG mean radius 6371008.8).
 */
export function haversineDistance(
  from: Coordinate,
  to: Coordinate,
  radius = MEAN_RADIUS,
): Meters {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const dPhi = phi2 - phi1;
  const dLambda = toRadians(deg(to.lon - from.lon));
  const s1 = Math.sin(dPhi / 2);
  const s2 = Math.sin(dLambda / 2);
  const h = s1 * s1 + Math.cos(phi1) * Math.cos(phi2) * s2 * s2;
  return m(2 * radius * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Geodesic distance on the WGS84 ellipsoid: Vincenty inverse (sub-millimetre),
 * falling back to haversine (~0.5%) if Vincenty does not converge.
 */
export function distance(from: Coordinate, to: Coordinate): Meters {
  const r = vincentyInverse(from, to);
  return r ? r.distance : haversineDistance(from, to);
}

/**
 * Vincenty direct solution on WGS84: the point reached by travelling
 * `distanceM` metres from `origin` along the geodesic with initial azimuth
 * `bearing`.
 *
 * Accuracy: sub-millimetre. Longitude is normalised to (-180, 180].
 */
export function destinationPoint(
  origin: Coordinate,
  bearing: Degrees,
  distanceM: Meters,
): Coordinate {
  const { a, b, f } = WGS84;
  const phi1 = toRadians(origin.lat);
  const alpha1 = toRadians(bearing);
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);

  const tanU1 = (1 - f) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cos2Alpha = 1 - sinAlpha * sinAlpha;
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));

  const sigma0 = distanceM / (b * A);
  let sigma = sigma0;
  let sinSigma = Math.sin(sigma);
  let cosSigma = Math.cos(sigma);
  let cos2SigmaM = Math.cos(2 * sigma1 + sigma);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const dSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (B / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const next = sigma0 + dSigma;
    const delta = Math.abs(next - sigma);
    sigma = next;
    if (delta < TOLERANCE) break;
  }
  cos2SigmaM = Math.cos(2 * sigma1 + sigma);
  sinSigma = Math.sin(sigma);
  cosSigma = Math.cos(sigma);

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const phi2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp),
  );
  const lambda = Math.atan2(
    sinSigma * sinAlpha1,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1,
  );
  const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
  const L =
    lambda -
    (1 - C) *
      f *
      sinAlpha *
      (sigma +
        C *
          sinSigma *
          (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

  return {
    lat: deg(phi2 * RAD_TO_DEG),
    lon: normalizeLongitude(origin.lon + L * RAD_TO_DEG),
  };
}

/**
 * Apparent drop of the horizon due to Earth curvature over `distance`:
 * d^2 (1 - k) / (2 R), with R = 6371008.8 m.
 *
 * Accuracy: exact to the parabolic approximation (error < 0.1% for d < 100 km).
 *
 * @param refractionCoefficient k. Defaults to 0 (geometric drop). Typical
 *   daytime terrestrial refraction is k ~ 0.13; callers must pass it
 *   explicitly if they want it applied.
 */
export function earthCurvatureDrop(
  distanceM: Meters,
  refractionCoefficient = 0,
): Meters {
  return m(
    (distanceM * distanceM * (1 - refractionCoefficient)) / (2 * MEAN_RADIUS),
  );
}

/**
 * Fast local offset: the coordinate `eastMeters` east and `northMeters` north
 * of `origin`, using the meridional (M) and prime-vertical (N) radii of
 * curvature of the WGS84 ellipsoid at the origin latitude, with a second-order
 * correction for the curvature of the east-west line.
 *
 * Valid for offsets below ~50 km; agrees with the geodesic destination of the
 * same tangent-plane vector to about 1 m at 10 km (HK latitude), degrading
 * quadratically beyond. Longitude is normalised to (-180, 180].
 */
export function offsetCoordinate(
  origin: Coordinate,
  eastMeters: number,
  northMeters: number,
): Coordinate {
  const phi = toRadians(origin.lat);
  const { a, e2 } = WGS84;
  const radii = (lat: number): { N: number; M: number } => {
    const sinLat = Math.sin(lat);
    const w = 1 - e2 * sinLat * sinLat;
    return { N: a / Math.sqrt(w), M: (a * (1 - e2)) / (w * Math.sqrt(w)) };
  };
  const o = radii(phi);
  const tanPhi = Math.tan(phi);

  // First pass at the origin, then refine using radii at the path mid latitude.
  const dPhi0 =
    northMeters / o.M - (eastMeters * eastMeters * tanPhi) / (2 * o.N * o.M);
  const phiMid = phi + dPhi0 / 2;
  const mid = radii(phiMid);
  // Latitude change: first order plus the geodesic "sag" of an east-going path.
  const dPhi =
    northMeters / mid.M - (eastMeters * eastMeters * tanPhi) / (2 * o.N * o.M);
  const cosMid = Math.cos(phi + dPhi / 2);
  // Meridian convergence makes a geodesic's mean heading drift eastward as it goes north.
  const eastEff = eastMeters * (1 + (northMeters * tanPhi) / (2 * o.N));
  const dLambda = cosMid === 0 ? 0 : eastEff / (mid.N * cosMid);

  return {
    lat: deg(origin.lat + dPhi * RAD_TO_DEG),
    lon: normalizeLongitude(origin.lon + dLambda * RAD_TO_DEG),
  };
}

/**
 * Bounding box of a circle of `radius` metres around `center`. Uses
 * ellipsoidal radii of curvature at the centre latitude; latitude is clamped
 * to [-90, 90]. Near the poles (box would include one) longitude spans the full
 * range. West/east are normalised to (-180, 180]; a box crossing the
 * antimeridian has west > east.
 */
export function boundsFromRadius(center: Coordinate, radius: Meters): Bounds {
  const phi = toRadians(center.lat);
  const { a, e2 } = WGS84;
  const sinPhi = Math.sin(phi);
  const w = 1 - e2 * sinPhi * sinPhi;
  const N = a / Math.sqrt(w);
  const M = (a * (1 - e2)) / (w * Math.sqrt(w));

  const dLat = (radius / M) * RAD_TO_DEG;
  const north = Math.min(90, center.lat + dLat);
  const south = Math.max(-90, center.lat - dLat);

  if (north >= 90 || south <= -90) {
    return {
      north: deg(north),
      south: deg(south),
      east: deg(180),
      west: deg(-180),
    };
  }
  const cosPhi = Math.cos(phi);
  const dLon = (radius / (N * cosPhi)) * RAD_TO_DEG;
  if (dLon >= 180) {
    return {
      north: deg(north),
      south: deg(south),
      east: deg(180),
      west: deg(-180),
    };
  }
  return {
    north: deg(north),
    south: deg(south),
    east: normalizeLongitude(center.lon + dLon),
    west: normalizeLongitude(center.lon - dLon),
  };
}

/**
 * True if `point` lies within `radius` metres (inclusive) of `center`,
 * by geodesic distance.
 */
export function isInsideRadius(
  center: Coordinate,
  point: Coordinate,
  radius: Meters,
): boolean {
  return distance(center, point) <= radius;
}
