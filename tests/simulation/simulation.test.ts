import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fieldOfView } from '../../src/core/camera/fov'
import { deg, mm } from '../../src/core/units'
import { splitPolyline, toViewBox } from '../../src/features/simulation/projection2d'
import { SimulationView } from '../../src/features/simulation/SimulationView'
import { demoProps } from '../../src/features/simulation/demoProps'

const camera = { sensorWidth: mm(36), sensorHeight: mm(24), focalLength: mm(100) }
const pose = { azimuth: deg(0), altitude: deg(0) }
const W = 3000
const H = 2000

describe('projection2d', () => {
  it('maps the optical axis to the centre', () => {
    const p = toViewBox({ azimuth: 0, altitude: 0 }, pose, camera, W, H)
    expect(p?.x).toBeCloseTo(W / 2, 6)
    expect(p?.y).toBeCloseTo(H / 2, 6)
  })
  it('maps +half horizontal FOV to the right edge', () => {
    const half = fieldOfView(camera).horizontal / 2
    const p = toViewBox({ azimuth: half, altitude: 0 }, pose, camera, W, H)
    expect(p?.x).toBeCloseTo(W, 4)
  })
  it('drops behind-camera directions', () => {
    expect(toViewBox({ azimuth: 180, altitude: 0 }, pose, camera, W, H)).toBeNull()
  })
  it('is continuous across azimuth wrap-around', () => {
    const runs = splitPolyline(
      [{ azimuth: 359, altitude: 0 }, { azimuth: 0, altitude: 0 }, { azimuth: 1, altitude: 0 }],
      pose, camera, W, H,
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]).toHaveLength(3)
    expect(runs[0]![0]!.x).toBeLessThan(runs[0]![2]!.x)
  })
  it('splits runs at behind-camera points', () => {
    const runs = splitPolyline(
      [{ azimuth: 0, altitude: 0 }, { azimuth: 1, altitude: 0 }, { azimuth: 180, altitude: 0 }, { azimuth: 2, altitude: 0 }, { azimuth: 3, altitude: 0 }],
      pose, camera, W, H,
    )
    expect(runs).toHaveLength(2)
  })
})

describe('SimulationView', () => {
  const html = renderToStaticMarkup(createElement(SimulationView, demoProps))
  it('renders an accessible svg with 3:2 viewBox', () => {
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="')
    expect(html).toContain('viewBox="0 0 3000 2000"')
  })
  it('uses non-scaling strokes and includes captions and scale label', () => {
    expect(html).toContain('vector-effect="non-scaling-stroke"')
    expect(html).toContain('5.1° × 3.4°')
    expect(html).toContain('>1°<')
  })
  it('renders with an empty skyline and no body', () => {
    const out = renderToStaticMarkup(createElement(SimulationView, { ...demoProps, body: null, horizon: [], ghostBodies: [] }))
    expect(out).toContain('<path')
  })
})
