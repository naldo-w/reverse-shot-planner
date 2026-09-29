/**
 * Astronomy entry point. Application code imports from here, never from a
 * specific engine or library.
 *
 * Default engine: astronomy-engine — measured against JPL DE421 fixtures at
 * ≤0.002° (Sun and Moon, full sky) and ≤2 s rise/set error; SunCalc measured
 * ≤0.014° / ≤11 s. See TECHNICAL_NOTES §1.
 */

import type { CelestialBody } from '../types'
import { AstronomyEngineEngine } from './engines/astronomyEngine'
import { SuncalcEngine } from './engines/suncalcEngine'
import { refract, STANDARD_ATMOSPHERE, type Atmosphere } from './refraction'
import type { CelestialEngine, CelestialSample, Observer } from './types'

export type { Atmosphere } from './refraction'
export { refract, unrefract, refractionForApparent, STANDARD_ATMOSPHERE } from './refraction'
export type * from './types'
export { BODY_RADIUS_KM } from './types'

export type EngineId = 'astronomy-engine' | 'suncalc'

export const DEFAULT_ENGINE_ID: EngineId = 'astronomy-engine'

export function createCelestialEngine(id: EngineId = DEFAULT_ENGINE_ID): CelestialEngine {
  return id === 'suncalc' ? new SuncalcEngine() : new AstronomyEngineEngine()
}

export const getSunPosition = (e: CelestialEngine, t: Date, o: Observer): CelestialSample =>
  e.getPosition('sun', t, o)

export const getMoonPosition = (e: CelestialEngine, t: Date, o: Observer): CelestialSample =>
  e.getPosition('moon', t, o)

/** Geometric sample plus its apparent (refracted) altitude under `atm`. */
export function withApparentAltitude(
  s: CelestialSample,
  atm: Atmosphere = STANDARD_ATMOSPHERE,
): CelestialSample & { readonly apparentAltitude: ReturnType<typeof refract> } {
  return { ...s, apparentAltitude: refract(s.altitude, atm) }
}

export type { CelestialBody }
