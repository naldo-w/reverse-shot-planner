/**
 * Shared conformance suite: every CelestialEngine is measured against the
 * same open-source reference fixtures (Skyfield + JPL DE421, see
 * scripts/ephemeris/generate_fixtures.py). Engines call
 * `describeConformance(engine, tolerances)` from their own test file.
 */
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/ephemeris.json'
import type { CelestialEngine, Observer } from '../../src/core/astronomy/types'
import type { CelestialBody } from '../../src/core/types'
import { deg, m } from '../../src/core/units'

export interface Tolerances {
  /**
   * Max azimuth error in degrees of sky arc, i.e. |Δaz|·cos(alt), over |alt| < 85°.
   * In the horizon band (the part that matters for alignment) cos(alt) ≈ 1, and the raw
   * |Δaz| there is also asserted against the same tolerance.
   */
  readonly azimuthDeg: Record<CelestialBody, number>
  /** Max |geometric altitude error| in degrees. */
  readonly altitudeDeg: Record<CelestialBody, number>
  /** Max relative distance error. */
  readonly distanceRel: Record<CelestialBody, number>
  /** Max |event time error| in seconds. */
  readonly eventSeconds: Record<CelestialBody, number>
}

interface Stats {
  maxAz: number
  maxAlt: number
  maxDistRel: number
  n: number
  /** Photographically relevant band: geometric altitude −2°…+15° (rise/set, low Moon). */
  horizonMaxAz: number
  horizonMaxAlt: number
  horizonN: number
}

const sites = new Map<string, Observer>(
  fixture.sites.map((s) => [s.id, { lat: deg(s.lat), lon: deg(s.lon), height: m(s.heightM) }]),
)

function site(id: string): Observer {
  const o = sites.get(id)
  if (!o) throw new Error(`unknown fixture site ${id}`)
  return o
}

function azErr(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

export function measurePositions(engine: CelestialEngine, body: CelestialBody): Stats {
  const s: Stats = { maxAz: 0, maxAlt: 0, maxDistRel: 0, n: 0, horizonMaxAz: 0, horizonMaxAlt: 0, horizonN: 0 }
  for (const row of fixture.positions) {
    if (row.body !== body) continue
    const p = engine.getPosition(body, new Date(row.utc), site(row.site))
    const az = azErr(p.azimuth, row.azimuth)
    const alt = Math.abs(p.altitude - row.altitudeAirless)
    const azArc = az * Math.cos((row.altitudeAirless * Math.PI) / 180)
    if (Math.abs(row.altitudeAirless) < 85) s.maxAz = Math.max(s.maxAz, azArc)
    s.maxAlt = Math.max(s.maxAlt, alt)
    if (row.altitudeAirless >= -2 && row.altitudeAirless <= 15) {
      s.horizonMaxAz = Math.max(s.horizonMaxAz, az)
      s.horizonMaxAlt = Math.max(s.horizonMaxAlt, alt)
      s.horizonN++
    }
    s.maxDistRel = Math.max(s.maxDistRel, Math.abs(p.distanceKm - row.distanceKm) / row.distanceKm)
    s.n++
  }
  return s
}

export function measureEvents(engine: CelestialEngine, body: CelestialBody): { maxSeconds: number; missing: number; n: number } {
  let maxSeconds = 0
  let missing = 0
  let n = 0
  for (const ev of fixture.events) {
    if (ev.body !== body) continue
    n++
    const t = new Date(ev.utc).getTime()
    const found = engine
      .findEvents(body, site(ev.site), new Date(t - 3 * 3600_000), new Date(t + 3 * 3600_000))
      .filter((e) => e.kind === ev.event)
    if (found.length === 0) {
      missing++
      continue
    }
    const best = Math.min(...found.map((e) => Math.abs(e.time.getTime() - t) / 1000))
    maxSeconds = Math.max(maxSeconds, best)
  }
  return { maxSeconds, missing, n }
}

export function describeConformance(engine: CelestialEngine, tol: Tolerances): void {
  describe(`${engine.label} vs DE421 reference fixtures`, () => {
    for (const body of ['sun', 'moon'] as const) {
      it(`${body} positions`, () => {
        const s = measurePositions(engine, body)
        console.info(
          `[${engine.id}] ${body}: n=${s.n} maxAzArc=${s.maxAz.toFixed(5)}° maxAlt=${s.maxAlt.toFixed(5)}° maxDistRel=${s.maxDistRel.toExponential(2)} | horizon band n=${s.horizonN} maxAz=${s.horizonMaxAz.toFixed(5)}° maxAlt=${s.horizonMaxAlt.toFixed(5)}°`,
        )
        expect(s.n).toBeGreaterThan(100)
        expect(s.horizonN).toBeGreaterThan(20)
        expect(s.maxAz).toBeLessThanOrEqual(tol.azimuthDeg[body])
        expect(s.horizonMaxAz).toBeLessThanOrEqual(tol.azimuthDeg[body])
        expect(s.horizonMaxAlt).toBeLessThanOrEqual(tol.altitudeDeg[body])
        expect(s.maxAlt).toBeLessThanOrEqual(tol.altitudeDeg[body])
        expect(s.maxDistRel).toBeLessThanOrEqual(tol.distanceRel[body])
      })

      it(`${body} rise/set events`, () => {
        const e = measureEvents(engine, body)
        console.info(`[${engine.id}] ${body} events: n=${e.n} missing=${e.missing} maxErr=${e.maxSeconds.toFixed(1)}s`)
        expect(e.missing).toBe(0)
        expect(e.maxSeconds).toBeLessThanOrEqual(tol.eventSeconds[body])
      })
    }
  })
}
