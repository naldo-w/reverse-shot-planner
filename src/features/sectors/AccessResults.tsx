import type { Translate } from '../../app/i18n'
import { MAX_EVALUATED, BUILDING_TILE_CAP, topAccessPoints } from '../../core/search/access'
import type { AccessPoint, AccessSummary } from '../../core/search/access'
import { fmtClock, fmtDate, fmtSigned } from '../app/format'
import { accessSummaryText } from './cellLines'
import { groupByFamily } from './sectorModel'

interface AccessResultsProps {
  readonly t: Translate
  readonly points: readonly AccessPoint[]
  readonly summary: AccessSummary
  readonly offsetMinutes: number
  readonly onPick: (p: AccessPoint) => void
}

/** Top 20 access points, best priority first, grouped by kind with their names. */
export function AccessResults({ t, points, summary, offsetMinutes, onPick }: AccessResultsProps) {
  const groups = groupByFamily(topAccessPoints(points, 20))
  return (
    <section className="ctl" aria-labelledby="r-access">
      <h2 id="r-access">{t('access.results.heading')}</h2>
      <p className="hint mono">{accessSummaryText(t, summary)}</p>
      {!summary.buildingsLoaded ? <p className="warn-line">{t('access.noBuildings')}</p> : null}
      {summary.capped ? <p className="hint">{t('access.capped', { n: MAX_EVALUATED })}</p> : null}
      {summary.buildingTilesRestricted ? <p className="hint">{t('access.restricted', { n: BUILDING_TILE_CAP })}</p> : null}
      {groups.length === 0 ? (
        <p className="hint">{t('access.results.none')}</p>
      ) : (
        <>
          <p className="hint">{t('access.results.desc')}</p>
          <div className="scroll-y">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('sector.results.where')}</th>
                  <th>{t('align.date')}</th>
                  <th>{t('align.time')}</th>
                  <th>{t('sector.results.error')}</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.family}>
                  <tr className="group-row">
                    <th colSpan={4}>{t(`access.kind.${g.family}`)}</th>
                  </tr>
                  {g.points.map((p) => (
                    <tr key={`${p.lat}-${p.lon}-${p.best.time.getTime()}`}>
                      <td>
                        <button type="button" className="rowbtn" onClick={() => onPick(p)}>
                          {p.name ?? `${p.bearing.toFixed(1)}° · ${(p.distance / 1000).toFixed(1)} km`}
                        </button>
                      </td>
                      <td className="mono">{fmtDate(p.best.time, offsetMinutes).slice(2)}</td>
                      <td className="mono">{fmtClock(p.best.time, offsetMinutes)}</td>
                      <td className="mono">{fmtSigned(p.best.offsetError, 2)}°</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </section>
  )
}
