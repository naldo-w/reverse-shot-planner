> 英文原文：[../../ATTRIBUTIONS.md](../../ATTRIBUTIONS.md)（以英文版為準）

# 出處與授權標示

列出 Reverse Shot Planner 使用的每一個外部相依套件與資料來源。新增相依套件或資料來源時，須在同一個 commit 中更新本檔。

## 執行期函式庫

| Package | Use | License | Source |
|---|---|---|---|
| React / React DOM | UI | MIT | https://github.com/facebook/react |
| MapLibre GL JS | 地圖渲染器（第 6 階段） | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js |
| SunCalc | 太陽／月亮位置與事件，封裝於 `CelestialEngine` 之後 | BSD-2-Clause, © Volodymyr Agafonkin | https://github.com/mourner/suncalc |

## 開發工具

| Package | License |
|---|---|
| TypeScript | Apache-2.0 |
| Vite, @vitejs/plugin-react | MIT |
| Vitest | MIT |
| oxlint | MIT |

## 演算法（獨立實作）

- Vincenty, T. (1975). *Direct and inverse solutions of geodesics on the ellipsoid.* Survey Review 23(176).
- Bowring, B. R. (1976). Transformation from spatial to geographical coordinates. Survey Review 23(181).
- WGS84 參數：NIMA TR8350.2。
- Meeus, J. *Astronomical Algorithms*（折射與視差公式，經由 SunCalc 取得）。

## 資料來源（規劃中，尚未使用）

| Source | Purpose | License / terms | Attribution text |
|---|---|---|---|
| OpenStreetMap | 底圖、地理編碼 | ODbL 1.0 | © OpenStreetMap contributors |
| Nominatim (public) | 地理編碼，僅限低用量 | OSMF 使用政策（≤1 req/s、有效的 UA、快取） | Data © OpenStreetMap contributors |
| Copernicus DEM GLO-30 | 地形 | Copernicus DEM 授權（免費，須標示出處）；於第 3 階段確認 | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA |
| SRTM GL1 / NASADEM | 地形備援 | 公有領域（NASA/USGS） | NASA SRTM / NASADEM |

## 字型與圖示

目前沒有。僅使用系統字型堆疊。

## 未使用

未使用 PhotoPills、The Photographer's Ephemeris、PlanIt!、Sun Surveyor 或任何其他商業工具的程式碼。未使用 Google Maps、Mapbox 專有服務、Apple MapKit 或 Google 3D Tiles。
