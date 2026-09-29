import type { Translate } from '../../app/i18n'
import type { AccessPoint, AccessSummary } from '../../core/search/access'
import type { SectorCell } from '../../core/search/sectors'
import { fmtClock, fmtDate, fmtSigned } from '../app/format'
import { accessFamily } from './sectorModel'

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

/** Lines of the hover popup for one access point. */
export function accessLines(t: Translate, p: AccessPoint, offsetMinutes: number): string[] {
  const kind = t(`access.kind.${accessFamily(p.kind)}`)
  const time = p.best.time
  return [
    p.name === undefined ? kind : t('access.pop.title', { name: p.name, kind }),
    t('sector.pop.when', {
      date: fmtDate(time, offsetMinutes),
      time: fmtClock(time, offsetMinutes),
      dir: t(p.best.direction === 'rising' ? 'align.rising' : 'align.setting'),
    }),
    t('sector.pop.error', { deg: fmtSigned(p.best.offsetError, 2) }),
    t('sector.pop.where', { b: p.bearing.toFixed(1), d: (p.distance / 1000).toFixed(2) }),
    t('sector.pop.ground', { h: Math.round(p.groundHeight) }),
    t('sector.pop.click'),
  ]
}

/** "N spots can shoot · blocked by buildings X · blocked by terrain Y · no accessible path Z". */
export function accessSummaryText(t: Translate, s: AccessSummary): string {
  return t('access.summary', {
    n: s.visible,
    b: s.blockedByBuilding,
    t: s.blockedByTerrain,
    z: s.noAccess,
  })
}
