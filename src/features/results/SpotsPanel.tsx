import type { Lang, Translate } from '../../app/i18n'
import type { Alignment } from '../../core/planner/types'
import type { PresetSpot } from '../../data/presets'
import { ConfidenceBadge } from '../controls/Controls'
import { fmtClock, fmtDate, offsetText } from '../app/format'
import type { SpotRec } from '../app/useAlignments'

interface SpotsPanelProps {
  readonly t: Translate
  readonly lang: Lang
  readonly offset: number
  readonly spots: readonly PresetSpot[]
  readonly selectedSpotId: string
  readonly recs: ReadonlyMap<string, SpotRec>
  readonly onPickSpot: (spot: PresetSpot, first: Alignment | null) => void
  readonly onPickAlignment: (spot: PresetSpot, a: Alignment) => void
}

export function SpotsPanel(p: SpotsPanelProps) {
  const { t, offset } = p
  if (p.spots.length === 0) return null

  const earliest = (rec: SpotRec | undefined): Alignment | null => {
    if (!rec || rec.status !== 'done') return null
    return [...rec.sun, ...rec.moon].sort((a, b) => a.time.getTime() - b.time.getTime())[0] ?? null
  }

  const chips = (spot: PresetSpot, list: readonly Alignment[]) =>
    list.map((a) => (
      <li key={`${a.body}-${a.time.getTime()}`}>
        <button
          type="button"
          className="chip mono"
          title={`${offsetText(t, a.verticalOffset)} · ${a.direction === 'rising' ? t('align.rising') : t('align.setting')}`}
          onClick={() => p.onPickAlignment(spot, a)}
        >
          {fmtDate(a.time, offset)} {fmtClock(a.time, offset)}
          {a.illumination === undefined ? '' : ` · ${Math.round(a.illumination * 100)}%`}
        </button>
      </li>
    ))

  return (
    <section className="ctl" aria-labelledby="r-spots">
      <h2 id="r-spots">{t('spots.heading')}</h2>
      <p className="hint">{t('spots.desc')}</p>
      <ul className="spot-list">
        {p.spots.map((spot) => {
          const rec = p.recs.get(spot.id)
          return (
            <li key={spot.id} className={spot.id === p.selectedSpotId ? 'spot spot-active' : 'spot'}>
              <button type="button" className="spot-title" onClick={() => p.onPickSpot(spot, earliest(rec))}>
                {p.lang === 'zh-TW' ? spot.name.zhTW : spot.name.en}
              </button>{' '}
              <ConfidenceBadge t={t} level={spot.confidence} />
              <p className="hint">{p.lang === 'zh-TW' ? spot.note.zhTW : spot.note.en}</p>
              {!rec || rec.status === 'queued' ? <p className="hint">{t('spots.queued')}</p> : null}
              {rec?.status === 'loading' ? <p className="hint">{t('spots.computing')}</p> : null}
              {rec?.status === 'error' ? <p className="warn-line">{t('spots.error')}</p> : null}
              {rec?.status === 'done' ? (
                <div className="spot-recs">
                  <div>
                    <span className="k">{t('body.sun')}</span>
                    {rec.sun.length === 0 ? (
                      <span className="hint">{t('spots.none')}</span>
                    ) : (
                      <ul className="chips">{chips(spot, rec.sun)}</ul>
                    )}
                  </div>
                  <div>
                    <span className="k">{t('body.moon')}</span>
                    {rec.moon.length === 0 ? (
                      <span className="hint">{t('spots.none')}</span>
                    ) : (
                      <ul className="chips">{chips(spot, rec.moon)}</ul>
                    )}
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
