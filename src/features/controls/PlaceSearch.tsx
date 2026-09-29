import { useEffect, useRef, useState } from 'react'
import type { Translate } from '../../app/i18n'
import {
  GEOCODER_DEBOUNCE_MS,
  type Geocoder,
  type PlaceResult,
} from '../../providers/geocoder/nominatim'

interface PlaceSearchProps {
  readonly t: Translate
  readonly geocoder: Geocoder
  readonly mode: 'camera' | 'landmark'
  readonly onPick: (place: PlaceResult) => void
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; q: string }
  | { status: 'done'; q: string; results: PlaceResult[] }
  | { status: 'error'; q: string }

export function PlaceSearch({ t, geocoder, mode, onPick }: PlaceSearchProps) {
  const [query, setQuery] = useState('')
  const [raw, setState] = useState<SearchState>({ status: 'idle' })
  const token = useRef(0)
  const q = query.trim()
  // Results only count for the query they were made for (derived, no reset effect needed).
  const state: SearchState = raw.status !== 'idle' && raw.q === q && q.length >= 2 ? raw : { status: 'idle' }

  useEffect(() => {
    const id = ++token.current
    if (q.length < 2) return
    const timer = setTimeout(() => {
      setState({ status: 'loading', q })
      geocoder
        .search(q)
        .then((results) => {
          if (id === token.current) setState({ status: 'done', q, results })
        })
        .catch(() => {
          if (id === token.current) setState({ status: 'error', q })
        })
    }, GEOCODER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q, geocoder])

  return (
    <div className="search">
      <label htmlFor="place-search">
        {mode === 'camera' ? t('search.labelCamera') : t('search.labelLandmark')}
      </label>
      <input
        id="place-search"
        type="search"
        autoComplete="off"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {state.status === 'loading' ? <p className="hint">{t('search.loading')}</p> : null}
      {state.status === 'error' ? (
        <p className="warn-line" role="alert">
          {t('search.error')}
        </p>
      ) : null}
      {state.status === 'done' && state.results.length === 0 ? (
        <p className="hint">{t('search.none')}</p>
      ) : null}
      {state.status === 'done' && state.results.length > 0 ? (
        <ul className="place-list">
          {state.results.map((r) => (
            <li key={`${r.lat},${r.lon},${r.displayName}`}>
              <button
                type="button"
                title={r.displayName}
                onClick={() => {
                  onPick(r)
                  setQuery('')
                }}
              >
                <span className="place-name">{r.name || r.displayName}</span>
                <span className="place-sub">{r.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="hint">{t('search.attribution')}</p>
    </div>
  )
}
