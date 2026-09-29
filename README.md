# Reverse Shot Planner

[繁體中文](docs/zh-TW/README.md)

> Tell it what you want to photograph. It finds where and when.

A target-first planner: pick a landmark, choose Sun or Moon and a composition, and it searches the surrounding terrain and a date range for camera positions and times where that shot is geometrically possible. Open-source first — MapLibre, OpenStreetMap, open DEMs, no proprietary map services.

**Status:** working location-first planner. Pick a landmark (presets: Lion Rock, Danjiang Bridge) and a camera spot on the map, then preview the Sun/Moon at any minute, over a day, or across many days in a 1px-outline camera frame with a terrain skyline; find every Sun/Moon crossing behind the landmark in the next 12 months. Astronomy validated against JPL DE421 (≤0.002°). Next: target-first reverse search over an area (Phase 5).

**Live page:** https://naldo-w.github.io/reverse-shot-planner/ (project status + a working lens FOV calculator)

```bash
npm install
npm run verify   # typecheck + lint + tests
```

- [ARCHITECTURE.md](ARCHITECTURE.md) — layering, conventions, modules
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — phases and acceptance criteria
- [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md) — open risks and accuracy analysis
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md) — dependencies, data sources, licences
