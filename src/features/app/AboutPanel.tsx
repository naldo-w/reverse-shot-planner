import { LINKS, type Lang, type Translate } from '../../app/i18n'
import { PHASES, TOTAL_PHASES, currentPhase } from '../../app/status'
import { FOCAL_MAX_MM, FOCAL_MIN_MM, useFov } from '../../app/useFov'
import { CAMERA_PRESETS } from '../../data/cameraPresets'

const fmt = (n: number, digits: number) => n.toFixed(digits)

interface AboutPanelProps {
  readonly t: Translate
  readonly lang: Lang
  readonly onClose: () => void
}

/** Project status, lens FOV calculator and links (the original entry page). */
export function AboutPanel({ t, lang, onClose }: AboutPanelProps) {
  const cur = currentPhase()
  const { presetId, setPresetId, focalText, setFocalText, result } = useFov()

  return (
    <section className="about" aria-labelledby="about-h">
      <div className="pane-head">
        <h2 id="about-h">{t('about.heading')}</h2>
        <button type="button" className="link" onClick={onClose}>
          {t('about.close')}
        </button>
      </div>
      <div className="about-grid">
        <div className="panel" aria-labelledby="status-h">
          <h2 id="status-h">{t('status.heading')}</h2>
          <p className="status-line">
            {t('status.line', { phase: cur.id, total: TOTAL_PHASES, name: t(cur.nameKey as never) })}
          </p>
          <ol className="phases">
            {PHASES.map((p) => (
              <li key={p.id} className={`phase phase-${p.state}`}>
                <span className="num">{p.id}</span>
                <span className="name">{t(p.nameKey as never)}</span>
                <span className="state">{t(`state.${p.state}`)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="panel" aria-labelledby="fov-h">
          <h2 id="fov-h">{t('fov.heading')}</h2>
          <div className="fields">
            <label>
              <span>{t('fov.camera')}</span>
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                {CAMERA_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('fov.focal')}</span>
              <input
                className="mono"
                type="number"
                inputMode="decimal"
                min={FOCAL_MIN_MM}
                max={FOCAL_MAX_MM}
                step="any"
                value={focalText}
                onChange={(e) => setFocalText(e.target.value)}
              />
              <small>{t('fov.range')}</small>
            </label>
          </div>
          {result ? (
            <dl className="readout">
              <div>
                <dt>{t('fov.horizontal')}</dt>
                <dd className="mono">{fmt(result.fov.horizontal, 3)}°</dd>
              </div>
              <div>
                <dt>{t('fov.vertical')}</dt>
                <dd className="mono">{fmt(result.fov.vertical, 3)}°</dd>
              </div>
              <div>
                <dt>{t('fov.diagonal')}</dt>
                <dd className="mono">{fmt(result.fov.diagonal, 3)}°</dd>
              </div>
              <div>
                <dt>{t('fov.moon')}</dt>
                <dd className="mono">{t('fov.moonValue', { pct: fmt(result.moonPercent, 1) })}</dd>
              </div>
            </dl>
          ) : (
            <p className="warn" role="alert">
              {t('fov.invalid')}
            </p>
          )}
          <p className="note">{t('fov.note')}</p>
        </div>

        <div className="panel" aria-labelledby="links-h">
          <h2 id="links-h">{t('links.heading')}</h2>
          <ul className="links">
            <li><a href={LINKS.repo}>{t('links.repo')}</a></li>
            <li><a href={LINKS.docs[lang]}>{t('links.docs')}</a></li>
            <li><a href={LINKS.license}>{t('links.license')}</a></li>
            <li><a href={LINKS.attributions}>{t('links.attributions')}</a></li>
          </ul>
        </div>
      </div>
    </section>
  )
}
