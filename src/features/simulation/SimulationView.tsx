import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import type { CameraDefinition } from '../../core/types'
import type { CameraPose } from '../../core/camera/projection'
import { toViewBox, splitPolyline, type ViewPoint } from './projection2d'
import './SimulationView.css'

type Dir = { azimuth: number; altitude: number }

export interface SimulationViewProps {
  camera: CameraDefinition
  pose: CameraPose
  horizon: readonly { azimuth: number; altitude: number }[]
  /** Apparent altitude of the flat horizon (signed; a dip is negative). */
  flatHorizonAltitude: number
  landmarkOutline: readonly (readonly { azimuth: number; altitude: number }[])[]
  target: { azimuth: number; altitude: number; label: string }
  body: {
    kind: 'sun' | 'moon'
    azimuth: number
    altitude: number
    diameter: number
    illumination?: number
    waxing?: boolean
  } | null
  tracks: readonly {
    id: string
    points: readonly { azimuth: number; altitude: number; label?: string }[]
    style: 'day' | 'multi'
  }[]
  ghostBodies?: readonly { azimuth: number; altitude: number; diameter: number; label?: string }[]
  caption: { left: string; right: string }
}

const VIEW_W = 3000
const NS = 'non-scaling-stroke' as const
const fmt = (n: number): string => n.toFixed(1)
const pathOf = (run: readonly ViewPoint[]): string =>
  run.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' ')

/** Angular radius of a disc in viewBox units, by projecting a point diameter/2 away from its centre. */
function discRadius(d: Dir, diameter: number, pose: CameraPose, cam: CameraDefinition, w: number, h: number): number | null {
  const c = toViewBox(d, pose, cam, w, h)
  if (!c) return null
  const r = diameter / 2
  const sign = d.altitude + r > 90 ? -1 : 1
  const e = toViewBox({ azimuth: d.azimuth, altitude: d.altitude + sign * r }, pose, cam, w, h)
  return e ? Math.hypot(e.x - c.x, e.y - c.y) : null
}

export function SimulationView(props: SimulationViewProps): ReactElement {
  const { camera, pose, horizon, flatHorizonAltitude, landmarkOutline, target, body, tracks, ghostBodies, caption } = props
  const W = VIEW_W
  const H = Math.round((W * camera.sensorHeight) / camera.sensorWidth)
  const clipId = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1000 / W) // CSS px per viewBox unit

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = (): void => {
      if (el.clientWidth > 0) setScale(el.clientWidth / W)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W])

  const px = (n: number): number => n / scale // CSS px -> viewBox units
  const fontSize = px(11)
  const proj = (d: Dir): ViewPoint | null => toViewBox(d, pose, camera, W, H)
  const inside = (p: ViewPoint): boolean => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H

  // Skyline: real terrain, or a flat horizon sampled across azimuth so tilt is honoured.
  let skyline = horizon
  if (skyline.length === 0) {
    const pts: Dir[] = []
    for (let a = -100; a <= 100; a += 2) {
      pts.push({ azimuth: (((pose.azimuth + a) % 360) + 360) % 360, altitude: flatHorizonAltitude })
    }
    skyline = pts
  }
  const skyRuns = splitPolyline(skyline, pose, camera, W, H)
  const outlineRuns = landmarkOutline.flatMap((o) => splitPolyline(o, pose, camera, W, H))

  // Body disc
  const bodyC = body ? proj(body) : null
  const bodyR = body ? discRadius(body, body.diameter, pose, camera, W, H) : null

  // 1 degree scale bar (measured vertically about the optical axis).
  const a = proj({ azimuth: pose.azimuth, altitude: pose.altitude - 0.5 })
  const b = proj({ azimuth: pose.azimuth, altitude: pose.altitude + 0.5 })
  const barLen = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  const showBar = barLen > px(8) && barLen < W * 0.6

  // Track labels, thinned to >= 40 css px apart.
  const labelNodes: ReactElement[] = []
  const dots: ReactElement[] = []
  tracks.forEach((t) => {
    let last: ViewPoint | null = null
    t.points.forEach((pt, i) => {
      if (!pt.label) return
      const p = proj(pt)
      if (!p || !inside(p)) return
      if (last && Math.hypot(p.x - last.x, p.y - last.y) * scale < 40) return
      last = p
      dots.push(<circle key={`${t.id}d${i}`} className="ln" vectorEffect={NS} cx={fmt(p.x)} cy={fmt(p.y)} r={px(2.5)} />)
      labelNodes.push(
        <text key={`${t.id}t${i}`} className="lbl" x={fmt(p.x + px(6))} y={fmt(p.y - px(6))} fontSize={fontSize}>
          {pt.label}
        </text>,
      )
    })
  })

  const tp = proj(target)
  const ch = px(7)
  const gap = px(2)
  const cx = W / 2
  const cy = H / 2
  const tick = px(6)

  const label = [
    `Camera view: ${caption.left}, ${caption.right}.`,
    body ? `${body.kind === 'sun' ? 'Sun' : 'Moon'} at azimuth ${body.azimuth.toFixed(1)}°, altitude ${body.altitude.toFixed(1)}°.` : 'No body in view.',
    `Target: ${target.label}.`,
    `${tracks.length} track${tracks.length === 1 ? '' : 's'}.`,
  ].join(' ')

  return (
    <div className="sim" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        shapeRendering="geometricPrecision"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="var(--sim-bg)" stroke="none" />

        <g clipPath={`url(#${clipId})`}>
          {/* rule of thirds */}
          {[1, 2].map((k) => (
            <g key={k}>
              <line className="ln thirds" vectorEffect={NS} x1={(W * k) / 3} y1={0} x2={(W * k) / 3} y2={H} />
              <line className="ln thirds" vectorEffect={NS} x1={0} y1={(H * k) / 3} x2={W} y2={(H * k) / 3} />
            </g>
          ))}

          {skyRuns.map((r, i) => (
            <path key={`s${i}`} className="ln" vectorEffect={NS} d={pathOf(r)} />
          ))}
          {outlineRuns.map((r, i) => (
            <path key={`o${i}`} className="ln dim" vectorEffect={NS} d={pathOf(r)} />
          ))}

          {tracks.map((t) =>
            splitPolyline(t.points, pose, camera, W, H).map((r, i) => (
              <path
                key={`${t.id}-${i}`}
                className={`ln ${body?.kind === 'moon' ? 'moon' : 'sun'}`}
                vectorEffect={NS}
                d={pathOf(r)}
                strokeDasharray={t.style === 'multi' ? '1 4' : undefined}
              />
            )),
          )}
          {dots}
          {labelNodes}

          {(ghostBodies ?? []).map((g, i) => {
            const c = proj(g)
            const r = discRadius(g, g.diameter, pose, camera, W, H)
            if (!c || r === null) return null
            return (
              <g key={`g${i}`}>
                <circle className="ln ghost" vectorEffect={NS} cx={fmt(c.x)} cy={fmt(c.y)} r={fmt(r)} />
                {g.label ? (
                  <text className="lbl" x={fmt(c.x + r + px(4))} y={fmt(c.y + px(4))} fontSize={fontSize}>
                    {g.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          {body && bodyC && bodyR !== null ? (
            <g className={body.kind === 'sun' ? 'sun' : 'moon'}>
              <circle className={`ln ${body.kind}`} vectorEffect={NS} cx={fmt(bodyC.x)} cy={fmt(bodyC.y)} r={fmt(bodyR)} />
              {body.kind === 'sun'
                ? Array.from({ length: 8 }, (_, i) => {
                    const t = (i * Math.PI) / 4
                    const r0 = bodyR + px(4)
                    const r1 = bodyR + px(10)
                    return (
                      <line
                        key={i}
                        className="ln sun"
                        vectorEffect={NS}
                        x1={fmt(bodyC.x + Math.cos(t) * r0)}
                        y1={fmt(bodyC.y + Math.sin(t) * r0)}
                        x2={fmt(bodyC.x + Math.cos(t) * r1)}
                        y2={fmt(bodyC.y + Math.sin(t) * r1)}
                      />
                    )
                  })
                : null}
              {body.kind === 'moon' && body.illumination !== undefined && body.illumination < 0.98 ? (
                // Terminator orientation approximated as vertical (true position angle not modelled).
                <path
                  className="ln moon"
                  vectorEffect={NS}
                  opacity={0.6}
                  d={`M${fmt(bodyC.x)} ${fmt(bodyC.y - bodyR)} A${fmt(bodyR * Math.abs(2 * body.illumination - 1))} ${fmt(bodyR)} 0 0 ${
                    (body.waxing ?? true) === body.illumination < 0.5 ? 1 : 0
                  } ${fmt(bodyC.x)} ${fmt(bodyC.y + bodyR)}`}
                />
              ) : null}
            </g>
          ) : null}

          {tp ? (
            <g>
              <line className="ln" vectorEffect={NS} x1={fmt(tp.x - ch)} y1={fmt(tp.y)} x2={fmt(tp.x - gap)} y2={fmt(tp.y)} />
              <line className="ln" vectorEffect={NS} x1={fmt(tp.x + gap)} y1={fmt(tp.y)} x2={fmt(tp.x + ch)} y2={fmt(tp.y)} />
              <line className="ln" vectorEffect={NS} x1={fmt(tp.x)} y1={fmt(tp.y - ch)} x2={fmt(tp.x)} y2={fmt(tp.y - gap)} />
              <line className="ln" vectorEffect={NS} x1={fmt(tp.x)} y1={fmt(tp.y + gap)} x2={fmt(tp.x)} y2={fmt(tp.y + ch)} />
              <text className="lbl-strong" x={fmt(tp.x + ch + px(4))} y={fmt(tp.y - px(4))} fontSize={fontSize}>
                {target.label}
              </text>
            </g>
          ) : null}

          {/* centre tick */}
          <line className="ln dim" vectorEffect={NS} x1={cx - tick} y1={cy} x2={cx + tick} y2={cy} />
          <line className="ln dim" vectorEffect={NS} x1={cx} y1={cy - tick} x2={cx} y2={cy + tick} />
        </g>

        {showBar ? (
          <g>
            <line className="ln" vectorEffect={NS} x1={fmt(cx - barLen / 2)} y1={H - px(30)} x2={fmt(cx + barLen / 2)} y2={H - px(30)} />
            <line className="ln" vectorEffect={NS} x1={fmt(cx - barLen / 2)} y1={H - px(34)} x2={fmt(cx - barLen / 2)} y2={H - px(26)} />
            <line className="ln" vectorEffect={NS} x1={fmt(cx + barLen / 2)} y1={H - px(34)} x2={fmt(cx + barLen / 2)} y2={H - px(26)} />
            <text className="lbl" x={cx} y={H - px(38)} fontSize={fontSize} textAnchor="middle">
              1°
            </text>
          </g>
        ) : null}

        <text className="lbl" x={px(12)} y={H - px(12)} fontSize={fontSize}>
          {caption.left}
        </text>
        <text className="lbl" x={W - px(12)} y={H - px(12)} fontSize={fontSize} textAnchor="end">
          {caption.right}
        </text>

        <rect className="ln" vectorEffect={NS} x={0} y={0} width={W} height={H} />
      </svg>
    </div>
  )
}
