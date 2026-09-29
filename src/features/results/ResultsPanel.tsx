import type { Translate } from '../../app/i18n'
import type { Alignment, DailyEvents } from '../../core/planner/types'
import type { CelestialBody } from '../../core/types'
import { fmtClock, fmtDate, offsetText } from '../app/format'
import type { FinderState } from '../app/useAlignments'

interface ResultsProps {
  readonly t: Translate
  readonly offset: number
  readonly localDate: string
  readonly selectedBody: CelestialBody
  readonly selectedTimeMs: number
  readonly events: readonly DailyEvents[]
  readonly finder: FinderState
  readonly onFind: () => void
  readonly onPickEvent: (body: CelestialBody, time: Date) => void
  readonly onPickAlignment: (a: Alignment) => void
}

export function ResultsPanel(p: ResultsProps) {
  const { t, offset } = p
  const rows = p.events.flatMap((d) => d.events)

  return (
    <div className="results">
      <section className="ctl" aria-labelledby="r-events">
        <h2 id="r-events">{t('events.heading', { date: p.localDate })}</h2>
        {rows.length === 0 ? (
          <p className="hint">{t('events.none')}</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('events.event')}</th>
                <th>{t('events.time')}</th>
                <th>{t('events.azimuth')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const active = e.body === p.selectedBody && Math.abs(e.time.getTime() - p.selectedTimeMs) < 30_000
                return (
                  <tr key={`${e.body}-${e.kind}-${e.time.getTime()}`} className={active ? 'row-active' : undefined}>
                    <td>
                      <button type="button" className="rowbtn" onClick={() => p.onPickEvent(e.body, e.time)}>
                        {t(`event.${e.body}.${e.kind}`)}
                      </button>
                    </td>
                    <td className="mono">
                      {fmtClock(e.time, offset)}
                      {fmtDate(e.time, offset) !== p.localDate ? ` (${fmtDate(e.time, offset).slice(5)})` : ''}
                    </td>
                    <td className="mono">{e.azimuth.toFixed(1)}°</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="hint">{t('events.note')}</p>
      </section>

      <section className="ctl" aria-labelledby="r-find">
        <h2 id="r-find">{t('find.heading')}</h2>
        <p className="hint">{t('find.desc', { body: t(`body.${p.selectedBody}`) })}</p>
        <button type="button" className="primary" disabled={p.finder.status === 'loading'} onClick={p.onFind}>
          {p.finder.status === 'loading' ? t('find.loading') : t('find.button')}
        </button>
        {p.finder.status === 'loading' ? (
          <div className="progress" role="progressbar" aria-label={t('find.loading')}>
            <span />
          </div>
        ) : null}
        {p.finder.status === 'error' ? (
          <p className="warn-line" role="alert">
            {t('find.error')}
          </p>
        ) : null}
        {p.finder.status === 'done' && p.finder.results.length === 0 ? (
          <p className="hint">{t('find.empty')}</p>
        ) : null}
        {p.finder.status === 'done' && p.finder.results.length > 0 ? (
          <AlignmentTable t={t} offset={offset} list={p.finder.results} onPick={p.onPickAlignment} />
        ) : null}
        <p className="hint">{t('find.geometric')}</p>
      </section>
    </div>
  )
}

export function AlignmentTable(props: {
  t: Translate
  offset: number
  list: readonly Alignment[]
  onPick: (a: Alignment) => void
}) {
  const { t, offset } = props
  return (
    <div className="scroll-y">
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('align.date')}</th>
            <th>{t('align.time')}</th>
            <th>{t('align.dir')}</th>
            <th>{t('align.offset')}</th>
            <th>{t('align.illum')}</th>
          </tr>
        </thead>
        <tbody>
          {props.list.map((a) => (
            <tr key={`${a.body}-${a.time.getTime()}`}>
              <td className="mono">
                <button type="button" className="rowbtn mono" onClick={() => props.onPick(a)}>
                  {fmtDate(a.time, offset)}
                </button>
              </td>
              <td className="mono">{fmtClock(a.time, offset)}</td>
              <td>{a.direction === 'rising' ? t('align.rising') : t('align.setting')}</td>
              <td className="mono">{offsetText(t, a.verticalOffset)}</td>
              <td className="mono">
                {a.illumination === undefined ? '—' : `${Math.round(a.illumination * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
