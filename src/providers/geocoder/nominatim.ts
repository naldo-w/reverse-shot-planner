/**
 * Geocoder provider (Nominatim public API).
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * at most one request per second, cache results, identify the application
 * (browsers send a Referer). The 700 ms input debounce lives in the UI; the
 * ≥ 1 s spacing between network requests is enforced here.
 */

export interface PlaceResult {
  readonly name: string
  readonly displayName: string
  readonly lat: number
  readonly lon: number
}

export interface Geocoder {
  search(query: string): Promise<PlaceResult[]>
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
export const GEOCODER_DEBOUNCE_MS = 700
export const GEOCODER_MIN_INTERVAL_MS = 1000
const STORAGE_PREFIX = 'rsp-geo:'

interface RawPlace {
  readonly lat?: unknown
  readonly lon?: unknown
  readonly name?: unknown
  readonly display_name?: unknown
}

function parsePlaces(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) throw new Error('unexpected response')
  const out: PlaceResult[] = []
  for (const item of json as RawPlace[]) {
    const lat = Number(item.lat)
    const lon = Number(item.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const displayName = typeof item.display_name === 'string' ? item.display_name : ''
    const name =
      typeof item.name === 'string' && item.name ? item.name : (displayName.split(',')[0] ?? '')
    out.push({ name, displayName, lat, lon })
  }
  return out
}

function readSession(key: string): PlaceResult[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    return raw ? parsePlaces(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeSession(key: string, value: PlaceResult[]): void {
  try {
    sessionStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify(value.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name, display_name: p.displayName }))),
    )
  } catch {
    /* storage unavailable or full: cache is best-effort */
  }
}

// Shared across instances so switching language never breaks the 1 req/s policy.
let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

export class NominatimGeocoder implements Geocoder {
  private readonly getLanguage: () => string
  private readonly memory = new Map<string, PlaceResult[]>()

  constructor(getLanguage: () => string) {
    this.getLanguage = getLanguage
  }

  search(query: string): Promise<PlaceResult[]> {
    const q = query.trim()
    if (q.length < 2) return Promise.resolve([])
    const lang = this.getLanguage()
    const key = `${lang}|${q.toLowerCase()}`
    const cached = this.memory.get(key) ?? readSession(key)
    if (cached) {
      this.memory.set(key, cached)
      return Promise.resolve(cached)
    }
    const run = queue.then(() => this.fetchPlaces(q, lang, key))
    queue = run.catch(() => undefined)
    return run
  }

  private async fetchPlaces(q: string, lang: string, key: string): Promise<PlaceResult[]> {
    const cached = this.memory.get(key)
    if (cached) return cached
    const wait = lastRequestAt + GEOCODER_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    const url = new URL(ENDPOINT)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('q', q)
    url.searchParams.set('limit', '6')
    url.searchParams.set('accept-language', lang)
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const places = parsePlaces(await res.json())
    this.memory.set(key, places)
    writeSession(key, places)
    return places
  }
}
