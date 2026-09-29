import { lazy, Suspense, useMemo } from 'react'
import type { Lang, Translate } from '../../app/i18n'
import { dailyEvents } from '../../core/planner'
import type { Alignment, DailyEvents } from '../../core/planner/types'
import type { CelestialBody } from '../../core/types'
import type { PresetSpot } from '../../data/presets'
import { NominatimGeocoder, type PlaceResult } from '../../providers/geocoder/nominatim'
import { Controls } from '../controls/Controls'
import type { MapLine } from '../map/geo'
import { ResultsPanel } from '../results/ResultsPanel'
import { SpotsPanel } from '../results/SpotsPanel'
import { SimulationView } from '../simulation/SimulationView'
import { fmtClock, fmtDateTime, fmtSigned, utcLabel } from './format'
import { CUSTOM_ID, useDerived, usePlanner } from './state'
import { elevationAt } from './terrainService'
import { useAlignLines, useAlignmentFinder, useSpotRecommendations } from './useAlignments'
import { useGroundHeight } from './useGroundHeight'
import { getEngine, useSimulation } from './useSimulation'
import { RISE_COLOR, SET_COLOR } from '../map/geo'

const MapView = lazy(() => import('../map/MapView'))

interface PlannerAppProps {
  readonly lang: Lang
  readonly t: Translate
}

const MAP_LABEL = {
  sun: { rise: 'Sunrise', set: 'Sunset' },
  moon: { rise: 'Moonrise', set: 'Moonset' },
} as const

function MapLegend({ t }: { t: Translate }) {
  const swatch = (color: string, dash?: string) => (
    <svg width="28" height="8" aria-hidden="true">
      <line x1="0" y1="4" x2="28" y2="4" stroke={color} strokeWidth="1" strokeDasharray={dash} />
    </svg>
  )
  return (
    <ul className="legend">
      <li>{swatch(RISE_COLOR)} {t('legend.rise')}</li>
      <li>{swatch(SET_COLOR)} {t('legend.set')}</li>
      <li>{swatch('#8b949e')} {t('legend.sun')}</li>
      <li>{swatch('#8b949e', '3 2')} {t('legend.moon')}</li>
      <li><span className="mk-key mk-camera" /> {t('map.camera')}</li>
      <li><span className="mk-key mk-landmark" /> {t('map.landmark')}</li>
    </ul>
  )
}

export function PlannerApp({ lang, t }: PlannerAppProps) {
  const { state, actions } = usePlanner()
  const derived = useDerived(state)
  const { landmark, offset } = derived
  const time = useMemo(() => new Date(state.timeMs), [state.timeMs])

  const geocoder = useMemo(() => new NominatimGeocoder(() => lang), [lang])

  const presetGround = derived.presetSpot?.groundHeight ?? null
  const ground = useGroundHeight(
    derived.spotCoordinate.lat,
    derived.spotCoordinate.lon,
    presetGround,
    state.groundOverride,
  )

  const sim = useSimulation({
    landmark,
    spotCoordinate: derived.spotCoordinate,
    groundHeight: ground.value,
    eyeHeight: state.eyeHeight,
    body: state.body,
    time,
    viewMode: state.viewMode,
    multiDays: state.multiDays,
    multiKind: state.multiKind,
    aim: state.aim,
    cameraDef: derived.cameraDef,
  })
  const { core } = sim

  const { lat: camLat, lon: camLon, height: camHeight } = core.camera
  const events = useMemo<DailyEvents[]>(() => {
    try {
      return dailyEvents(getEngine(), { lat: camLat, lon: camLon, height: camHeight }, core.localDate, 1, offset)
    } catch {
      return []
    }
  }, [camLat, camLon, camHeight, core.localDate, offset])

  const finder = useAlignmentFinder(core.camera, core.targetPos, state.body, landmark, state.timeMs)
  const recs = useSpotRecommendations(landmark, derived.spots, state.eyeHeight)
  const alignLines = useAlignLines(landmark, core.localDate)

  const mapLines = useMemo<MapLine[]>(
    () =>
      alignLines.map((l) => ({
        body: l.body,
        kind: l.kind,
        label: `${MAP_LABEL[l.body][l.kind]} ${fmtClock(l.time, offset)}`,
        from: l.from,
        to: l.to,
      })),
    [alignLines, offset],
  )

  const mapSpots = useMemo(
    () =>
      derived.spots.map((s) => ({
        id: s.id,
        lat: s.coordinate.lat,
        lon: s.coordinate.lon,
        name: lang === 'zh-TW' ? s.name.zhTW : s.name.en,
      })),
    [derived.spots, lang],
  )

  // ------------------------------------------------------------ handlers
  const setLandmarkAt = (lat: number, lon: number) => {
    actions.setLandmarkPoint(lat, lon)
    void elevationAt(lat, lon).then((h) => {
      if (h !== null) actions.setLandmarkTop(lat, lon, Math.round(h))
    })
  }
  const handleMapClick = (lat: number, lon: number) => {
    if (state.clickMode === 'camera') actions.setCameraPoint(lat, lon)
    else setLandmarkAt(lat, lon)
  }
  const handlePlace = (place: PlaceResult) => {
    handleMapClick(place.lat, place.lon)
    actions.focus()
  }
  const applyAlignment = (spotId: string | null, a: Alignment) => actions.apply(spotId, a.body, a.time)

  const landmarkName = lang === 'zh-TW' ? landmark.name.zhTW : landmark.name.en
  const bodyLabel = t(`body.${state.body}`)
  const bv = sim.core.bodyView
  const caption = {
    left: t('sim.captionLeft', {
      dt: fmtDateTime(time, offset),
      utc: utcLabel(offset),
      body: bodyLabel,
      az: bv.azimuth.toFixed(2),
      alt: fmtSigned(bv.altitude, 2),
    }),
    right: t('sim.captionRight', {
      f: state.focalMm,
      h: core.fov.horizontal.toFixed(2),
      v: core.fov.vertical.toFixed(2),
    }),
  }
  const terrainText =
    sim.terrain.state === 'ready' || sim.terrain.state === 'partial'
      ? sim.terrain.state === 'partial'
        ? t('terrain.partial')
        : t('terrain.ready', { res: sim.terrain.resolution })
      : t(`terrain.${sim.terrain.state}`)

  return (
    <div className="planner">
      <aside className="col-controls" aria-label={t('ctl.aria')}>
        <Controls
          t={t}
          lang={lang}
          state={state}
          derived={derived}
          actions={actions}
          ground={ground}
          geocoder={geocoder}
          onPlace={handlePlace}
        />
      </aside>

      <main className="col-main">
        <section className="pane" aria-labelledby="map-h">
          <div className="pane-head">
            <h2 id="map-h">{t('map.heading')}</h2>
            <span className="hint">
              {state.clickMode === 'camera' ? t('map.clickCamera') : t('map.clickLandmark')}
            </span>
          </div>
          <div className="map-wrap">
            <Suspense fallback={<div className="map-host map-loading">{t('map.loading')}</div>}>
              <MapView
                landmark={{ lat: landmark.coordinate.lat, lon: landmark.coordinate.lon }}
                camera={{ lat: derived.spotCoordinate.lat, lon: derived.spotCoordinate.lon }}
                landmarkLabel={`${t('map.landmark')}: ${landmarkName}`}
                cameraLabel={t('map.camera')}
                spots={mapSpots}
                selectedSpotId={state.spotId}
                lines={mapLines}
                focusSeq={state.focusSeq}
                onClickPoint={handleMapClick}
                onSelectSpot={actions.selectSpot}
                onMoveCamera={actions.setCameraPoint}
                onMoveLandmark={setLandmarkAt}
              />
            </Suspense>
          </div>
          <MapLegend t={t} />
        </section>

        <section className="pane" aria-labelledby="sim-h">
          <div className="pane-head">
            <h2 id="sim-h">{t('sim.heading')}</h2>
            <span className="hint mono">{terrainText}</span>
          </div>
          <div className="sim-frame">
            <SimulationView
              camera={derived.cameraDef}
              pose={core.pose}
              horizon={sim.horizon}
              flatHorizonAltitude={sim.flatHorizonAltitude}
              landmarkOutline={core.outline}
              target={{
                azimuth: core.target.azimuth,
                altitude: core.target.apparentAltitude,
                label: landmarkName,
              }}
              body={core.bodyView}
              tracks={core.tracks}
              ghostBodies={core.ghosts}
              caption={caption}
            />
          </div>
          <p className="readout-line mono">
            {t('sim.target', {
              az: core.target.azimuth.toFixed(2),
              alt: fmtSigned(core.target.apparentAltitude, 2),
              dist: (core.target.distance / 1000).toFixed(2),
            })}
          </p>
          <ul className="honesty" aria-label={t('honesty.heading')}>
            <li>{terrainText}</li>
            <li>{t('honesty.outline')}</li>
            <li>{t('honesty.spots')}</li>
            <li>{t('honesty.refraction')}</li>
            <li>{t('honesty.geometric')}</li>
          </ul>
        </section>
      </main>

      <div className="col-results">
        <ResultsPanel
          t={t}
          offset={offset}
          localDate={core.localDate}
          selectedBody={state.body}
          selectedTimeMs={state.timeMs}
          events={events}
          finder={finder.state}
          onFind={finder.run}
          onPickEvent={(body: CelestialBody, when: Date) => actions.patch({ body, timeMs: when.getTime() })}
          onPickAlignment={(a) => applyAlignment(null, a)}
        />
        {derived.preset ? (
          <SpotsPanel
            t={t}
            lang={lang}
            offset={offset}
            spots={derived.spots}
            selectedSpotId={state.spotId}
            recs={recs}
            onPickSpot={(spot: PresetSpot, first) => {
              if (first) applyAlignment(spot.id, first)
              else actions.selectSpot(spot.id)
            }}
            onPickAlignment={(spot: PresetSpot, a) => applyAlignment(spot.id, a)}
          />
        ) : (
          <p className="hint">{state.landmarkId === CUSTOM_ID ? t('spots.customLandmark') : null}</p>
        )}
      </div>
    </div>
  )
}
