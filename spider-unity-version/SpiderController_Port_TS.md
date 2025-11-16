# Porting SpiderController To TypeScript (Canvas2D + Rapier2D)

This note outlines a practical path for recreating the current Unity-based spider controller and its debugging surface in a TypeScript project that uses [Rapier 2D](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) for physics and the HTML Canvas2D API for rendering. The target runtime is an iOS PWA, so assume touch input (via an existing virtual joystick) and no scene editor—every rigid body, joint, and debug hook must be created procedurally.

## 1. Project structure

```
src/
  physics/
    SpiderController.ts
    SpiderControllerDebug.ts
    LegSegments.ts
  rendering/
    SpiderCanvasRenderer.ts
  input/
    InputMapper.ts
  main.ts
```

- Keep the solver and joint-limit logic in `physics/SpiderController.ts`, mirroring the Unity class semantics.
- Isolate drawing/UI concerns in `SpiderControllerDebug.ts` so the runtime logic stays headless (similar to `SpiderControllerDebug.cs`).
- `SpiderCanvasRenderer.ts` should be a thin wrapper that draws gizmos, limit arcs, and HUD text on a `<canvas>` element.

## 2. Mapping Unity concepts to Rapier

| Unity concept | Rapier equivalent / note |
| --- | --- |
| `Rigidbody2D` (dynamic) | `RigidBody` created via `RigidBodyDesc.dynamic()` |
| Joint chain (hip → knee → ankle) | Use Rapier revolute joints (`JointData.revolute()`) between consecutive rigid bodies |
| `AddTorque(forceMode=Force)` | `rigidBody.addTorque(tau, true)` (true = wake) |
| `worldCenterOfMass`, `rotation`, `angularVelocity` | Use `rigidBody.translation()`, `rotation()` (quaternion or angle), `angularVelocity()` |
| Fixed feet | Either kinematic bodies or joints constrained to ground anchors |
| FixedUpdate delta time | Use `world.timestep` (or track actual dt) and ensure consistent integration |

Implementation tips:
1. Store joint transforms as simple data objects containing Rapier body handles plus cached lengths.  
2. Provide helper functions `getHipRotation`, `getKneeRotation`, etc., that return degrees (for readability) but convert to radians before trig operations.
3. Rapier’s angles are radians; keep the Unity math identical by calling `Math.sin/cos` with radians and convert back to degrees only when logging or drawing.

## 3. Input plumbing (PWA + virtual joystick)

- Feed the joystick’s normalized `x`/`y` output (already in [-1, 1]) directly into `SpiderController.computeLegForces`.  
- When the joystick is inactive, decay toward zero smoothly (e.g., exponential decay) to emulate Unity’s axis smoothing.  
- Because PWAs on iOS may pause Canvas updates while hidden, buffer the last joystick sample and reapply it after `document.visibilitychange`.
- Keep a tiny calibration utility that maps joystick radius to actual acceleration needs; expose it through a hidden debug panel reachable via a gesture (e.g., three-finger tap) since there is no keyboard.

```ts
interface VirtualJoystick {
  axisX: number; // -1..1
  axisY: number; // -1..1 (positive = up)
  isActive: boolean;
}

function sampleInput(joystick: VirtualJoystick) {
  const smooth = (value: number, prev: number, dt: number) =>
    joystick.isActive ? value : prev * Math.exp(-8 * dt);
  return {
    vertical: smooth(joystick.axisY, /*prev*/ 0, app.deltaTime),
    horizontal: smooth(joystick.axisX, /*prev*/ 0, app.deltaTime),
  };
}
```

## 4. Programmatic spider assembly (no editor scene)

Because there is no Unity scene/IDE, treat `Assets/spider.prefab` as the canonical source of geometry. Suggested steps for the TypeScript/Rapier factory (the “SpiderBuilder”):

1. **Extract prefab metadata**  
   - Capture each segment’s length/width from the prefab (hip segments ≈ `1.3 x 0.1`, knee ≈ `1.0 x 0.1`, ankle ≈ `0.7 x 0.1`, feet ≈ `0.2 x 0.2`, central body sprite ≈ `1 x 1`).  
   - Serialize this into a JSON blob alongside sprite IDs so Claude can reuse it when generating code.

2. **Create rigid bodies**  
   - For each segment, spawn a Rapier `RigidBodyDesc.dynamic()` with zero gravity scale (matching Unity’s `GravityScale = 0`) and linear/angular damping from the prefab.  
   - Since the Unity objects have no colliders, add them here via `ColliderDesc.cuboid(length / 2, thickness / 2)` using the scale data above. Keep mass ratios consistent with `baseSegmentMass/segmentMassRatio`.

3. **Assemble joints**  
   - Use `JointData.revolute(anchorA, anchorB)` to link body→hip, hip→knee, knee→ankle, and ankle→foot.  
   - Anchors should mirror the prefabs: e.g., hip anchor at local `(0.5, 0)` on segment1 and `(0,0)` on segment2.  
   - Lock the foot to either a static ground body or a kinematic placeholder that you can move for debugging.

4. **Factory options & debug toggles**  
   Provide options when instantiating:
   ```ts
   interface SpiderBuilderOptions {
     enableDebug?: boolean;
     drawColliders?: boolean;
     logJointForces?: boolean;
     spawnPose?: "crouch" | "extend";
   }
   ```
   - `enableDebug` registers the Canvas2D overlay and console logging automatically.
   - `drawColliders` asks the renderer to outline the Rapier collider shapes so you can confirm proportions.
   - `spawnPose` offsets initial joint rotations so you can verify posture before the controller runs.

5. **Prefab-driven sprites**  
   Even though Rapier won’t render sprites, keep a `SpiderVisualDefinition` that describes sprite order, sorting layers, and colors. This lets the Canvas renderer mimic the Unity look while still being pure code-driven.

6. **Data delivery to Claude**  
   - Package `spider.prefab` plus a simplified JSON describing each limb (lengths, masses, sprite info, hinge offsets).  
   - Claude can translate that JSON into constant tables for the TypeScript builder (`const SPIDER_SEGMENTS: SpiderSegmentDefinition[] = [...]`).

## 5. Core controller port

1. **Leg wiring**
   - Create a `LegSegments` interface containing Rapier body handles (`hip`, `knee`, `ankle`, optional `foot`).
   - Mirror the `ControllerLeg` struct so `SpiderController` can cache handles and identify left/right legs.

2. **Force distribution**
   - Port `ComputeLegForces` directly. Use `body.mass()` and `body.angvel()` from Rapier.
   - Replace `Mathf` with `Math` and reimplement helpers `deltaAngle`, `clamp`, etc.

3. **Jacobian transpose**
   - Copy the trigonometry verbatim; the only change is using `Math.sin`/`Math.cos`.
   - Apply torques via `rigidBody.addTorque(tau)` for each joint segment.

4. **Joint limits**
   - Reuse `ComputeJointLimitTorque` and `ApplyMirrorIfNeeded`.
   - Because Rapier joints already support hard limits, decide whether to:
     * disable limits on the Rapier joints and approximate them using our PD torques (faithful port), or
     * configure Rapier joint limits for safety while still running the soft limits for “muscle” behaviour.

5. **Initialization**
   - Expose a `SpiderController.initialize(world: World, legs: LegSegments[])` that caches handles and asserts there are exactly two legs. Return early if any body is missing.

## 6. Debugging via Canvas2D

Use a separate render loop (or piggyback on your main render pass) to draw:

1. **HUD text**  
   Render body position/velocity and instructions using `ctx.fillText`.

2. **Limit arcs**  
   - Convert the arc logic from `SpiderControllerDebug` (`DrawHipAngles`, etc.) into Canvas2D commands.  
   - Example: draw limit bounds with `ctx.beginPath(); ctx.arc(...)` to mimic the colored wedges.

3. **Joint state logging**  
   - Replicate the logInterval timer and log to `console.log`.  
   - Optionally expose the snapshots through an overlay (HTML div) instead of the console.

4. **Force visualization**  
   - Draw vectors from the foot to show requested body forces (use `_debug.UpdateLegForces` idea if you bring it back).

Keep the debug class optional so production builds can omit it. A simple registration pattern similar to `controller.registerDebugger(debugger)` keeps both sides decoupled. For the PWA:
- Gate debug UI behind a gesture or query string (e.g., `?debug=1`) so testers can enable it without a keyboard.
- Offer live toggles for “show colliders”, “show joint limits”, “pause controller” to help when constructing the spider from scratch.

## 7. Rendering pipeline

1. Maintain a `SpiderCanvasRenderer` that receives world-space points (Vec2) in Rapier units. Convert to canvas pixels using a scale and offset (e.g., meters → pixels).
2. Clear the canvas each frame, draw the body/legs via simple lines or sprites, then call into the debug renderer for overlays.
3. Use `requestAnimationFrame` for drawing and `setInterval`/`Rapier`’s timestep for physics steps, or adopt a fixed-step accumulator (recommended) so the solver runs at 60 Hz and rendering interpolates.

## 8. Incremental migration strategy

1. **Core math tests**  
   Port helper functions first and unit-test them (Jacobians, angle normalization, limit torques).
2. **Physics scaffolding**  
   Build Rapier bodies with placeholder controllers to ensure the leg rig is wired correctly.
3. **Import solver**  
   Wire `SpiderController` to your leg rig and run without debug drawing to validate stability.
4. **Add debug overlay**  
   Port `SpiderControllerDebug` features, starting with logging, then HUD, then gizmos.
5. **Quality pass**  
   Tune gains to account for differences between Unity’s solver and Rapier’s integration.

By mirroring the Unity responsibilities and keeping the controller/debug separation intact, the TypeScript + Rapier + Canvas2D stack can achieve identical behaviour while staying maintainable and portable.
