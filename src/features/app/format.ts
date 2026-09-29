import type { Translate } from '../../app/i18n'
import { toLocalParts } from '../../core/planner'

export const pad2 = (n: number): string => String(n).padStart(2, '0')

export function fmtDate(date: Date, offsetMinutes: number): string {
  const p = toLocalParts(date, offsetMinutes)
  return `${String(p.y).padStart(4, '0')}-${pad2(p.mo)}-${pad2(p.d)}`
}

export function fmtClock(date: Date, offsetMinutes: number): string {
  const p = toLocalParts(date, offsetMinutes)
  return `${pad2(p.h)}:${pad2(p.mi)}`
}

export function fmtDateTime(date: Date, offsetMinutes: number): string {
  return `${fmtDate(date, offsetMinutes)} ${fmtClock(date, offsetMinutes)}`
}

/** 480 → "UTC+8", 330 → "UTC+5:30", -300 → "UTC-5". */
export function utcLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const h = Math.floor(abs / 60)
  const mi = abs % 60
  return `UTC${sign}${h}${mi ? `:${pad2(mi)}` : ''}`
}

export const fmtDeg = (n: number, digits = 2): string => n.toFixed(digits)

/** Always-signed number with a real minus sign, e.g. "+1.14" / "−0.42". */
export function fmtSigned(n: number, digits = 2): string {
  const s = Math.abs(n).toFixed(digits)
  return n < 0 && Number(s) !== 0 ? `−${s}` : `+${s}`
}

/** "+0.42° above" / "−0.42° below" (body relative to the landmark). */
export function offsetText(t: Translate, deg: number): string {
  return t(deg >= 0 ? 'align.above' : 'align.below', { deg: fmtSigned(deg, 2) })
}
