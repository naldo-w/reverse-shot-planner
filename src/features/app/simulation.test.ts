import { describe, expect, it } from 'vitest'
import { createCelestialEngine } from '../../core/astronomy'
import { fromLocalParts } from '../../core/planner'
import { mm } from '../../core/units'
import { PRESET_LANDMARKS, PRESET_SPOTS } from '../../data/presets'
import { CAMERA_PRESETS } from '../../data/cameraPresets'
import { computeSimulation, type SimInput } from './simulation'
import { fmtDateTime, fmtSigned, utcLabel } from './format'
import { initialState } from './state'

const engine = createCelestialEngine()
const landmark = PRESET_LANDMARKS[0]!
const spot = PRESET_SPOTS.find((s) => s.landmarkId === landmark.id)!
const time = fromLocalParts({ y: 2026, mo: 10, d: 6, h: 18, mi: 0 }, 480)

const base: SimInput = {
  engine,
  landmark,
  spotCoordinate: spot.coordinate,
  groundHeight: 10,
  eyeHeight: 1.6,
  body: 'moon',
  time,
  viewMode: 'single',
  multiDays: 10,
  multiKind: 'clock',
  aim: 'target',
  cameraDef: { ...CAMERA_PRESETS[0]!.camera, focalLength: mm(400) },
}

describe('computeSimulation', () => {
  it('single moment: aims at the landmark and reports the body', () => {
    const s = computeSimulation(base)
    expect(s.pose.azimuth).toBeCloseTo(s.target.azimuth, 6)
    expect(s.bodyView.diameter).toBeGreaterThan(0.4)
    expect(s.bodyView.illumination).toBeGreaterThanOrEqual(0)
    expect(s.tracks).toHaveLength(0)
  })

  it('follow-body aim centres the body', () => {
    const s = computeSimulation({ ...base, aim: 'body' })
    expect(s.pose.azimuth).toBeCloseTo(s.bodyView.azimuth, 6)
    expect(s.pose.altitude).toBeCloseTo(s.bodyView.altitude, 6)
  })

  it('day track and hourly ghosts', () => {
    const s = computeSimulation({ ...base, body: 'sun', viewMode: 'day' })
    expect(s.tracks[0]?.style).toBe('day')
    expect(s.tracks[0]!.points.length).toBeGreaterThan(100)
    expect(s.ghosts.length).toBeGreaterThan(5)
  })

  it('multi-day: clock and rise/set variants', () => {
    for (const multiKind of ['clock', 'rise', 'set'] as const) {
      const s = computeSimulation({ ...base, body: 'sun', viewMode: 'multi', multiKind, multiDays: 12 })
      expect(s.tracks[0]?.points.length).toBe(12)
      expect(s.ghosts.length).toBeLessThanOrEqual(11)
    }
  })

  it('flags: initial state and formatting', () => {
    expect(initialState().landmarkId).toBe('lion-rock')
    expect(fmtDateTime(time, 480)).toBe('2026-10-06 18:00')
    expect(utcLabel(480)).toBe('UTC+8')
    expect(fmtSigned(-0.4213)).toBe('−0.42')
    expect(fmtSigned(1.14)).toBe('+1.14')
  })
})
