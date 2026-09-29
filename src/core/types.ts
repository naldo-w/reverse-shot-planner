/**
 * Core domain types shared by every engine (geometry, astronomy, terrain,
 * visibility, search, camera). This file has no runtime dependencies and
 * must never import React, MapLibre, SunCalc or any provider.
 */

import type { Degrees, Meters, Millimeters } from './units'

/** WGS84 geodetic coordinate. Latitude/longitude in degrees. */
export interface Coordinate {
  readonly lat: Degrees
  readonly lon: Degrees
}

/** WGS84 geodetic position including ellipsoidal height (metres). */
export interface GeodeticPosition extends Coordinate {
  /** Height above the WGS84 ellipsoid, metres. See TECHNICAL_NOTES: DEM heights are usually orthometric (geoid). */
  readonly height: Meters
}

/** Earth-Centred, Earth-Fixed Cartesian coordinate, metres. */
export interface EcefCoordinate {
  readonly x: Meters
  readonly y: Meters
  readonly z: Meters
}

/** Local East-North-Up tangent-plane coordinate relative to an origin, metres. */
export interface LocalCoordinate {
  readonly east: Meters
  readonly north: Meters
  readonly up: Meters
}

/** Horizontal (topocentric) direction. Azimuth: 0 = N, 90 = E, clockwise, [0, 360). */
export interface HorizontalDirection {
  readonly azimuth: Degrees
  /** Angle above the local horizontal plane, [-90, 90]. */
  readonly altitude: Degrees
}

export interface Bounds {
  readonly north: Degrees
  readonly south: Degrees
  readonly east: Degrees
  readonly west: Degrees
}

// ---------------------------------------------------------------- Targets

export interface MountainTarget {
  readonly type: 'mountain'
  readonly name: string
  readonly coordinate: Coordinate
  readonly elevation?: Meters
}

export interface PointTarget {
  readonly type: 'point'
  readonly name: string
  readonly coordinate: Coordinate
  readonly elevation?: Meters
}

export interface StructureTarget {
  readonly type: 'structure'
  readonly name: string
  readonly coordinate: Coordinate
  readonly baseElevation?: Meters
  readonly heightMeters?: Meters
  readonly widthMeters?: Meters
}

export interface CustomTarget {
  readonly type: 'custom'
  readonly name: string
  readonly coordinate: Coordinate
  readonly elevation?: Meters
  readonly heightMeters?: Meters
  readonly widthMeters?: Meters
}

export type TargetDefinition = MountainTarget | PointTarget | StructureTarget | CustomTarget

// ---------------------------------------------------------------- Horizon

export interface HorizonSample {
  readonly azimuth: Degrees
  readonly altitude: Degrees
  /** Distance to the terrain point that defines this sample, metres. */
  readonly distance?: Meters
}

export interface HorizonProfile {
  readonly samples: readonly HorizonSample[]
}

// ---------------------------------------------------------------- Celestial

export type CelestialBody = 'sun' | 'moon'

export interface CelestialPosition extends HorizontalDirection {
  readonly distanceKm?: number
  readonly angularDiameter?: Degrees
  /** Illuminated fraction 0..1 (Moon only). */
  readonly illumination?: number
}

// ---------------------------------------------------------------- Camera

export interface CameraDefinition {
  readonly sensorWidth: Millimeters
  readonly sensorHeight: Millimeters
  readonly focalLength: Millimeters
}

export interface FieldOfView {
  readonly horizontal: Degrees
  readonly vertical: Degrees
  readonly diagonal: Degrees
}
