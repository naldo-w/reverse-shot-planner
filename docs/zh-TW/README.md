> 英文原文：[../../README.md](../../README.md)（以英文版為準）

# Reverse Shot Planner

> Tell it what you want to photograph. It finds where and when.
> （告訴它你想拍什麼，它幫你找出在哪裡拍、什麼時候拍。）

以目標為先的規劃工具：選定一個地標，選擇太陽或月亮與構圖，工具便會在周邊地形與指定日期範圍內，搜尋幾何上可行的拍攝機位與時間。開源優先：使用 MapLibre、OpenStreetMap 與開放的數值高程模型（DEM），不依賴任何專有地圖服務。

**狀態：** 可運作的「地點優先」規劃器。在地圖上選定地標（預設：獅子山、淡江大橋）與相機位置後，可預覽任一分鐘、整日或多日的太陽／月亮，以 1px 線框相機取景框搭配地形天際線呈現；並可找出未來 12 個月內太陽／月亮與地標重合的所有時刻。天文計算以 JPL DE421 驗證（≤0.002°）。下一步：涵蓋整個區域的「目標優先」反向搜尋（第 5 階段）。

**線上頁面：** https://naldo-w.github.io/reverse-shot-planner/ （專案狀態 + 可實際操作的鏡頭視野（FOV）計算器）

```bash
npm install
npm run verify   # typecheck + lint + tests
```

- [ARCHITECTURE.md](ARCHITECTURE.md)：分層、慣例與模組
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)：各階段與驗收標準
- [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md)：未解風險與精度分析
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md)：相依套件、資料來源與授權
