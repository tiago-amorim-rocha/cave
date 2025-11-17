# Box2D Migration Plan - Cave Terrain + Spider Controller

## Executive Summary

**Goal:** Migrate the cave generation PWA from Rapier 2D to Box2D, focusing on:
1. **Cave terrain collision** (procedurally generated boundaries)
2. **Spider controller integration** (from spider-box2d-experiment)

**Out of scope:** Balls, capsule player controller, and other dynamic objects will be **archived to legacy/** for reference but NOT migrated.

**Estimated effort:** 3-4 days
- Cave collision migration: 1-2 days
- Spider integration: 1 day
- Cleanup & testing: 1 day

---

## Phase 1: Dependencies & Setup (30 mins)

### 1.1 Update package.json

**Remove:**
```json
"@dimforge/rapier2d-compat": "^0.19.3"
```

**Add:**
```json
"@box2d/core": "^0.11.0",
"@box2d/debug-draw": "^0.11.0"
```

**Keep:**
```json
"poly-decomp": "^0.3.0",  // Keep for potential future use
"workbox-window": "^7.0.0"
```

### 1.2 Install dependencies

```bash
npm install
```

---

## Phase 2: Archive Legacy Code (30 mins)

### 2.1 Create legacy folder structure

```bash
mkdir -p src/legacy/physics
mkdir -p src/legacy/controllers
```

### 2.2 Move files to legacy/ (preserve for reference)

**Physics engine files:**
- `src/physics/engine.ts` → `src/legacy/physics/rapier-engine.ts`
- `src/RapierPhysics.ts` → `src/legacy/physics/RapierPhysics.ts`

**Controller files:**
- `src/controllers/ForcePlayerController.ts` → `src/legacy/controllers/ForcePlayerController.ts`
- `src/Player.matter.ts.bak` → Already archived, leave as is

**Note:** Do NOT delete these files, just move them for reference.

### 2.3 Update .gitignore (optional)

Add note that legacy/ is for reference:
```
# Legacy code (Rapier, old controllers) - preserved for reference
# src/legacy/
```

(Don't actually ignore it - just document its purpose)

---

## Phase 3: Cave Collision Migration (1-2 days)

### 3.1 Create new Box2D engine

**File:** `src/physics/Box2DEngine.ts`

**Key features:**
- Fixed timestep (60 Hz)
- b2World with gravity (0, 10) m/s²
- Debug rendering support
- Interface compatible with existing code

**Configuration:**
```typescript
const PHYSICS_HZ = 60;
const PHYSICS_DT = 1 / 60; // ~16.67ms
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const GRAVITY = new b2Vec2(0, 10); // Y-down, 10 m/s²
```

### 3.2 Implement cave terrain generation

**Core challenge:** Convert marching squares polylines to Box2D collision shapes.

**Solution: b2ChainShape**

b2ChainShape is designed for terrain boundaries and prevents ghost collisions at edge junctions (similar to Rapier's polyline colliders).

**Implementation:**

```typescript
/**
 * Update terrain colliders from marching squares loops
 * Uses b2ChainShape for exact boundary representation
 */
setTerrainLoops(loops: Point[][]): void {
  // Remove old terrain bodies
  for (const body of this.terrainBodies) {
    this.world.DestroyBody(body);
  }
  this.terrainBodies = [];

  let totalSegments = 0;
  let closedLoops = 0;
  let openChains = 0;

  for (const loop of loops) {
    if (loop.length < 2) continue;

    // Create static body for this terrain loop
    const bodyDef = new b2BodyDef();
    bodyDef.type = b2BodyType.b2_staticBody;
    const body = this.world.CreateBody(bodyDef);

    // Convert loop to b2Vec2 array
    const vertices = loop.map(p => new b2Vec2(p.x, p.y));

    // Check if loop is properly closed (first ≈ last)
    const firstPoint = vertices[0];
    const lastPoint = vertices[vertices.length - 1];
    const dx = lastPoint.x - firstPoint.x;
    const dy = lastPoint.y - firstPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const isClosed = distance < 0.01; // Within 1cm tolerance

    // Create chain shape
    const chainShape = new b2ChainShape();

    if (isClosed) {
      // Remove duplicate last vertex and create closed loop
      chainShape.CreateLoop(vertices.slice(0, -1));
      closedLoops++;
    } else {
      // Create open chain (keeps all vertices)
      chainShape.CreateChain(vertices);
      openChains++;
      console.warn(`[Box2DEngine] Non-closed loop detected! Distance: ${distance.toFixed(4)}m`);
    }

    // Create fixture with physics properties
    const fixtureDef = new b2FixtureDef();
    fixtureDef.shape = chainShape;
    fixtureDef.friction = 0.3;
    fixtureDef.restitution = 0.1;
    fixtureDef.density = 0; // Static body

    body.CreateFixture(fixtureDef);
    this.terrainBodies.push(body);

    totalSegments += loop.length - 1;
  }

  console.log(`[Box2DEngine] Created ${this.terrainBodies.length} terrain bodies (${totalSegments} segments)`);
  console.log(`[Box2DEngine] Loop closure: ${closedLoops} closed, ${openChains} open`);
}
```

**Critical considerations:**

1. **Closed vs Open loops:**
   - Use `CreateLoop()` for closed loops (removes last vertex automatically)
   - Use `CreateChain()` for open chains (rare in marching squares)

2. **Performance:**
   - b2ChainShape handles long chains efficiently
   - Current implementation: ~2,000-5,000 segments per world
   - If performance issues arise, consider splitting chains into chunks

3. **One-sided collision:**
   - Chain shapes support one-sided collision (prevents tunneling)
   - Set `prevVertex` and `nextVertex` if needed (advanced)

### 3.3 Physics stepping with fixed timestep

```typescript
/**
 * Step physics with fixed timestep accumulator
 */
step(dt: number): void {
  if (!this.world) {
    console.error('[Box2DEngine] World not initialized!');
    return;
  }

  // Convert dt to seconds
  const dtSeconds = dt / 1000;
  this.accumulator += dtSeconds;

  // Step physics at fixed rate (60 Hz)
  while (this.accumulator >= this.PHYSICS_DT) {
    // Call fixed update callbacks BEFORE physics step
    for (const callback of this.fixedUpdateCallbacks) {
      callback(this.FIXED_DT_MS); // Pass dt in milliseconds
    }

    // Step Box2D physics
    this.world.Step(
      this.PHYSICS_DT,
      this.VELOCITY_ITERATIONS,
      this.POSITION_ITERATIONS
    );

    this.accumulator -= this.PHYSICS_DT;
  }
}
```

### 3.4 Debug rendering

**Option A: Use @box2d/debug-draw (recommended)**

```typescript
import { Draw } from '@box2d/debug-draw';

class CameraDebugDraw extends Draw {
  constructor(
    private camera: Camera,
    private ctx: CanvasRenderingContext2D
  ) {
    super();
  }

  // Override drawing methods to apply camera transform
  DrawSegment(p1: b2Vec2, p2: b2Vec2, color: b2Color): void {
    const screen1 = this.camera.worldToScreen(p1.x, p1.y, ...);
    const screen2 = this.camera.worldToScreen(p2.x, p2.y, ...);

    this.ctx.strokeStyle = this.colorToStyle(color);
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(screen1.x, screen1.y);
    this.ctx.lineTo(screen2.x, screen2.y);
    this.ctx.stroke();
  }

  DrawPolygon(vertices: b2Vec2[], vertexCount: number, color: b2Color): void {
    if (vertexCount < 2) return;

    this.ctx.strokeStyle = this.colorToStyle(color);
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    const first = this.camera.worldToScreen(vertices[0].x, vertices[0].y, ...);
    this.ctx.moveTo(first.x, first.y);

    for (let i = 1; i < vertexCount; i++) {
      const screen = this.camera.worldToScreen(vertices[i].x, vertices[i].y, ...);
      this.ctx.lineTo(screen.x, screen.y);
    }

    this.ctx.closePath();
    this.ctx.stroke();
  }

  DrawCircle(center: b2Vec2, radius: number, color: b2Color): void {
    const screenPos = this.camera.worldToScreen(center.x, center.y, ...);
    const screenRadius = radius * this.camera.zoom;

    this.ctx.strokeStyle = this.colorToStyle(color);
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private colorToStyle(color: b2Color): string {
    return `rgb(${color.r * 255}, ${color.g * 255}, ${color.b * 255})`;
  }
}

// In Box2DEngine class:
debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, ...): void {
  if (!this.debugDraw) {
    this.debugDraw = new CameraDebugDraw(camera, ctx);
    this.debugDraw.SetFlags(Draw.e_shapeBit);
    this.world.SetDebugDraw(this.debugDraw);
  }

  this.world.DebugDraw();
}
```

### 3.5 Box2DPhysics wrapper (compatibility layer)

**File:** `src/Box2DPhysics.ts`

Create a thin wrapper similar to old `RapierPhysics.ts`:

```typescript
export class Box2DPhysics {
  private engine: Box2DEngine;

  constructor() {
    this.engine = new Box2DEngine();
  }

  async init(): Promise<void> {
    await this.engine.init();
  }

  update(deltaMs: number): void {
    this.engine.step(deltaMs);
  }

  setCaveContours(contours: Point[][]): void {
    this.engine.setTerrainLoops(contours);
  }

  setDebugEnabled(enabled: boolean): void {
    this.engine.setDebugEnabled(enabled);
  }

  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, ...): void {
    this.engine.debugDraw(ctx, camera, ...);
  }

  getEngine(): Box2DEngine {
    return this.engine;
  }
}
```

---

## Phase 4: Spider Controller Integration (1 day)

### 4.1 Copy spider files from experiment

**Source:** `spider-box2d-experiment/src/`

**Destination:** `src/controllers/spider/`

**Files to copy:**
- `SpiderController.ts` → `src/controllers/spider/SpiderController.ts`
- `SpiderBuilder.ts` → `src/controllers/spider/SpiderBuilder.ts`
- `SpiderTypes.ts` → `src/controllers/spider/SpiderTypes.ts`
- `SpiderMath.ts` → `src/controllers/spider/SpiderMath.ts` (already exists, verify consistency)

**Files to adapt (don't copy directly):**
- `SpiderRenderer.ts` → Integrate into existing `src/Renderer.ts`
- `LogWindow.ts` → Use existing `src/DebugConsole.ts`

### 4.2 Update spider controller for main project

**Key changes needed:**

1. **Remove standalone renderer:** Spider renderer code should integrate into main `Renderer.ts`

2. **Update constructor:** Accept Box2D world from physics engine
   ```typescript
   // In main.ts or similar:
   const world = physics.getEngine().getWorld();
   const spider = new SpiderController(world, spawnX, spawnY);
   ```

3. **Hook into fixed update:**
   ```typescript
   // Register spider's FixedUpdate with physics engine
   physics.getEngine().registerFixedUpdate((dt) => {
     spider.FixedUpdate(dt);
   });
   ```

4. **Input handling:** Integrate with existing `InputHandler.ts` and `VirtualJoystick.ts`
   ```typescript
   // In input handler:
   if (spider) {
     spider.SetMoveInput(joystick.direction.x, joystick.direction.y);
   }
   ```

### 4.3 Update main.ts

**Replace Rapier-specific code:**

```typescript
// OLD (Rapier):
import { RapierPhysics } from './RapierPhysics';
import RAPIER from '@dimforge/rapier2d-compat';

// NEW (Box2D):
import { Box2DPhysics } from './Box2DPhysics';
import { SpiderController } from './controllers/spider/SpiderController';
```

**Initialize physics:**

```typescript
// OLD:
const physics = new RapierPhysics();
await physics.init(); // Async WASM loading

// NEW:
const physics = new Box2DPhysics();
await physics.init(); // No async needed for Box2D, but keep for compatibility
```

**Create spider:**

```typescript
// Get Box2D world from engine
const world = physics.getEngine().getWorld();

// Spawn spider at camera center
const spawnX = camera.x;
const spawnY = camera.y;
const spider = new SpiderController(world, spawnX, spawnY);

// Register spider's FixedUpdate with physics engine
physics.getEngine().registerFixedUpdate((dt) => {
  spider.FixedUpdate(dt / 1000); // Convert ms to seconds if needed
});
```

**Remove old player/ball code:**

```typescript
// DELETE (or comment out):
// - createPlayer() calls
// - createBall() calls
// - ball spawning timers
// - player respawn logic
// - All references to old controllers
```

### 4.4 Update Renderer.ts

**Add spider rendering:**

```typescript
// Import spider types
import type { SpiderController } from './controllers/spider/SpiderController';
import type { SpiderConfig } from './controllers/spider/SpiderTypes';

// In Renderer class:
renderSpider(spider: SpiderController, config: SpiderConfig): void {
  const ctx = this.ctx;
  const camera = this.camera;

  // Get spider segments from controller
  const segments = spider.getSegments();

  // Render spider segments with camera transform
  for (const segment of segments) {
    const pos = segment.body.GetPosition();
    const angle = segment.body.GetAngle();
    const screenPos = camera.worldToScreen(pos.x, pos.y, ...);

    // Draw segment as circle
    const screenRadius = segment.radius * camera.zoom;

    ctx.fillStyle = segment.isLeft ? '#4a9eff' : '#ff6b4a'; // Blue/red for left/right
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Render joints (revolute joints between segments)
  const joints = spider.getJoints();
  for (const joint of joints) {
    const anchorA = joint.GetAnchorA();
    const anchorB = joint.GetAnchorB();

    const screenA = camera.worldToScreen(anchorA.x, anchorA.y, ...);
    const screenB = camera.worldToScreen(anchorB.x, anchorB.y, ...);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screenA.x, screenA.y);
    ctx.lineTo(screenB.x, screenB.y);
    ctx.stroke();
  }
}
```

**Call from main render loop:**

```typescript
// In main.ts render loop:
renderer.clear();
renderer.renderCave(optimizedLoops);
if (spider) {
  renderer.renderSpider(spider, spiderConfig);
}
renderer.renderUI();
```

### 4.5 Update SpiderDebugUI

Ensure `SpiderDebugUI` works with the integrated spider controller:

```typescript
// In main.ts:
const spiderDebugUI = new SpiderDebugUI(spider, spiderConfig);

// In render loop:
spiderDebugUI.update(spider);
```

---

## Phase 5: Cleanup & Integration (1 day)

### 5.1 Update imports throughout codebase

**Search and replace:**
- `RapierPhysics` → `Box2DPhysics`
- `RAPIER.` → Remove (no longer needed)
- `@dimforge/rapier2d-compat` → Remove imports

**Files likely to need updates:**
- `src/main.ts`
- `src/DebugConsole.ts`
- `src/Renderer.ts`
- `src/CharacterControllerUI.ts` (may need to remove if capsule-specific)

### 5.2 Update UI components

**Remove old controller UI:**
- `CharacterControllerUI.ts` - Delete or move to legacy/ (capsule player specific)
- Update `DebugConsole.ts` to remove references to old controllers

**Keep:**
- `SpiderDebugUI.ts` - Main spider controls
- `CaveGeneratorUI.ts` - Cave generation params
- `VirtualJoystick.ts` - Input for spider

### 5.3 Update ControllerFactory (if exists)

Update `src/controllers/ControllerFactory.ts`:

```typescript
// Remove old controller types
export enum ControllerType {
  SPIDER = 'spider',
  // Remove: FORCE, CAPSULE, etc.
}

export class ControllerManager {
  createController(type: ControllerType, world: b2World, x: number, y: number) {
    switch (type) {
      case ControllerType.SPIDER:
        return new SpiderController(world, x, y);
      default:
        throw new Error(`Unknown controller type: ${type}`);
    }
  }
}
```

### 5.4 Update CLAUDE.md documentation

**Update physics section:**
```markdown
## Physics Simulation

### Box2D Integration
- World gravity: (0, 10) m/s² (Y-down)
- Fixed timestep: 60 Hz (16.67ms)
- **Terrain**: b2ChainShape for cave boundaries (exact match to marching squares)
- **Spider**: Multi-segment creature with revolute joints (8 legs, 3 segments each)
- Velocity iterations: 8
- Position iterations: 3

### Collision Detection
- **Terrain**: b2ChainShape colliders (one per loop)
  - Closed loops for cave boundaries
  - No ghost collisions at edge junctions
  - Efficient for long chains (2,000-5,000 segments)
- **Spider**: Circle colliders per segment
- Friction: 0.3 (terrain), configurable (spider)
- Restitution: 0.1 (terrain), configurable (spider)
```

**Update architecture section:**
```markdown
#### `src/physics/Box2DEngine.ts`
- **Box2DEngine**: Core physics engine wrapper
- Fixed timestep (60 Hz) with accumulator
- b2ChainShape colliders for cave boundaries
- Debug rendering overlay
- Fixed update callback system for controllers

#### `src/Box2DPhysics.ts`
- High-level physics API wrapper
- Creates terrain from marching squares loops
- Manages physics world lifecycle

#### `src/controllers/spider/SpiderController.ts`
- Multi-segment spider creature controller
- 8 legs, 3 segments each (Thorax → Femur → Tibia)
- Revolute joints with soft limits (PD controller)
- Ground detection via raycasts
- Input: 2D movement vector (joystick/WASD)
```

**Remove legacy sections:**
- Remove Rapier references
- Remove capsule player documentation
- Remove ball spawning documentation

### 5.5 Remove/comment out old code in main.ts

**Delete or comment out:**
```typescript
// === LEGACY CODE (moved to src/legacy/) ===
// const playerController = physics.createPlayer(...);
// const ballSpawnTimer = setInterval(() => { ... }, 5000);
// All capsule player rendering
// All ball rendering
// === END LEGACY CODE ===
```

### 5.6 Update PWA manifest and icons (if needed)

Update `index.html` and `vite.config.ts` if app name/description changed:
```typescript
// vite.config.ts
pwa({
  manifest: {
    name: 'Cave Spider - Procedural 2D Physics',
    short_name: 'CaveSpider',
    description: 'Procedural cave generation with spider creature physics',
    // ... rest of manifest
  }
})
```

---

## Phase 6: Testing (1 day)

### 6.1 Unit tests (manual verification)

**Cave collision:**
- [ ] Generate simple cave (few loops)
- [ ] Generate complex cave (procedural)
- [ ] Verify no ghost collisions at segment junctions
- [ ] Verify closed loops (no gaps)
- [ ] Check debug visualization (green lines)

**Spider controller:**
- [ ] Spider spawns correctly
- [ ] All 8 legs render with 3 segments each
- [ ] Joints visible and functional
- [ ] Input controls work (WASD/joystick)
- [ ] Spider moves smoothly on terrain
- [ ] Legs make ground contact
- [ ] No joint explosions or instability

### 6.2 Integration tests

**Physics + Cave:**
- [ ] Spider interacts correctly with cave walls
- [ ] No tunneling through thin walls
- [ ] Smooth collision response
- [ ] Performance: 60 FPS on desktop
- [ ] Performance: 60 FPS on iPhone 13 Pro

**Input:**
- [ ] Virtual joystick controls spider
- [ ] WASD keyboard controls spider
- [ ] Camera follows spider (if implemented)
- [ ] Touch pan/zoom works

**UI:**
- [ ] SpiderDebugUI shows correct values
- [ ] Cave parameter UI works
- [ ] Debug console works
- [ ] Visual debug toggles work

### 6.3 Performance benchmarks

**Target performance (50×30m world):**
- FPS: 60 (capped)
- Frame time: ~10ms
  - Physics: ~2-3ms
  - Rendering: ~7-8ms
- Memory: ~50-80MB

**If performance issues:**
1. Profile with browser DevTools
2. Check chain shape vertex counts
3. Consider splitting large chains into chunks
4. Adjust velocity/position iterations (reduce from 8/3)

### 6.4 Cross-device testing

**Desktop:**
- [ ] Chrome
- [ ] Firefox
- [ ] Safari

**Mobile (iOS - primary target):**
- [ ] iPhone 13 Pro (or similar)
- [ ] iPad
- [ ] Add to Home Screen → fullscreen mode
- [ ] Touch controls responsive

---

## Phase 7: Deployment

### 7.1 Git workflow

**Branch strategy:**
```bash
# Current branch (from context):
git checkout claude/plan-box2d-migration-01FJr5JpVyL9YQ5d9YLpgQvL

# Create implementation branch:
git checkout -b claude/box2d-implementation-[session-id]

# After implementation:
git add .
git commit -m "feat: migrate to Box2D with spider controller

- Replace Rapier with @box2d/core
- Implement b2ChainShape for cave terrain
- Integrate spider controller from experiment
- Archive legacy code (capsule player, balls) to src/legacy/
- Update all documentation"

# Push to remote:
git push -u origin claude/box2d-implementation-[session-id]
```

### 7.2 Autopromote to main

The autopromote workflow will automatically merge `claude/**` branches to `main`, triggering the deploy workflow.

### 7.3 Verify deployment

1. Check GitHub Actions logs
2. Visit: `https://tiago-amorim-rocha.github.io/cave/`
3. Test on iOS device (primary target)
4. Verify update notification (version.json polling)

---

## Success Criteria

### Must-have (blocking deployment):
- ✅ Cave terrain generates correctly with b2ChainShape
- ✅ Spider spawns and moves with input
- ✅ No physics explosions or instability
- ✅ 60 FPS on desktop
- ✅ Debug visualization works
- ✅ No console errors

### Nice-to-have (post-launch):
- ⭕ 60 FPS on iPhone (may need optimization)
- ⭕ Camera follows spider
- ⭕ Spider animation/visuals polish
- ⭕ Sound effects
- ⭕ Terrain interaction (carving)

---

## Rollback Plan

If migration fails or has critical issues:

1. **Revert to Rapier:**
   ```bash
   git checkout main
   git log  # Find last working Rapier commit
   git checkout [commit-hash]
   ```

2. **Keep legacy/ folder:** All Rapier code is preserved in `src/legacy/`

3. **Gradual migration:** Deploy cave terrain first, add spider later

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| b2ChainShape performance issues | High | Profile early, split chains if needed |
| Spider physics instability | High | Copy exact settings from working experiment |
| Different physics feel | Medium | Tune iteration counts, damping |
| iOS performance regression | High | Test early on target device |
| Breaking existing features | Low | Minimal - only cave/spider in scope |

---

## File Checklist

### New files to create:
- [ ] `src/physics/Box2DEngine.ts`
- [ ] `src/Box2DPhysics.ts`
- [ ] `BOX2D_MIGRATION_PLAN.md` (this file)

### Files to move to legacy/:
- [ ] `src/physics/engine.ts` → `src/legacy/physics/rapier-engine.ts`
- [ ] `src/RapierPhysics.ts` → `src/legacy/physics/RapierPhysics.ts`
- [ ] `src/controllers/ForcePlayerController.ts` → `src/legacy/controllers/`

### Files to copy from experiment:
- [ ] `spider-box2d-experiment/src/SpiderController.ts` → `src/controllers/spider/`
- [ ] `spider-box2d-experiment/src/SpiderBuilder.ts` → `src/controllers/spider/`
- [ ] `spider-box2d-experiment/src/SpiderTypes.ts` → `src/controllers/spider/`

### Files to update:
- [ ] `src/main.ts` (replace Rapier with Box2D, add spider)
- [ ] `src/Renderer.ts` (add spider rendering)
- [ ] `package.json` (dependencies)
- [ ] `CLAUDE.md` (documentation)
- [ ] `tsconfig.json` (if needed for @box2d imports)

### Files to delete:
- [ ] `src/CharacterControllerUI.ts` (capsule-specific, not needed)
- [ ] Remove all capsule player references in main.ts

---

## Implementation Order (Recommended)

**Day 1:** Cave collision migration
1. ✅ Update package.json dependencies
2. ✅ Create `src/physics/Box2DEngine.ts`
3. ✅ Implement `setTerrainLoops()` with b2ChainShape
4. ✅ Implement physics stepping
5. ✅ Test with simple cave
6. ✅ Test with procedural cave

**Day 2:** Spider integration
7. ✅ Copy spider files from experiment
8. ✅ Update spider constructor/initialization
9. ✅ Hook spider to fixed update
10. ✅ Add spider rendering to Renderer.ts
11. ✅ Test spider spawning and basic movement

**Day 3:** Cleanup & testing
12. ✅ Move legacy files to src/legacy/
13. ✅ Update all imports (Rapier → Box2D)
14. ✅ Update documentation (CLAUDE.md)
15. ✅ Integration testing (cave + spider)
16. ✅ Performance profiling

**Day 4:** Polish & deploy
17. ✅ Debug visualization polish
18. ✅ UI cleanup (remove old controllers)
19. ✅ Cross-device testing (iOS)
20. ✅ Deploy to GitHub Pages

---

## Notes

- **No WASM overhead:** Box2D is native TypeScript (instant initialization)
- **Proven approach:** Spider experiment validates Box2D works well
- **b2ChainShape is key:** Prevents ghost collisions (similar to Rapier polylines)
- **Focused scope:** Only cave + spider (NOT balls, capsule player, etc.)
- **Legacy preserved:** All old code moved to `src/legacy/` for reference

---

## Questions for Next Chat

Before starting implementation, clarify:

1. **Camera behavior:** Should camera follow spider, or stay user-controlled?
2. **Spawn location:** Where should spider spawn? (center of cave, specific location?)
3. **Input method:** Virtual joystick only, or WASD + joystick?
4. **Visual style:** Keep spider simple (circles), or add more detail?
5. **Debug UI:** Keep all debug controls, or simplify?

---

## References

- **Box2D TypeScript docs:** https://github.com/Birch-san/box2d-wasm
- **Spider experiment:** `spider-box2d-experiment/README.md`
- **Current cave physics:** `PHYSICS_ARCHITECTURE.md` (Rapier)
- **Marching squares:** `src/MarchingSquares.ts`
- **Cave generation:** `src/DensityField.ts` + `src/PerlinNoise.ts`

---

**Ready for implementation! 🚀**
