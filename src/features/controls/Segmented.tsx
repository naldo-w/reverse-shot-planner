interface SegmentedProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: readonly { readonly id: T; readonly label: string }[]
  readonly onChange: (v: T) => void
}

export function Segmented<T extends string>(p: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={p.value === o.id}
          onClick={() => p.onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
