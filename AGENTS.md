# Agent Notes (LLM Context)

Read `README.md` first.

Project priorities:

- Keep the current setup working: controls/camera, debug tools, GitHub Pages build, and the localized carving pipeline.
- Box2D is the only physics engine; do not reintroduce old engines or “legacy” compatibility layers.
- Prefer deletion over keeping unused concepts.

When making changes:

- Start from `src/main.ts`, `src/RemeshManager.ts`, and `src/terrain/CanonicalGeometry.ts` for carving work.
- Validate with `npm run build` (GitHub Pages uses the production build) and keep `vite.config.ts` base at `'/cave/'` unless intentionally changing deploy paths.

