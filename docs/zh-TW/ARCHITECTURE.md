> 英文原文：[../../ARCHITECTURE.md](../../ARCHITECTURE.md)（以英文版為準）

# 架構

Reverse Shot Planner 只回答一個問題：**這個太陽／月亮構圖，可以在哪裡、什麼時候出現？**
搜尋引擎是產品本體；地圖只是它的介面。

## 技術堆疊（第 0 階段稽核）

儲存庫原本是空的，因此採用規格書的預設技術堆疊，沒有替換任何項目。

| Concern | Choice | Version | License |
|---|---|---|---|
| 語言 | TypeScript（strict、`noUncheckedIndexedAccess`） | 6.0 | Apache-2.0 |
| 建置 | Vite | 8.3 | MIT |
| UI | React | 19.3 | MIT |
| 地圖渲染器 | MapLibre GL JS（第 6 階段） | 6.11 | BSD-3-Clause |
| 天文 | SunCalc，經封裝（第 2 階段） | 2.0.2 | BSD-2-Clause |
| 測試 | Vitest | 5.0 | MIT |
| Lint | oxlint（隨 Vite 範本提供；沿用而不另行加入 ESLint） | 1.86 | MIT |

指令：`npm run verify` = typecheck → lint → test。每個階段都必須先通過此指令，才能開始下一階段。

## 分層

```
┌──────────────────────── UI (React) ────────────────────────┐
│ features/*  components/*  app/*                             │  no math here
└───────────────┬─────────────────────────────▲───────────────┘
                │ postMessage (SearchRequest) │ results / progress
┌───────────────▼─────────────── workers/ ────┴───────────────┐
│ search.worker.ts (terrain + astronomy batch inside)          │
└───────────────┬──────────────────────────────────────────────┘
                │ pure function calls
┌───────────────▼──────────────── core/ ──────────────────────┐
│ search  →  visibility  →  terrain   astronomy   camera       │
│               ↓              ↓          ↓          ↓         │
│         coordinates (ECEF/ENU)   geometry (angles, geodesy)  │
│                      units.ts  types.ts  wgs84.ts            │
└───────────────┬──────────────────────────────────────────────┘
                │ interfaces only
┌───────────────▼──────────── providers/ ─────────────────────┐
│ terrain/ (Copernicus, SRTM, OpenTopography, LocalDEM, Mock)  │
│ geocoder/ (Nominatim, Photon, …)   maps/ (tile styles)       │
└──────────────────────────────────────────────────────────────┘
```

規則：

1. `core/` 絕不匯入 React、MapLibre、SunCalc、`fetch` 或任何具體的 provider，因此可在純 Node 環境中測試。
2. SunCalc 只在一個檔案中匯入（`core/astronomy/suncalcEngine.ts`，第 2 階段），並置於 `CelestialEngine` 之後。
3. Provider 實作 `core/` 中宣告的介面；UI 負責選擇 provider，引擎負責接收。
4. 任何 O(candidates × dates) 的運算都在 Worker 中執行。主執行緒只負責渲染，不做其他事。
5. 模擬／示範資料只能透過明確命名的 `Mock*` provider 取得，且結果會附帶 provider 中介資料，讓 UI 能加上標示。

## 單位與慣例

定義於 `src/core/units.ts`、`types.ts`、`wgs84.ts`。

- 具品牌標記的 `Degrees` / `Radians` / `Meters` / `Millimeters`。三角函式以弧度運算；API 與 UI 以度數表示。
- 方位角（azimuth）：0 = 北，順時針，範圍 `[0, 360)`。高度角（altitude）：相對於當地水平面（橢球體法線）的仰角。
- 帶正負號的方位角差，範圍 `(-180, 180]`；正值 = 順時針（向右）。
- 高程：ECEF/ENU 運算採用橢球高。DEM 高程為正高（orthometric）；參見 `TECHNICAL_NOTES.md` §3。
- 幾何視角由 ECEF → ENU 求得（`lookAngle`、`LocalFrame`），因此地球曲率已隱含其中。`LocalFrame` 是供搜尋引擎使用的批次處理路徑。

## 第 1 階段交付的模組

| Module | Responsibility |
|---|---|
| `core/units.ts` | 具品牌標記的單位、單位換算 |
| `core/types.ts` | 共用領域型別（目標、地平線、天體、相機） |
| `core/wgs84.ts` | 橢球體常數（單一來源） |
| `core/geometry/angles.ts` | 正規化、環繞安全的差值、角距離（Vincenty 形式）、角直徑、方位角範圍 |
| `core/geometry/geodesy.ts` | Vincenty 反解／正解、haversine、方位、目的地、曲率下降量、局部位移、半徑界限 |
| `core/coordinates/ecef.ts` | 大地座標 ↔ ECEF（Bowring） |
| `core/coordinates/enu.ts` | ECEF ↔ ENU、水平方向、`lookAngle`、`LocalFrame` |
| `core/camera/fov.ts` | 水平／垂直／對角視野（FOV）、裁切、反推焦距 |
| `core/camera/projection.ts` | 精確的球心投影（gnomonic projection）：方向 ↔ 正規化感光元件座標，含滾轉（roll） |
| `data/cameraPresets.ts` | 感光元件預設值（僅為資料；引擎不依賴它們） |

## 規劃中的引擎介面

```ts
interface CelestialEngine { getSunPosition; getMoonPosition; getSunEvents; getMoonEvents }   // Phase 2
interface TerrainProvider { getElevation; getElevationGrid; getTile; getMetadata }           // Phase 3
interface Geocoder { search(query): Promise<PlaceResult[]> }                                  // Phase 6
castRay(camera, target, terrain): VisibilityResult                                            // Phase 4
calculateHorizonProfile(camera, terrain, azStart, azEnd, step): HorizonProfile                 // Phase 4
runSearch(req: SearchRequest, onProgress): AsyncIterable<CandidateResult>                     // Phase 5
```
