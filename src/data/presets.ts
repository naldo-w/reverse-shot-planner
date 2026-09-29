/**
 * Preset landmarks and candidate shooting spots.
 *
 * Accuracy disclosure (shown in the UI):
 * - Landmark coordinates/heights are from the cited sources.
 * - Spot coordinates are APPROXIMATE (from place names; OSM/Nominatim was not
 *   reachable when these were written). The app lets the user correct any
 *   point by clicking the map; alignment results are always computed for the
 *   exact point currently set, so they stay self-consistent.
 * - Danjiang Bridge: the published coordinate is for the bridge as a whole,
 *   not surveyed to the pylon. Pylon height sources disagree (200 m vs 211 m).
 */

import type { Landmark, ShootingSpot } from '../core/planner/types'
import { deg, m } from '../core/units'

export type Confidence = 'high' | 'medium' | 'low'

export interface PresetLandmark extends Landmark {
  readonly confidence: Confidence
  readonly caveat: { readonly en: string; readonly zhTW: string }
}

export interface PresetSpot extends ShootingSpot {
  readonly confidence: Confidence
}

export const PRESET_LANDMARKS: readonly PresetLandmark[] = [
  {
    id: 'lion-rock',
    name: { en: 'Lion Rock, Hong Kong', zhTW: '香港獅子山' },
    kind: 'mountain',
    coordinate: { lat: deg(22.35310), lon: deg(114.18707) },
    topHeight: m(495),
    baseHeight: m(0),
    utcOffsetMinutes: 480,
    sources: ['https://en.wikipedia.org/wiki/Lion_Rock'],
    confidence: 'high',
    caveat: {
      en: 'Summit (lion’s head) per Wikipedia. The ridge silhouette comes from the terrain model.',
      zhTW: '山頂（獅頭）座標取自維基百科；山稜輪廓由地形模型計算。',
    },
  },
  {
    id: 'danjiang-bridge',
    name: { en: 'Danjiang Bridge, New Taipei', zhTW: '新北淡江大橋' },
    kind: 'structure',
    coordinate: { lat: deg(25.17531), lon: deg(121.41778) },
    topHeight: m(200),
    baseHeight: m(0),
    structure: {
      kind: 'cable-stayed-bridge',
      pylonHeight: m(180),
      deckHeight: m(20),
      // Crossing links the Tamsui (NE) and Bali (SW) banks; axis not surveyed.
      spanBearing: deg(35),
      spanLengthEachSide: [m(450), m(175)],
    },
    utcOffsetMinutes: 480,
    sources: [
      'https://en.wikipedia.org/wiki/Danjiang_Bridge',
      'https://zh.wikipedia.org/zh-tw/淡江大橋',
      'https://www.zaha-hadid.com/2025/10/22/danjiang-bridge-to-open-12-may-2026/',
    ],
    confidence: 'low',
    caveat: {
      en: 'Position is the bridge’s published point, not the surveyed pylon; pylon height 200 m (sources say 200–211 m); span axis approximate. Click the map on the pylon to correct.',
      zhTW: '位置為橋梁公開座標，非塔柱實測點；塔高採 200 公尺（資料 200–211 公尺不一）；橋軸方向為概略值。請在地圖上點選塔柱位置修正。',
    },
  },
]

export const PRESET_SPOTS: readonly PresetSpot[] = [
  // ---- Lion Rock: geometry-driven candidates (rise/set azimuths at 22.35°N: ~59–121° and ~239–301°)
  {
    id: 'lr-mei-foo',
    landmarkId: 'lion-rock',
    name: { en: 'Mei Foo / Lai Chi Kok waterfront', zhTW: '美孚／荔枝角海濱' },
    coordinate: { lat: deg(22.3375), lon: deg(114.1395) },
    groundHeight: null,
    note: {
      en: 'West-south-west of the rock: sunrise / moonrise behind the ridge in late spring and summer.',
      zhTW: '位於獅子山西南西：春末至夏季日出／月出可從山稜後升起。',
    },
    sources: [],
    confidence: 'low',
  },
  {
    id: 'lr-tsing-yi',
    landmarkId: 'lion-rock',
    name: { en: 'Tsing Yi east shore', zhTW: '青衣東岸' },
    coordinate: { lat: deg(22.3560), lon: deg(114.1060) },
    groundHeight: null,
    note: {
      en: 'Due west, ~8 km: sunrise / moonrise near the equinoxes, rock small and low — suits long lenses.',
      zhTW: '正西方約 8 公里：春秋分前後日出／月出，山形較小較低，適合長焦。',
    },
    sources: [],
    confidence: 'low',
  },
  {
    id: 'lr-kowloon-peak',
    landmarkId: 'lion-rock',
    name: { en: 'Kowloon Peak (Fei Ngo Shan) road', zhTW: '飛鵝山道' },
    coordinate: { lat: deg(22.3380), lon: deg(114.2240) },
    groundHeight: null,
    note: {
      en: 'East-south-east: sunset / moonset behind Lion Rock around early summer.',
      zhTW: '位於東南東：初夏前後日落／月落於獅子山後方。',
    },
    sources: [],
    confidence: 'low',
  },
  {
    id: 'lr-choi-hung',
    landmarkId: 'lion-rock',
    name: { en: 'Choi Hung / San Po Kong', zhTW: '彩虹／新蒲崗' },
    coordinate: { lat: deg(22.3346), lon: deg(114.2089) },
    groundHeight: null,
    note: {
      en: 'Where the lion shape reads best (Wikipedia). Rock is north-west: Sun/Moon never set behind it here — use for high Moon or twilight.',
      zhTW: '獅子形狀最清楚的角度（維基百科）。山在西北方，此處日月不會落在山後，適合高掛月亮或藍調時刻。',
    },
    sources: ['https://en.wikipedia.org/wiki/Lion_Rock'],
    confidence: 'low',
  },
  // ---- Danjiang Bridge: Central Weather Administration sunset spots (seasons from CWA via udn/NOWnews)
  {
    id: 'db-customs-wharf',
    landmarkId: 'danjiang-bridge',
    name: { en: 'Tamsui Customs Wharf', zhTW: '淡水海關碼頭' },
    coordinate: { lat: deg(25.1737), lon: deg(121.4378) },
    groundHeight: null,
    note: {
      en: 'CWA sunset spot: late Feb–late May, late Jul–early Nov.',
      zhTW: '氣象署夕陽機位：2 月下旬至 5 月下旬、7 月下旬至 11 月上旬。',
    },
    sources: ['https://udn.com/news/story/7266/9650515', 'https://www.nownews.com/news/6860031'],
    confidence: 'low',
  },
  {
    id: 'db-mackay',
    landmarkId: 'danjiang-bridge',
    name: { en: 'Mackay Landing Site', zhTW: '淡水馬偕登陸處' },
    coordinate: { lat: deg(25.1697), lon: deg(121.4415) },
    groundHeight: null,
    note: {
      en: 'CWA sunset spot: early Mar–early Oct.',
      zhTW: '氣象署夕陽機位：3 月上旬至 10 月上旬。',
    },
    sources: ['https://udn.com/news/story/7266/9650515', 'https://www.nownews.com/news/6860031'],
    confidence: 'low',
  },
  {
    id: 'db-huwei',
    landmarkId: 'danjiang-bridge',
    name: { en: 'Huwei Fishing Harbor', zhTW: '淡水滬尾漁港' },
    coordinate: { lat: deg(25.1745), lon: deg(121.4314) },
    groundHeight: null,
    note: {
      en: 'CWA sunset spot: mid-Mar–late May, late Jul–late Oct.',
      zhTW: '氣象署夕陽機位：3 月中旬至 5 月下旬、7 月下旬至 10 月下旬。',
    },
    sources: ['https://udn.com/news/story/7266/9650515'],
    confidence: 'low',
  },
  {
    id: 'db-youchekou',
    landmarkId: 'danjiang-bridge',
    name: { en: 'Youchekou boardwalk', zhTW: '淡水油車口木棧道' },
    coordinate: { lat: deg(25.1737), lon: deg(121.4296) },
    groundHeight: null,
    note: {
      en: 'CWA’s top pick for sunset with the bridge; year-round.',
      zhTW: '氣象署首推的大橋夕陽機位，全年皆可。',
    },
    sources: ['https://udn.com/news/story/7266/9650515', 'https://www.nownews.com/news/6860031'],
    confidence: 'low',
  },
  {
    id: 'db-bali-dock',
    landmarkId: 'danjiang-bridge',
    name: { en: 'Bali fishing-boat dock beach (east)', zhTW: '八里漁船碼頭沙灘東側' },
    coordinate: { lat: deg(25.1610), lon: deg(121.4200) },
    groundHeight: null,
    note: {
      en: 'Only Bali-side CWA sunset spot: June–early July.',
      zhTW: '八里側唯一的氣象署夕陽機位：6 月至 7 月上旬。',
    },
    sources: ['https://udn.com/news/story/7266/9650515'],
    confidence: 'low',
  },
]
