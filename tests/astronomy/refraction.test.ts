import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/ephemeris.json'
import { refract, refractionForApparent, unrefract } from '../../src/core/astronomy/refraction'
import { deg } from '../../src/core/units'

describe('refraction vs Skyfield fixtures', () => {
  it('refract(geometric) reproduces fixture apparent altitude', () => {
    let worst = 0
    for (const row of fixture.positions) {
      const got = refract(deg(row.altitudeAirless))
      worst = Math.max(worst, Math.abs(got - row.altitudeRefracted))
    }
    // Fixture values are rounded to 1e-6°; iteration tolerance is 3e-5°.
    expect(worst).toBeLessThan(1e-4)
  })

  it('unrefract inverts refract', () => {
    for (const g of [-0.9, -0.5, 0, 0.3, 1, 5, 15, 45, 80]) {
      expect(Math.abs(unrefract(refract(deg(g))) - g)).toBeLessThan(1e-4)
    }
  })

  it('horizon values at standard atmosphere', () => {
    // Refraction for an object SEEN on the horizon is ~34.5′ (0.575°)…
    expect(refractionForApparent(deg(0))).toBeCloseTo(0.575, 2)
    // …so a body geometrically ON the horizon appears ~0.48° up.
    expect(refract(deg(0))).toBeCloseTo(0.482, 2)
  })
})
