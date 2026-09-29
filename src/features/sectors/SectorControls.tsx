import type { Translate } from '../../app/i18n'
import type { CelestialBody } from '../../core/types'
import { NumField } from '../controls/NumField'
import { Segmented } from '../controls/Segmented'
import { distancesValid } from './useSectorSearch'
import type { SectorStatus } from './useSectorSearch'
import { MAX_SECTOR_KM, MIN_SECTOR_KM } from './sectorModel'
import type { SectorComposition, SectorEvent, SectorParams, SectorRange } from './sectorModel'

interface SectorControlsProps {
  readonly t: Translate
  readonly params: SectorParams
  readonly body: CelestialBody
  readonly status: SectorStatus
  readonly onParams: (p: Partial<SectorParams>) => void
  readonly onBody: (b: CelestialBody) => void
  readonly onRun: () => void
  readonly onCancel: () => void
}

const TOLERANCES = [0.25, 0.5, 1] as const

export function SectorControls(p: SectorControlsProps) {
  const { t, params, status } = p
  const running = status.state === 'running'
  const valid = distancesValid(params)
  const pct = status.state === 'running' ? Math.round(status.progress * 100) : 0

  return (
    <div className="sector-controls">
      <p className="hint">{t('sector.desc')}</p>
      <div className="sector-grid">
        <div className="field">
          <span>{t('sector.body')}</span>
          <Segmented
            label={t('sector.body')}
            value={p.body}
            options={[
              { id: 'sun', label: t('body.sun') },
              { id: 'moon', label: t('body.moon') },
            ]}
            onChange={p.onBody}
          />
        </div>
        <div className="field">
          <span>{t('sector.event')}</span>
          <Segmented<SectorEvent>
            label={t('sector.event')}
            value={params.event}
            options={[
              { id: 'rise', label: t('sector.event.rise') },
              { id: 'set', label: t('sector.event.set') },
              { id: 'any', label: t('sector.event.any') },
            ]}
            onChange={(event) => p.onParams({ event })}
          />
        </div>
        <div className="field">
          <span>{t('sector.range')}</span>
          <Segmented<SectorRange>
            label={t('sector.range')}
            value={params.range}
            options={[
              { id: 'day', label: t('sector.range.day') },
              { id: '30', label: t('sector.range.30') },
              { id: '90', label: t('sector.range.90') },
              { id: '365', label: t('sector.range.365') },
            ]}
            onChange={(range) => p.onParams({ range })}
          />
        </div>
        <div className="field">
          <span>{t('sector.comp')}</span>
          <Segmented<SectorComposition>
            label={t('sector.comp')}
            value={params.composition}
            options={[
              { id: 'centred', label: t('sector.comp.centred') },
              { id: 'above', label: t('sector.comp.above') },
              { id: 'custom', label: t('sector.comp.custom') },
            ]}
            onChange={(composition) => p.onParams({ composition })}
          />
        </div>
        {params.composition === 'custom' ? (
          <NumField
            label={t('sector.offset')}
            value={params.customOffset}
            min={-5}
            max={10}
            onCommit={(customOffset) => p.onParams({ customOffset })}
          />
        ) : null}
        <div className="field">
          <span>{t('sector.tol')}</span>
          <Segmented<`${(typeof TOLERANCES)[number]}`>
            label={t('sector.tol')}
            value={`${params.tolerance}`}
            options={TOLERANCES.map((v) => ({ id: `${v}` as const, label: `±${v}` }))}
            onChange={(v) => p.onParams({ tolerance: Number(v) as SectorParams['tolerance'] })}
          />
        </div>
        <NumField
          label={t('sector.minKm')}
          value={params.minKm}
          min={MIN_SECTOR_KM}
          max={MAX_SECTOR_KM}
          onCommit={(minKm) => p.onParams({ minKm })}
        />
        <NumField
          label={t('sector.maxKm')}
          value={params.maxKm}
          min={MIN_SECTOR_KM}
          max={MAX_SECTOR_KM}
          onCommit={(maxKm) => p.onParams({ maxKm })}
        />
      </div>
      {!valid ? <p className="warn-line">{t('sector.distInvalid', { min: MIN_SECTOR_KM, max: MAX_SECTOR_KM })}</p> : null}
      <div className="sector-run">
        {running ? (
          <button type="button" className="primary" onClick={p.onCancel}>
            {t('sector.cancel')}
          </button>
        ) : (
          <button type="button" className="primary" disabled={!valid} onClick={p.onRun}>
            {t('sector.compute')}
          </button>
        )}
        {running ? (
          <div className="sector-progress">
            <progress max={100} value={pct} aria-label={t('sector.progress', { pct })} />
            <span className="hint mono">{t('sector.progress', { pct })}</span>
          </div>
        ) : null}
      </div>
      {status.state === 'error' ? (
        <p className="warn-line" role="alert">
          {t('sector.error', { msg: status.message })}
        </p>
      ) : null}
    </div>
  )
}
