> 英文原文：[../../README.md](../../README.md)（以英文版為準）

# Reverse Shot Planner

> Tell it what you want to photograph. It finds where and when.
> （告訴它你想拍什麼，它幫你找出在哪裡拍、什麼時候拍。）

以目標為先的規劃工具：選定一個地標，選擇太陽或月亮與構圖，工具便會在周邊地形與指定日期範圍內，搜尋幾何上可行的拍攝機位與時間。開源優先：使用 MapLibre、OpenStreetMap 與開放的數值高程模型（DEM），不依賴任何專有地圖服務。

**狀態：** 八個階段中的第 1 階段：幾何核心（角度、大地測量、ECEF/ENU、相機視野（FOV）與投影）已完成並通過測試。尚無使用者介面。

```bash
npm install
npm run verify   # typecheck + lint + tests
```

- [ARCHITECTURE.md](ARCHITECTURE.md)：分層、慣例與模組
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)：各階段與驗收標準
- [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md)：未解風險與精度分析
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md)：相依套件、資料來源與授權
