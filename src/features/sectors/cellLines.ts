import type { Translate } from '../../app/i18n'
import type { SectorCell } from '../../core/search/sectors'
import { fmtClock, fmtDate, fmtSigned } from '../app/format'

/** Lines of the hover popup for one cell. */
export function cellLines(t: Translate, c: SectorCell, offsetMinutes: number): string[] {
  const time = c.best.time
  return [
    t('sector.pop.when', {
      date: fmtDate(time, offsetMinutes),
      time: fmtClock(time, offsetMinutes),
      dir: t(c.best.direction === 'rising' ? 'align.rising' : 'align.setting'),
    }),
    t('sector.pop.error', { deg: fmtSigned(c.best.offsetError, 2) }),
    t('sector.pop.where', { b: c.bearing.toFixed(1), d: (c.distance / 1000).toFixed(2) }),
    t('sector.pop.ground', { h: Math.round(c.groundHeight) }),
    c.visible === null ? t('sector.pop.vis.unknown') : t(c.visible ? 'sector.pop.vis.yes' : 'sector.pop.vis.no'),
    t('sector.pop.click'),
  ]
}
