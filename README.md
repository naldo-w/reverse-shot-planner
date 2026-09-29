# Reverse Shot Planner

> Tell it what you want to photograph. It finds where and when.

A target-first planner: pick a landmark, choose Sun or Moon and a composition, and it searches the surrounding terrain and a date range for camera positions and times where that shot is geometrically possible. Open-source first — MapLibre, OpenStreetMap, open DEMs, no proprietary map services.

**Status:** Phase 1 of 8 — geometry core (angles, geodesy, ECEF/ENU, camera FOV & projection) complete and tested. No UI yet.

```bash
npm install
npm run verify   # typecheck + lint + tests
```

- [ARCHITECTURE.md](ARCHITECTURE.md) — layering, conventions, modules
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — phases and acceptance criteria
- [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md) — open risks and accuracy analysis
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md) — dependencies, data sources, licences
