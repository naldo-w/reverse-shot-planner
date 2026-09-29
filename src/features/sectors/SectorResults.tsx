import type { Translate } from '../../app/i18n'
import type { SectorCell } from '../../core/search/sectors'
import { fmtClock, fmtDate, fmtSigned } from '../app/format'
import { groupByDate, paletteGradient, summarize, topCells } from './sectorModel'
import type { SectorResult } from './useSectorSearch'

/** Legend: date gradient with start/end dates, plus what fill, dashes and edges mean. */
export function SectorLegend(props: { t: Translate; result: SectorResult; offsetMinutes: number }) {
  const { t, result, offsetMinutes } = props
  const start = fmtDate(new Date(result.startMs), offsetMinutes)
  const end = fmtDate(new Date(result.endMs - 1), offsetMinutes)
  return (
    <ul className="legend sector-legend">
      <li>
        <span>{t('sector.legend.date')}</span>
        <span className="mono">{start}</span>
        <span className="ramp" style={{ background: paletteGradient() }} aria-hidden="true" />
        <span className="mono">{end}</span>
      </li>
      <li>{t('sector.legend.error')}</li>
      <li>
        <svg width="28" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="28" y2="4" stroke="#8b949e" strokeWidth="1" strokeDasharray="3 2" />
        </svg>{' '}
        {t('sector.legend.hidden')}
      </li>
      <li>
        <svg width="28" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="28" y2="4" stroke="#8b949e" strokeWidth="1" />
        </svg>{' '}
        {t('sector.legend.edge')}
      </li>
    </ul>
  )
}

interface SectorResultsProps {
  readonly t: Translate
  readonly result: SectorResult
  readonly offsetMinutes: number
  readonly onPick: (cell: SectorCell) => void
}

export function SectorResults({ t, result, offsetMinutes, onPick }: SectorResultsProps) {
  const summary = summarize(result.cells)
  const groups = groupByDate(topCells(result.cells, 20), offsetMinutes)
  return (
    <section className="ctl" aria-labelledby="r-sector">
      <h2 id="r-sector">{t('sector.results.heading')}</h2>
      {summary ? (
        <p className="hint mono">
          {t('sector.summary', {
            n: summary.count,
            b0: summary.bearingMin.toFixed(1),
            b1: summary.bearingMax.toFixed(1),
            d0: summary.distanceMinKm.toFixed(1),
            d1: summary.distanceMaxKm.toFixed(1),
          })}
        </p>
      ) : (
        <p className="hint">{t('sector.empty')}</p>
      )}
      {groups.length > 0 ? (
        <>
          <p className="hint">{t('sector.results.desc')}</p>
          <div className="scroll-y">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('align.date')}</th>
                  <th>{t('align.time')}</th>
                  <th>{t('align.dir')}</th>
                  <th>{t('sector.results.where')}</th>
                  <th>{t('sector.results.error')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((g) =>
                  g.cells.map((c, i) => (
                    <tr key={`${g.date}-${c.bearing}-${c.distance}`}>
                      <td className="mono">{i === 0 ? g.date : ''}</td>
                      <td className="mono">
                        <button type="button" className="rowbtn mono" onClick={() => onPick(c)}>
                          {fmtClock(c.best.time, offsetMinutes)}
                        </button>
                      </td>
                      <td>{t(c.best.direction === 'rising' ? 'align.rising' : 'align.setting')}</td>
                      <td className="mono">
                        {c.bearing.toFixed(1)}° · {(c.distance / 1000).toFixed(1)} km
                        {c.visible === false ? (
                          <span className="warn" title={t('sector.legend.hidden')} aria-label={t('sector.legend.hidden')}>
                            {' ✕'}
                          </span>
                        ) : null}
                      </td>
                      <td className="mono">{fmtSigned(c.best.offsetError, 2)}°</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}
