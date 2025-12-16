# Carvable Caves (Box2D)

Procedural 2D caves generated from a scalar density field (Perlin noise) and surfaced with Marching Squares, rendered on Canvas2D, and collided via Box2D. Core feature: fast *localized carving* (stamp a brush → update only nearby terrain/physics).

This README is written as “context for future LLM agents”: what matters, where things live, and what invariants to preserve.

## What To Read First (Code Map)

- `src/main.ts` — app bootstrap, camera/controls/debug UI wiring, player + carve button, and the call site for localized carving (`carveAroundPlayer()` → `remeshManager.localUpdate()`).
- `src/PipelineConfig.ts` — most tunables (world size, camera behavior, carving brush params, optimization options).
- `src/DensityField.ts` — scalar field storage (`Uint8Array`), cave generation, brush stamping, dirty AABB tracking.
- `src/MarchingSquares.ts` — contour extraction (full world and region).
- `src/RemeshManager.ts` — full rebuild (“full heal”) and localized update pipeline (canonical surgery → opt splice → physics apply).
- `src/physics/Box2DEngine.ts` + `src/Box2DPhysics.ts` — Box2D world step + terrain fixture creation + debug draw.
- `src/terrain/CanonicalGeometry.ts` — canonical loops + ancestry-carrying optimized vertices + segment building for physics.
- `src/VertexOptimizationPipeline.ts` — simplify → Chaikin → simplify, producing optimized loops and segments.
- `src/Renderer.ts` — Canvas rendering + debug overlays for local carving.
- `src/DebugConsole.ts` — on-screen debug menu (toggles + log capture).

## Run / Build

Prereqs: Node 20+

- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview build output: `npm run preview`
- Micro-benchmark (carve region MS+cleaning): `npm run bench:carve`

## Controls (Player vs Camera)

The app has two modes (toggled from the debug menu):

- **Character control mode** (default): player moves, camera follows, virtual joystick shown on touch.
  - Keyboard: WASD / arrow keys (`src/controllers/CapsuleController.ts`)
  - Touch: virtual joystick on bottom-left (`src/VirtualJoystick.ts`)
  - Carve: tap the ⛏️ button (bottom-right) to carve *in front of the player* (`src/main.ts`)
- **Camera control mode**: pan/zoom the camera with pointer gestures (`src/InputHandler.ts`).

## Cave Generation

- Default cave generation is Perlin-based: `DensityField.generateCaves()` writes a continuous density field so Marching Squares can interpolate smooth edges.
- The “Cave Generator” UI can regenerate caves (and resize the world) at runtime: `src/CaveGeneratorUI.ts` → `CarvableCaves.regenerateCaves()` in `src/main.ts`.

Key concepts:

- **World space** is in metres.
- **Grid space** is density samples at `gridPitch` metres.
- **isoValue** (default `128`) is the surface threshold.
- **Border** is forced solid to keep loops closed (currently hardcoded in `DensityField.ts`).

## Terrain Pipeline (Full Heal)

The “full heal” path rebuilds everything:

1. Density field (`src/DensityField.ts`)
2. Marching Squares loops (`src/MarchingSquares.ts`)
3. Clean/repair loops (`src/physics/shapeUtils.ts` → `cleanLoop`)
4. Canonical representation (stable ids + loop metadata) (`src/terrain/CanonicalGeometry.ts`)
5. Optimization pipeline (simplify/Chaikin/simplify) (`src/VertexOptimizationPipeline.ts`)
6. Physics segment build and Box2D chain fixtures (`src/terrain/CanonicalGeometry.ts`, `src/physics/Box2DEngine.ts`)
7. Renderer polylines + debug overlays (`src/Renderer.ts`)

`RemeshManager.remesh()` drives this and updates physics + renderer.

## Localized Carving (Core Feature)

Carving is intentionally localized:

- A brush stamp modifies the density field and expands a *dirty AABB* (`DensityField.stampBrush()` + `DensityField.dirtyAABB`).
- `RemeshManager.localUpdate(expandCells)` uses that dirty AABB to only regenerate and patch nearby loops.

The local update pipeline (see `src/RemeshManager.ts`) is:

1. `beginLocalUpdateSession()` — compute padded region, run Marching Squares in-region, create new canonical loops, match “new” loops to affected “old” loops.
2. `commitLocalUpdateCanonical()` — patch the canonical loops in-place (keep ancestry stable).
3. `computeLocalUpdateOptAabbInvalidation()` → `rebuildLocalUpdateOpt()` → `commitLocalUpdateOptSplice()` — invalidate/rebuild only affected optimized spans, then splice back into the full optimized loops.
4. `applyLocalUpdatePhysics()` — remove/recreate only affected Box2D terrain bodies.

The production call site is `CarvableCaves.carveAroundPlayer()` in `src/main.ts`.

### Step-by-step Carving Debug (Optional)

There is an opt-in step debugger for the local update pipeline:

- Build/run with `CARVE_DEBUG=1` so `vite.config.ts` defines `__CARVE_DEBUG__`.
- Open with query param `?carveDebug` (or call `window.enableCarvingStepDebug()` from the console).
- A ▶️ button appears; each press advances through `CarvingDebugMode` stages.

Files: `src/debug/carving/installCarvingDebug.ts`, `src/debug/carving/CarvingDebugController.ts`, `src/CarvingDebugMode.ts`, `src/Renderer.ts`.

## Debug Tooling

- On-screen debug menu + log capture: `src/DebugConsole.ts` (toggles rendering overlays and pipes `console.*` into a scrollable panel).
- Physics debug drawing: `Box2DEngine.debugDraw()` (currently draws chain fixtures).
- Version/update UX: `scripts/generate-version.js` writes `public/version.json` at build; `src/VersionChecker.ts` polls it; `index.html` has an update button that clears caches and reloads.

## GitHub Pages / CI

- Vite base path is `'/cave/'` (`vite.config.ts`) and the PWA scope/start_url match it.
- GitHub Pages deploy workflow: `.github/workflows/deploy-pages.yml` (runs `npm ci` + `npm run build`, then uploads `dist/`).

## Project Invariants (Please Don’t Break These)

- **Box2D only**: no legacy physics engines are supported.
- **World units are metres**, `gridPitch` is metres-per-sample.
- **Localized carving** must remain localized: avoid “rebuild the whole world on carve” regressions.
- **GitHub Pages base path** is `'/cave/'` unless you also update workflows + PWA manifest/scope.

## Historical Note

Legacy experiments were deliberately deleted; there is a pre-cleanup snapshot tag: `legacy-cold-2025-12-16`.

