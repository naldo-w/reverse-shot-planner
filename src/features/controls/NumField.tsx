import { useId, useState } from 'react'

interface NumFieldProps {
  readonly label: string
  readonly value: number
  readonly onCommit: (n: number) => void
  readonly min: number
  readonly max: number
  readonly integer?: boolean
  readonly suffix?: string
  readonly className?: string
  /** Minimum number of digits required before a value is committed (e.g. 4 for years). */
  readonly minDigits?: number
}

const show = (n: number, integer: boolean): string =>
  integer ? String(Math.round(n)) : String(Number(n.toFixed(5)))

/**
 * Text-based numeric field that keeps a local draft while typing and commits
 * only valid, in-range values. Reverts to the committed value on blur.
 */
export function NumField(p: NumFieldProps) {
  const id = useId()
  const integer = p.integer ?? false
  const [draft, setDraft] = useState(show(p.value, integer))
  const [seen, setSeen] = useState(p.value)
  const [focused, setFocused] = useState(false)
  if (p.value !== seen) {
    setSeen(p.value)
    if (!focused) setDraft(show(p.value, integer))
  }

  const onChange = (text: string) => {
    setDraft(text)
    const trimmed = text.trim()
    if (trimmed === '' || !/^[-+]?\d*\.?\d*$/.test(trimmed)) return
    const digits = trimmed.replace(/\D/g, '').length
    if (p.minDigits && digits < p.minDigits) return
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < p.min || n > p.max) return
    if (integer && !Number.isInteger(n)) return
    p.onCommit(n)
  }

  return (
    <div className={`num ${p.className ?? ''}`}>
      <label htmlFor={id}>{p.label}</label>
      <span className="num-box">
        <input
          id={id}
          className="mono"
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setDraft(show(p.value, integer))
          }}
          onChange={(e) => onChange(e.target.value)}
        />
        {p.suffix ? <span className="suffix">{p.suffix}</span> : null}
      </span>
    </div>
  )
}
