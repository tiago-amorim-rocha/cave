# SpiderController Architecture

The runtime spider is a pure physics controller implemented in `Assets/SpiderController.cs`.  
It drives a pair of 3-segment legs (hip → knee → ankle → fixed foot) entirely from torques so it can be ported to other engines or languages.

This document breaks down the data model, control flow, and math involved so you can re‑implement the behaviour—for example in a TypeScript project—without digging through Unity specifics.

## 1. High-level responsibilities

| Responsibility | Entry points |
| --- | --- |
| Editor-time rig authoring (length/mass layout + hinge anchors) | `ApplyLegLayout()` |
| Runtime input sampling (vertical/horizontal axes) | `FixedUpdate()` |
| Distributing desired body forces between legs | `ComputeLegForces()` |
| Converting foot forces to hip/knee/ankle torques | `ApplyLegTorques()` |
| Soft joint limits that approximate hinge constraints | `ComputeJointLimitTorque()` + limit helpers |
| Optional dev-only visualization/logging | `SpiderControllerDebug` MonoBehaviour |

## 2. Data model

### `LegSegments`
Serializable struct that wires four `Transform`s (segment1..3 + foot).  
Editor-only fields `angle1Deg/angle2Deg/angle3Deg` define a preferred pose for layout previews.

### Geometry & mass parameters
`segmentLength1/2/3` and `baseSegmentLength/segmentLengthRatio` are the canonical lengths used both for layout and Jacobian math. Mass parameters (`baseSegmentMass/segmentMassRatio`) are also only touched inside the layout helper, so the runtime solver only needs the lengths.

### Control gains
- `verticalAccelGain`, `horizontalAccelGain`: convert input axis value → desired acceleration (scaled by body mass to get Newtons).
- `stabilizeRotation`, `rotationStiffness`, `rotationDamping`, `targetBodyAngle`: PD controller that biases vertical force difference between the two legs to counter body rotation.
- `torqueGain`, `maxJointTorque`: scalar post-processing on the torques produced by the Jacobian transpose.
- `jointLimitKp`, `jointLimitKd` plus the per-joint free ranges form pseudo springs/dampers that only activate outside the allowed motion window.

### `ControllerLeg`
Lightweight runtime struct holding three `Rigidbody2D` references (`Hip`, `Knee`, `Ankle`), optional `Foot`, and a `bool IsLeft`. `TryGetControllerLegs()` enforces two fully-wired legs before the solver runs.

## 3. Runtime flow (FixedUpdate)

1. **Input sampling**  
   `FixedUpdate()` clamps the Unity input axes to [-1, 1].

2. **Desired body force**  
   `ComputeLegForces()` multiplies the axes by the gains and body mass to get a target body force `(Fx, Fy)`.  
   - Force is split evenly between both legs by default.  
   - If `stabilizeRotation` is enabled, a PD controller computes an angular torque demand. That torque is converted into a vertical force delta (`deltaFy = torque / lever`) applied with opposite signs to the two legs, where `lever` is the horizontal hip separation. The function early-outs if lever is ~0 to avoid division by zero.

3. **Inverse dynamics (Jacobian transpose)**  
   `ApplyLegTorques()` converts the desired end-effector force on each foot into joint torques using the Jacobian transpose of a planar 3-link chain.  
   - Joint angles are defined as (hip absolute, knee relative, ankle relative).  
   - `segmentLength1/2/3` feed directly into the Jacobian terms `j11..j23`.  
   - Resulting torques (`tauA/B/C`) are clamped after multiplying by `torqueGain`.

4. **Soft joint limits**  
   After the pure Jacobian torques are computed, each joint may get additional torque from `ComputeJointLimitTorque()`. That helper computes the error between the current relative angle and the nearest point inside the configured free range, then applies a PD response.  
   - Hip free ranges are mirrored by `ApplyMirrorIfNeeded()` so the inspector can use the same signed values for both legs.  
   - The computed limit torques are fed into the joint totals and forwarded to the debugger for logging.

5. **Torque application**  
   Final torques are applied with `Rigidbody2D.AddTorque(..., ForceMode2D.Force)` so Unity integrates them in the next step.

## 4. Editor-only layout (`ApplyLegLayout`)

This method lets you position and weight all leg segments directly from the inspector:

1. Derives three lengths (`L1`, `L2`, `L3`) using `baseSegmentLength` and `segmentLengthRatio`.
2. Mirrors mass calculation with `baseSegmentMass` / `segmentMassRatio`.
3. Applies scale changes to each segment transform’s local `x` scale (assuming pivots at proximal joints).
4. (Optional) Recomputes positions & rotations in world space using `AngleToDir` helpers and the serialized desired angles.
5. Re-aligns `HingeJoint2D` anchors so they coincide with the computed joint positions on both connected bodies.

This is completely editor-gated (`#if UNITY_EDITOR`), so it can be skipped when porting to TypeScript unless you need tooling for authoring rigs.

## 5. Debug companion (SpiderControllerDebug.cs)

`SpiderController` has no runtime log/UI responsibilities: instead it exposes `RegisterDebugger()` plus limit range helpers so `SpiderControllerDebug` can visualize the system without polluting the solver.

Key features of the debugger component:
- Togglable HUD displaying body position/velocity and reminder text about control axes.
- Periodic logging of joint limit state (`logInterval` seconds between messages).
- Gizmo rendering of limit arcs vs actual joint angles for hips/knees/ankles.

When porting, you can replicate this behaviour in whatever visualization framework is available (eg. requestAnimationFrame canvas, dev overlays, etc.) without changing the physics core.

## 6. Porting checklist for a TypeScript rewrite

1. **Physics integration** — Replace `Rigidbody2D` calls with your physics engine APIs. Keep track of each segment’s absolute rotation (hip) and relative rotations (knee/ankle) for the Jacobian math.
2. **Input layer** — Map your platform’s input to normalized `[-1, 1]` values before feeding `ComputeLegForces`.
3. **Jacobians** — The solver uses world-space angles, so ensure your math library handles radians (Unity stores degrees; port uses `Math.sin/cos`).  
4. **Joint limits** — Implement `ComputeJointLimitTorque` verbatim to preserve the spring-like feel; it only needs `DeltaAngle` and angular velocities.  
5. **Mirroring** — Keep `ApplyMirrorIfNeeded` logic so inspector-friendly ranges remain mirrored automatically.  
6. **Debugging** — Optional, but having a separate debug surface keeps your controller logic clean, as seen with `SpiderControllerDebug`.

By following the responsibilities above you can re-create the exact same run behaviour outside Unity, while deciding independently how much of the editor tooling and debug UX you need.
