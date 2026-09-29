import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '../../app/i18n'
import { PlannerApp } from './PlannerApp'

describe('PlannerApp server render', () => {
  it('renders both languages without throwing', () => {
    for (const lang of ['en', 'zh-TW'] as const) {
      const html = renderToString(createElement(PlannerApp, { lang, t: makeTranslate(lang) }))
      expect(html).toContain('honesty')
      expect(html).toContain(lang === 'en' ? 'Structure outline is schematic.' : '結構物輪廓僅為示意。')
      expect(html).toContain('<svg')
    }
  })
})
