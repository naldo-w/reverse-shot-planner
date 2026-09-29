import { useEffect, useMemo, useState } from 'react'
import { LANGS, makeTranslate, type Lang } from './app/i18n'
import { AboutPanel } from './features/app/AboutPanel'
import { PlannerApp } from './features/app/PlannerApp'

const LANG_KEY = 'rsp-lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'zh-TW') return saved
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    ? 'zh-TW'
    : 'en'
}

function App() {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [aboutOpen, setAboutOpen] = useState(false)
  const t = useMemo(() => makeTranslate(lang), [lang])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh-TW' ? 'zh-Hant-TW' : 'en'
    document.title = t('app.title')
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
  }, [lang, t])

  return (
    <div className="app" lang={lang === 'zh-TW' ? 'zh-Hant-TW' : 'en'}>
      <header className="header">
        <div>
          <h1>{t('app.title')}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="link"
            aria-expanded={aboutOpen}
            onClick={() => setAboutOpen((v) => !v)}
          >
            {t('about.link')}
          </button>
          <div className="lang" role="group" aria-label={t('lang.label')}>
            {LANGS.map((l) => (
              <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {aboutOpen ? <AboutPanel t={t} lang={lang} onClose={() => setAboutOpen(false)} /> : null}

      <PlannerApp lang={lang} t={t} />

      <footer className="footer">{t('footer.text')}</footer>
    </div>
  )
}

export default App
