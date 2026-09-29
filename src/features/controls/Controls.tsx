import { fromLocalParts, toLocalParts } from '../../core/planner'
import { fieldOfView } from '../../core/camera/fov'
import type { Lang, Translate } from '../../app/i18n'
import { FOCAL_MAX_MM, FOCAL_MIN_MM } from '../../app/useFov'
import { CAMERA_PRESETS } from '../../data/cameraPresets'
import { PRESET_LANDMARKS, type Confidence } from '../../data/presets'
import type { Geocoder, PlaceResult } from '../../providers/geocoder/nominatim'
import { utcLabel } from '../app/format'
import type { GroundInfo } from '../app/useGroundHeight'
import {
  CUSTOM_ID,
  type Derived,
  type PlannerActions,
  type PlannerState,
} from '../app/state'
import { NumField } from './NumField'
import { PlaceSearch } from './PlaceSearch'
import { Segmented } from './Segmented'

interface ControlsProps {
  readonly t: Translate
  readonly lang: Lang
  readonly state: PlannerState
  readonly derived: Derived
  readonly actions: PlannerActions
  readonly ground: GroundInfo
  readonly geocoder: Geocoder
  readonly onPlace: (place: PlaceResult) => void
}

const MIN = 60_000
const DAY = 86_400_000

export function ConfidenceBadge({ t, level }: { t: Translate; level: Confidence }) {
  return (
    <span className={`badge badge-${level}`} title={t('confidence.title')}>
      {t(`confidence.${level}`)}
    </span>
  )
}

export function Controls({ t, lang, state, derived, actions, ground, geocoder, onPlace }: ControlsProps) {
  const { preset, spots, presetSpot, offset } = derived
  const parts = toLocalParts(new Date(state.timeMs), offset)
  const setParts = (patch: Partial<typeof parts>) =>
    actions.patch({ timeMs: fromLocalParts({ ...parts, ...patch }, offset).getTime() })
  const shift = (ms: number) => actions.patch({ timeMs: state.timeMs + ms })
  const fov = fieldOfView(derived.cameraDef)
  const isCustomLandmark = state.landmarkId === CUSTOM_ID
  const isCustomSpot = state.spotId === CUSTOM_ID

  const groundNote =
    ground.source === 'loading'
      ? t('ground.loading')
      : ground.source === 'unavailable'
        ? t('ground.unavailable')
        : ground.source === 'manual'
          ? t('ground.manual')
          : ground.source === 'preset'
            ? t('ground.preset')
            : t('ground.terrain')

  return (
    <div className="controls">
      <section className="ctl" aria-labelledby="c-place">
        <h2 id="c-place">{t('ctl.place')}</h2>
        <Segmented
          label={t('mode.label')}
          value={state.clickMode}
          options={[
            { id: 'camera', label: t('mode.camera') },
            { id: 'landmark', label: t('mode.landmark') },
          ]}
          onChange={(clickMode) => actions.patch({ clickMode })}
        />
        <p className="hint">{t('mode.hint')}</p>
        <PlaceSearch t={t} geocoder={geocoder} mode={state.clickMode} onPick={onPlace} />
      </section>

      <section className="ctl" aria-labelledby="c-landmark">
        <h2 id="c-landmark">{t('ctl.landmark')}</h2>
        <label className="field">
          <span>{t('landmark.select')}</span>
          <select value={state.landmarkId} onChange={(e) => actions.selectLandmark(e.target.value)}>
            {PRESET_LANDMARKS.map((l) => (
              <option key={l.id} value={l.id}>
                {lang === 'zh-TW' ? l.name.zhTW : l.name.en}
              </option>
            ))}
            <option value={CUSTOM_ID}>{t('landmark.custom')}</option>
          </select>
        </label>
        {preset ? (
          <>
            <p className="hint">
              <ConfidenceBadge t={t} level={preset.confidence} />{' '}
              {preset.confidence === 'low' ? t('confidence.lowHint') : null}
            </p>
            <p className="hint">{lang === 'zh-TW' ? preset.caveat.zhTW : preset.caveat.en}</p>
            <p className="hint mono">
              {preset.coordinate.lat.toFixed(5)}, {preset.coordinate.lon.toFixed(5)} · {preset.topHeight} m
            </p>
          </>
        ) : (
          <div className="grid2">
            <NumField
              label={t('field.lat')}
              value={state.customLandmark.lat}
              min={-90}
              max={90}
              onCommit={(lat) => actions.patch({ customLandmark: { ...state.customLandmark, lat } })}
            />
            <NumField
              label={t('field.lon')}
              value={state.customLandmark.lon}
              min={-180}
              max={180}
              onCommit={(lon) => actions.patch({ customLandmark: { ...state.customLandmark, lon } })}
            />
            <NumField
              label={t('field.topHeight')}
              suffix="m"
              value={state.customLandmark.top}
              min={-500}
              max={9000}
              onCommit={(top) => actions.patch({ customLandmark: { ...state.customLandmark, top } })}
            />
            <NumField
              label={t('field.utcOffset')}
              suffix="h"
              value={state.customLandmark.offsetHours}
              min={-12}
              max={14}
              onCommit={(offsetHours) =>
                actions.patch({ customLandmark: { ...state.customLandmark, offsetHours } })
              }
            />
          </div>
        )}
        {isCustomLandmark ? <p className="hint">{t('landmark.customHint')}</p> : null}
      </section>

      <section className="ctl" aria-labelledby="c-spot">
        <h2 id="c-spot">{t('ctl.spot')}</h2>
        <label className="field">
          <span>{t('spot.select')}</span>
          <select value={state.spotId} onChange={(e) => actions.selectSpot(e.target.value)}>
            {spots.map((s) => (
              <option key={s.id} value={s.id}>
                {lang === 'zh-TW' ? s.name.zhTW : s.name.en}
              </option>
            ))}
            <option value={CUSTOM_ID}>{t('spot.custom')}</option>
          </select>
        </label>
        {presetSpot ? (
          <p className="hint">
            <ConfidenceBadge t={t} level={presetSpot.confidence} />{' '}
            {lang === 'zh-TW' ? presetSpot.note.zhTW : presetSpot.note.en}
          </p>
        ) : null}
        <div className="grid2">
          <NumField
            label={t('field.lat')}
            value={derived.spotCoordinate.lat}
            min={-90}
            max={90}
            onCommit={(lat) => actions.setCameraPoint(lat, derived.spotCoordinate.lon)}
          />
          <NumField
            label={t('field.lon')}
            value={derived.spotCoordinate.lon}
            min={-180}
            max={180}
            onCommit={(lon) => actions.setCameraPoint(derived.spotCoordinate.lat, lon)}
          />
          <NumField
            label={t('field.groundHeight')}
            suffix="m"
            value={ground.value}
            min={-500}
            max={9000}
            onCommit={(groundOverride) => actions.patch({ groundOverride })}
          />
          <NumField
            label={t('field.eyeHeight')}
            suffix="m"
            value={state.eyeHeight}
            min={0}
            max={100}
            onCommit={(eyeHeight) => actions.patch({ eyeHeight })}
          />
        </div>
        <p className="hint">
          {groundNote}
          {state.groundOverride !== null ? (
            <>
              {' '}
              <button type="button" className="link" onClick={() => actions.patch({ groundOverride: null })}>
                {t('ground.reset')}
              </button>
            </>
          ) : null}
        </p>
        {isCustomSpot ? <p className="hint">{t('spot.customHint')}</p> : null}
      </section>

      <section className="ctl" aria-labelledby="c-time">
        <h2 id="c-time">{t('ctl.time')}</h2>
        <Segmented
          label={t('body.label')}
          value={state.body}
          options={[
            { id: 'sun', label: t('body.sun') },
            { id: 'moon', label: t('body.moon') },
          ]}
          onChange={(body) => actions.patch({ body })}
        />
        <div className="datetime">
          <NumField label={t('time.year')} integer minDigits={4} min={1900} max={2200} value={parts.y} onCommit={(y) => setParts({ y })} />
          <NumField label={t('time.month')} integer min={1} max={12} value={parts.mo} onCommit={(mo) => setParts({ mo })} />
          <NumField label={t('time.day')} integer min={1} max={31} value={parts.d} onCommit={(d) => setParts({ d })} />
          <NumField label={t('time.hour')} integer min={0} max={23} value={parts.h} onCommit={(h) => setParts({ h })} />
          <NumField label={t('time.minute')} integer min={0} max={59} value={parts.mi} onCommit={(mi) => setParts({ mi })} />
        </div>
        <p className="hint mono">{t('time.zone', { utc: utcLabel(offset) })}</p>
        <label className="field">
          <span>{t('time.slider', { hm: `${String(parts.h).padStart(2, '0')}:${String(parts.mi).padStart(2, '0')}` })}</span>
          <input
            type="range"
            min={0}
            max={1439}
            step={1}
            value={parts.h * 60 + parts.mi}
            onChange={(e) => {
              const v = Number(e.target.value)
              setParts({ h: Math.floor(v / 60), mi: v % 60 })
            }}
          />
        </label>
        <div className="steps" role="group" aria-label={t('time.step')}>
          <button type="button" onClick={() => shift(-DAY)}>−1 {t('time.unitDay')}</button>
          <button type="button" onClick={() => shift(-10 * MIN)}>−10 {t('time.unitMin')}</button>
          <button type="button" onClick={() => shift(-MIN)}>−1 {t('time.unitMin')}</button>
          <button type="button" onClick={() => shift(MIN)}>+1 {t('time.unitMin')}</button>
          <button type="button" onClick={() => shift(10 * MIN)}>+10 {t('time.unitMin')}</button>
          <button type="button" onClick={() => shift(DAY)}>+1 {t('time.unitDay')}</button>
        </div>
      </section>

      <section className="ctl" aria-labelledby="c-view">
        <h2 id="c-view">{t('ctl.view')}</h2>
        <Segmented
          label={t('view.label')}
          value={state.viewMode}
          options={[
            { id: 'single', label: t('view.single') },
            { id: 'day', label: t('view.day') },
            { id: 'multi', label: t('view.multi') },
          ]}
          onChange={(viewMode) => actions.patch({ viewMode })}
        />
        {state.viewMode === 'multi' ? (
          <div className="grid2">
            <NumField
              label={t('view.days')}
              integer
              min={2}
              max={60}
              value={state.multiDays}
              onCommit={(multiDays) => actions.patch({ multiDays })}
            />
            <label className="field">
              <span>{t('view.multiKind')}</span>
              <select
                value={state.multiKind}
                onChange={(e) => actions.patch({ multiKind: e.target.value as PlannerState['multiKind'] })}
              >
                <option value="clock">{t('view.kindClock')}</option>
                <option value="rise">{t('view.kindRise')}</option>
                <option value="set">{t('view.kindSet')}</option>
              </select>
            </label>
          </div>
        ) : null}
      </section>

      <section className="ctl" aria-labelledby="c-lens">
        <h2 id="c-lens">{t('ctl.lens')}</h2>
        <div className="grid2">
          <label className="field">
            <span>{t('fov.camera')}</span>
            <select value={state.cameraPresetId} onChange={(e) => actions.patch({ cameraPresetId: e.target.value })}>
              {CAMERA_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <NumField
            label={t('fov.focal')}
            value={state.focalMm}
            min={FOCAL_MIN_MM}
            max={FOCAL_MAX_MM}
            onCommit={(focalMm) => actions.patch({ focalMm })}
          />
        </div>
        <p className="hint mono">
          {t('lens.fov', { h: fov.horizontal.toFixed(2), v: fov.vertical.toFixed(2) })}
        </p>
        <Segmented
          label={t('aim.label')}
          value={state.aim}
          options={[
            { id: 'target', label: t('aim.target') },
            { id: 'body', label: t('aim.body') },
          ]}
          onChange={(aim) => actions.patch({ aim })}
        />
      </section>
    </div>
  )
}
