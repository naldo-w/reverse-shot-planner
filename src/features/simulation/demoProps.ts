// TEST FIXTURE — never imported by the app.
import { deg, mm } from '../../core/units'
import type { SimulationViewProps } from './SimulationView'

export const demoProps: SimulationViewProps = {
  camera: { sensorWidth: mm(36), sensorHeight: mm(24), focalLength: mm(400) },
  pose: { azimuth: deg(90), altitude: deg(1) },
  horizon: [],
  flatHorizonAltitude: -0.1,
  landmarkOutline: [
    [
      { azimuth: 89.5, altitude: 0 },
      { azimuth: 89.6, altitude: 1.5 },
      { azimuth: 89.7, altitude: 0 },
    ],
  ],
  target: { azimuth: 89.6, altitude: 1.5, label: 'Pylon top' },
  body: { kind: 'moon', azimuth: 90.2, altitude: 1.2, diameter: 0.52, illumination: 0.4, waxing: true },
  tracks: [
    {
      id: 'd1',
      style: 'day',
      points: [
        { azimuth: 89.5, altitude: 0.2, label: '19:00' },
        { azimuth: 89.9, altitude: 0.8, label: '19:05' },
        { azimuth: 90.3, altitude: 1.4, label: '19:10' },
      ],
    },
    { id: 'm1', style: 'multi', points: [{ azimuth: 89.2, altitude: 0 }, { azimuth: 90.8, altitude: 2 }] },
  ],
  ghostBodies: [{ azimuth: 90.6, altitude: 1.8, diameter: 0.52, label: 'D+1' }],
  caption: { left: '19:05', right: '5.1° × 3.4°' },
}
