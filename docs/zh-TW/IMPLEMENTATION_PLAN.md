> 英文原文：[../../IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md)（以英文版為準）

# 實作計畫

每個階段結束時，`npm run verify` 必須全數通過並完成一次 commit。失敗的測試一律修正，絕不跳過。

## Phase 0 — 稽核與基礎建設 ✅
- 空儲存庫 → Vite + React + strict TS、Vitest、oxlint（範本預設）、git。
- 相依套件授權稽核（見 `ATTRIBUTIONS.md`）。
- 共用契約：`units.ts`、`types.ts`、`wgs84.ts`。
- 文件：本檔、`ARCHITECTURE.md`、`TECHNICAL_NOTES.md`、`ATTRIBUTIONS.md`。

## Phase 1 — 領域幾何 ✅
- 角度、大地測量、ECEF/ENU、相機視野（FOV）與球心投影（gnomonic projection）、相機預設值。
- 114 項測試，含已發表的參考值（Vincenty 的 Flinders Peak → Buninyong）與跨模組一致性測試（`tests/geometry.integration.test.ts`）。

## Phase 2 — 天文（下一階段）
驗收標準：
- `CelestialEngine` 介面 + `SuncalcEngine` 轉接器；SunCalc 不得在其他任何地方匯入。
- 太陽／月亮位置、升落事件、月面照明比例、由距離換算的角直徑。
- 事件以**當地**曆日計算（SunCalc 的月亮時刻使用 UTC 日；香港為 UTC+8）。
- 以 JPL Horizons 的參考基準資料（fixtures；站心（topocentric）、無大氣*與*含大氣折射兩種）驗證，涵蓋香港與一處高緯度地點，日期橫跨 2026–2027 年數個時點。目標容差：太陽 ≤ 0.02°，月亮 ≤ 0.05°。若 SunCalc 的月亮不達標，加入 `AstronomyEngineEngine` 轉接器（astronomy-engine，MIT）並設為預設，詳見 TECHNICAL_NOTES §1。
- 同時提供幾何（無大氣）高度角與視高度角（apparent altitude），讓對齊模型能套用一致的大氣折射政策。

## Phase 3 — 地形
- `TerrainProvider` 介面、`TerrainMetadata`（DTM/DSM、解析度、基準面）。
- 第一個真實 provider：Copernicus GLO-30，經由公開的雲端最佳化 GeoTIFF（cloud-optimised GeoTIFF）圖磚（免金鑰）；存取方式與授權於第 3 階段啟動時確認。備案：AWS Terrain Tiles（Terrarium PNG，Mapzen/Joerd，開放授權）。
- 在型別化陣列（typed array）上做雙線性高程取樣；`MockTerrainProvider` 提供解析曲面（平面、錐形丘、山脊、牆）。
- IndexedDB 圖磚快取，以 `provider/dataset/z/x/y` + 快取版本為鍵。

## Phase 4 — 可見性
- 使用 `LocalFrame` 在 ENU 中做射線投射（ray casting），曲率已隱含，地面大氣折射係數 k 作為參數。
- `calculateHorizonProfile`（0.1° 步進）：先寫合成地形測試。
- 附角度餘裕的 `VisibilityResult`。

## Phase 5 — 反向搜尋（Worker）
- 半徑內的候選網格，由粗到細再分割。
- 每個候選點：目標視角（靜態）→ 在升落時間窗內迴圈掃描日期 → 對對齊誤差做黃金分割（golden-section）時間精修 → 目標與天體的可見性 → 透明的 `AlignmentScore`。
- 剪枝：只有當目標方位角落在該緯度下天體全年升落方位角帶內時，候選點才可能對齊；先計算一次該方位角帶，在進入任何日期迴圈前捨棄其餘候選點。

## Phase 6 — 地圖 UI
MapLibre、OSM 點陣圖／向量樣式、地形來源，目標可由點擊／座標／地理編碼器指定（節流的 Nominatim，含快取），半徑疊加層，候選點作為 GeoJSON 圖層，結果清單 ↔ 地圖連動。深色儀器風格 UI。

## Phase 7 — 相機模擬
Canvas 視埠：地平線剖面（horizon profile）、目標剪影、依比例繪製的天體圓盤、天體軌跡、FOV 取景框。

## Phase 8 — UX 打磨
載入／進度、錯誤、空狀態、出處標示面板、provider／解析度徽章、排序、URL 狀態。

## 委派模式
協調者（orchestrator）負責契約（`units`、`types`、介面）與整合；各工作者（worker）在每個階段負責互不重疊的檔案，並附明確的驗收標準（測試、型別檢查、lint）。跨模組整合測試由協調者撰寫。
