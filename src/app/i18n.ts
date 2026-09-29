export type Lang = 'en' | 'zh-TW'

export const LANGS: readonly { readonly id: Lang; readonly label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'zh-TW', label: '繁中' },
]

const en = {
  'app.title': 'Reverse Shot Planner',
  'app.tagline': 'Tell it what you want to photograph. It finds where and when.',
  'lang.label': 'Language',
  'status.heading': 'Status',
  'status.line':
    'In development — Phase {phase} of {total} ({name}). The map search is not available yet.',
  'state.done': 'done',
  'state.in-progress': 'in progress',
  'state.planned': 'planned',
  'phase.0': 'Audit & foundation',
  'phase.1': 'Domain geometry',
  'phase.2': 'Astronomy engine',
  'phase.3': 'Terrain',
  'phase.4': 'Visibility',
  'phase.5': 'Reverse search',
  'phase.6': 'Map UI',
  'phase.7': 'Camera simulation',
  'phase.8': 'UX polish',
  'fov.heading': 'Lens field of view',
  'fov.note': 'Rectilinear lens focused at infinity. Uses the same tested core as the planner.',
  'fov.camera': 'Camera',
  'fov.focal': 'Focal length (mm)',
  'fov.range': 'Range 8–2000 mm',
  'fov.horizontal': 'Horizontal',
  'fov.vertical': 'Vertical',
  'fov.diagonal': 'Diagonal',
  'fov.moon': 'Moon diameter (mean distance)',
  'fov.moonValue': '≈ {pct}% of frame width',
  'fov.invalid': 'Enter a focal length between 8 and 2000 mm.',
  'links.heading': 'Links',
  'links.repo': 'GitHub repository',
  'links.docs': 'Documentation',
  'links.license': 'License (MIT)',
  'links.attributions': 'Attributions',
  'footer.text': 'Open-source · MapLibre · OpenStreetMap · open DEMs — no proprietary map services.',
} as const

export type MessageKey = keyof typeof en

const zhTW: Record<MessageKey, string> = {
  'app.title': 'Reverse Shot Planner',
  'app.tagline': '告訴它你想拍什麼，它會找出在哪裡、什麼時候拍。',
  'lang.label': '語言',
  'status.heading': '狀態',
  'status.line': '開發中 — 共 {total} 個階段，目前為第 {phase} 階段（{name}）。地圖搜尋功能尚未開放。',
  'state.done': '已完成',
  'state.in-progress': '進行中',
  'state.planned': '規劃中',
  'phase.0': '稽核與基礎建置',
  'phase.1': '領域幾何',
  'phase.2': '天文引擎',
  'phase.3': '地形',
  'phase.4': '可見性',
  'phase.5': '反向搜尋',
  'phase.6': '地圖介面',
  'phase.7': '相機模擬',
  'phase.8': '使用體驗優化',
  'fov.heading': '鏡頭視角',
  'fov.note': '假設為直線鏡頭並對焦於無限遠，使用與規劃器相同、經過測試的核心運算。',
  'fov.camera': '相機',
  'fov.focal': '焦距（mm）',
  'fov.range': '範圍 8–2000 mm',
  'fov.horizontal': '水平',
  'fov.vertical': '垂直',
  'fov.diagonal': '對角線',
  'fov.moon': '月球直徑（平均距離）',
  'fov.moonValue': '約佔畫面寬度的 {pct}%',
  'fov.invalid': '請輸入 8 至 2000 mm 之間的焦距。',
  'links.heading': '連結',
  'links.repo': 'GitHub 儲存庫',
  'links.docs': '文件',
  'links.license': '授權條款（MIT）',
  'links.attributions': '致謝與授權聲明',
  'footer.text': '開源 · MapLibre · OpenStreetMap · 開放數值高程模型 — 不使用專有地圖服務。',
}

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, 'zh-TW': zhTW }

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

export function makeTranslate(lang: Lang): Translate {
  const table = MESSAGES[lang]
  return (key, vars) =>
    table[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`))
}

const REPO = 'https://github.com/naldo-w/reverse-shot-planner'
export const LINKS = {
  repo: REPO,
  docs: {
    en: `${REPO}#readme`,
    'zh-TW': `${REPO}/blob/main/docs/zh-TW/README.md`,
  } satisfies Record<Lang, string>,
  license: `${REPO}/blob/main/LICENSE`,
  attributions: `${REPO}/blob/main/ATTRIBUTIONS.md`,
} as const
