# Reverse Shot Planner

[繁體中文](docs/zh-TW/README.md)

> Tell it what you want to photograph. It finds where and when.

A target-first planner: pick a landmark, choose Sun or Moon and a composition, and it searches the surrounding terrain and a date range for camera positions and times where that shot is geometrically possible. Open-source first — MapLibre, OpenStreetMap, open DEMs, no proprietary map services.

**Status:** Phases 0–2 of 8 complete — geometry core and astronomy engine (validated against JPL DE421 to ≤0.002°). Next: terrain. No map UI yet.

**Live page:** https://naldo-w.github.io/reverse-shot-planner/ (project status + a working lens FOV calculator)

```bash
npm install
npm run verify   # typecheck + lint + tests
```

- [ARCHITECTURE.md](ARCHITECTURE.md) — layering, conventions, modules
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — phases and acceptance criteria
- [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md) — open risks and accuracy analysis
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md) — dependencies, data sources, licences
