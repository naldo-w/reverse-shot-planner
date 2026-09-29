> 英文原文：[../../README.md](../../README.md)（以英文版為準）

# Reverse Shot Planner

> Tell it what you want to photograph. It finds where and when.
> （告訴它你想拍什麼，它幫你找出在哪裡拍、什麼時候拍。）

以目標為先的規劃工具：選定一個地標，選擇太陽或月亮與構圖，工具便會在周邊地形與指定日期範圍內，搜尋幾何上可行的拍攝機位與時間。開源優先：使用 MapLibre、OpenStreetMap 與開放的數值高程模型（DEM），不依賴任何專有地圖服務。

**狀態：** 八個階段中的第 0–2 階段已完成：幾何核心與天文引擎（以 JPL DE421 驗證，誤差 ≤0.002°）。下一步：地形。尚無地圖使用者介面。

**線上頁面：** https://naldo-w.github.io/reverse-shot-planner/ （專案狀態 + 可實際操作的鏡頭視野（FOV）計算器）

```bash
npm install
npm run verify   # typecheck + lint + tests
```

- [ARCHITECTURE.md](ARCHITECTURE.md)：分層、慣例與模組
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)：各階段與驗收標準
- [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md)：未解風險與精度分析
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md)：相依套件、資料來源與授權
