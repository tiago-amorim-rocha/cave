# Rapier 2D for JavaScript/TypeScript – Detailed Guide

## Overview

This document summarizes how to use the **2D** version of the [Rapier physics engine](https://rapier.rs) in JavaScript/TypeScript applications.  It focuses exclusively on the 2D API and is designed for consumption by AI coding agents such as **Claude code**.  The 2D engine shares design ideas with its 3D counterpart but exposes functions that operate on 2‑component vectors and single rotation angles.  This guide covers installation, initialization, world creation and simulation control, rigid bodies, colliders, sensors, joints, scene queries, events, and advanced features.

> **Note on compatibility packages:** if your project does **not** use a bundler (e.g. plain HTML/JS), install the `@dimforge/rapier2d-compat` package instead of `@dimforge/rapier2d`.  The compat package inlines the WebAssembly binary and requires an explicit call to `RAPIER.init()` before creating the world【701892303011058†L145-L166】.

---

## Installing and initializing Rapier 2D

### With a bundler (e.g. Vite, Webpack)

```bash
npm install @dimforge/rapier2d
```

Import and create the world:

```ts
// Asynchronously load the WASM module
import RAPIER from '@dimforge/rapier2d';

// Create a new world with gravity pointing down
const gravity: RAPIER.Vector = { x: 0.0, y: -9.81 };
const world = new RAPIER.World(gravity);

// Run simulation loop
function step() {
  world.step();
  requestAnimationFrame(step);
}
step();
```

### Without a bundler

Use the compat package and call `RAPIER.init()`:

```ts
import RAPIER from '@dimforge/rapier2d-compat';

// Initialise the inlined WASM before using Rapier
await RAPIER.init();

const world = new RAPIER.World({ x: 0.0, y: -9.81 });
// ... proceed as above
```

The compat bundle embeds the WebAssembly binary in base 64 and must be initialised with `init()`【701892303011058†L145-L166】.

---

## Running the simulation

### Stepping the world

Call `world.step()` once per frame to advance the physics state.  Rapier uses a fixed internal timestep but you can control when steps occur.  For deterministic behavior across machines and browsers, ensure the same simulation parameters and call order are used【868089729552556†L45-L64】.

### Sleeping

Dynamic bodies can enter a “sleeping” state when they come to rest.  Sleeping bodies are not simulated until disturbed by a force or collision, improving performance.  The sleeping behavior can be configured via the rigid‑body descriptor (see below).

### Continuous collision detection

To prevent fast bodies from “tunnelling” through thin objects, enable CCD on the rigid body with `.setCcdEnabled(true)`.  CCD ensures collisions are detected even if an object crosses another between frames【391591145251318†L210-L214】.

---

## Rigid bodies

Rigid bodies represent physical objects that can move, collide and react to forces.  They are created by building a `RigidBodyDesc` and inserting it into the world.  The 2D API supports four body types【640992042801986†L84-L117】:

| Type | Description |
|---|---|
| `Dynamic` | Affected by forces, impulses, gravity and contacts. Use for most moving objects. |
| `Fixed` | Infinite mass; does not move. Use for static scenery like the ground or walls. |
| `KinematicPositionBased` | Controlled by directly setting its position each frame; ignores forces. Useful when you want to teleport or directly control an object. |
| `KinematicVelocityBased` | Controlled by setting a linear velocity; Rapier integrates its position using that velocity. |

### Building a rigid body

Use static constructor methods on `RigidBodyDesc` to choose the type, then chain builder methods to configure its initial state:

```ts
// Dynamic body at (0, 5) with an initial rotation angle of 0.0
const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
  .setTranslation(0.0, 5.0)
  .setRotation(0.0)          // angle in radians for 2D
  .setLinvel(1.0, 0.0)       // initial linear velocity
  .setAngvel(0.5)            // angular velocity in rad/s
  .setGravityScale(1.0)      // multiplies gravity for this body
  .setCanSleep(true)         // allow sleeping
  .setCcdEnabled(false);     // continuous collision detection

const rigidBody = world.createRigidBody(bodyDesc);
```

Other useful builder methods include:

* **`setAdditionalMass(mass: number)`** – override the mass automatically computed from attached colliders.
* **`setLinearDamping(damping: number)`** – apply drag on linear velocity.
* **`setAngularDamping(damping: number)`** – apply drag on angular velocity.

Accessors on the created body:

* `rigidBody.translation()` → `{ x, y }` – current position.
* `rigidBody.rotation()` → `number` – current angle in radians.
* `rigidBody.linvel()` / `rigidBody.setLinvel({x,y}, wake)` – linear velocity.
* `rigidBody.angvel()` / `rigidBody.setAngvel(value, wake)` – angular velocity.
* `rigidBody.applyImpulse({x,y}, wake)` – apply a one‑off linear impulse.
* `rigidBody.applyTorqueImpulse(value, wake)` – apply an angular impulse.

When `wake` is `true`, the body will be woken up if sleeping.

---

## Colliders

Colliders define the shape, mass properties and contact behavior of a body.  A rigid body may have zero or more colliders attached to it.  Colliders are created from a `ColliderDesc` and inserted into the world:

```ts
// Create a dynamic body
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());

// Build a cuboid collider (halfExtents: width 0.5, height 0.2)
const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.2)
  .setTranslation(0.0, 0.0)   // local offset relative to the body
  .setRotation(0.0)           // local rotation (angle in radians)
  .setDensity(1.0)            // affects mass of the body
  .setFriction(0.5)           // coefficient of friction
  .setRestitution(0.0)        // bounciness
  .setSensor(false);          // if true, acts as sensor (no contact forces)

const collider = world.createCollider(colliderDesc, body);
```

Available 2D collider shapes include【294717662827955†L74-L105】:

| Shape builder | Parameters | Notes |
|---|---|---|
| `ColliderDesc.ball(radius)` | radius | Circle collider. |
| `ColliderDesc.cuboid(halfWidth, halfHeight)` | half extents | Axis-aligned rectangle. |
| `ColliderDesc.capsule(halfHeight, radius)` | half height, radius | Capsule aligned along the **y**‑axis. |
| `ColliderDesc.trimesh(vertices, indices)` | arrays | Concave/convex triangle mesh. |
| `ColliderDesc.heightfield(heights, scale)` | 1D array of heights, scale vector | Terrain heightmap. |

### Sensors

Setting `.setSensor(true)` makes a collider detect overlaps without producing contact forces【294717662827955†L159-L165】.  Sensor colliders still contribute to the mass properties of their rigid body, but they only generate **intersection events**.  Use sensors for triggers (e.g. zone detection) or character feet.

### Collision groups and solver groups

Collision and solver groups allow you to include or exclude interactions between colliders.  They are defined as 32‑bit bitmasks.  Configure them on a collider with `.setCollisionGroups(groups)` and `.setSolverGroups(groups)`.  Groups are beyond the scope of this summary but are essential for complex filtering.

### Active events and hooks

Each collider can opt‑in to collision or contact force events by enabling bits on its **active events** field.  To receive collision events, set the `ActiveEvents.COLLISION_EVENTS` bit; to receive contact force events, set `ActiveEvents.CONTACT_FORCE_EVENTS`.  For advanced control of contact and intersection behaviour, enable **active hooks** bits and implement a `PhysicsHooks` callback (see advanced collision detection below).

### Removing colliders

Call `world.removeCollider(collider, wakeParentBody)` to remove a collider.  If `wakeParentBody` is `true`, the attached rigid body will be woken if sleeping.

---

## Forces, impulses and torques

Apply forces and impulses directly to bodies:

```ts
// Apply a continuous force for one frame
rigidBody.addForce({ x: 0.0, y: 10.0 }, wake = true);

// Apply a force at a world-space point
rigidBody.addForceAtPoint({ x: 0.0, y: 10.0 }, { x: 1.0, y: 0.0 }, wake = true);

// Apply a linear impulse (instantaneous change of momentum)
rigidBody.applyImpulse({ x: 5.0, y: 0.0 }, wake = true);

// Apply an angular impulse
rigidBody.applyTorqueImpulse(1.5, wake = true);
```

For position‑based kinematic bodies, set the next translation with `rigidBody.setNextKinematicTranslation({x,y})` each frame; for velocity‑based kinematic bodies, set the desired velocity with `rigidBody.setLinvel({x,y})`.

---

## Joints

Joints constrain the relative motion of two rigid bodies by limiting their degrees of freedom (DOF)【403595249765554†L45-L83】.  Rapier’s 2D API exposes several joint types, all created through the `RAPIER.JointData` builder and inserted into either an **ImpulseJointSet** or **MultibodyJointSet**.  Use `ImpulseJointSet` for most game‑like simulations; use `MultibodyJointSet` when building robot arms or tree‑like assemblies where joints must never be violated【658043620424143†L69-L100】.

### Fixed joint

A fixed joint rigidly attaches two bodies so that their local frames coincide.  Use it only when multi‑collider bodies cannot achieve the desired effect【403595249765554†L95-L108】.

```ts
const params = RAPIER.JointData.fixed(
  { x: 0.0, y: 0.0 }, 0.0,  // anchor on body1 (point and angle)
  { x: 0.0, y: -2.0 }, 0.0 // anchor on body2
);
const joint = world.createImpulseJoint(params, body1, body2, true);
```

### Revolute joint

Also called a spherical joint in 3D, a revolute joint allows rotation around one axis but restricts relative translation【403595249765554†L142-L148】.  In 2D, revolute and spherical joints are equivalent【403595249765554†L123-L139】.

```ts
// anchor points on each body and the axis of rotation (ignored in 2D)
const params = RAPIER.JointData.revolute(
  { x: 0.0, y: 1.0 },  // anchor on body1
  { x: 0.0, y: -3.0 } // anchor on body2
);
const joint = world.createImpulseJoint(params, body1, body2, true);
```

### Prismatic joint

A prismatic joint allows relative translation along one axis while preventing rotation and translation along the perpendicular axis.  You can set limits on the allowed translation range【403595249765554†L160-L183】.

```ts
const axis = { x: 1.0, y: 0.0 };
const params = RAPIER.JointData.prismatic(
  { x: 0.0, y: 0.0 }, // anchor on body1
  axis,
  { x: 0.0, y: -3.0 } // anchor on body2
);
params.limitsEnabled = true;
params.limits = [-2.0, 5.0];
const joint = world.createImpulseJoint(params, body1, body2, true);
```

### Joint motors

Revolute and prismatic joints support motors that drive the bodies toward a target position or velocity.  After creating a joint, call one of the motor configuration methods on the joint instance:

```ts
const prismaticJoint = joint as RAPIER.PrismaticImpulseJoint;

// Drive toward a target velocity
prismaticJoint.configureMotorVelocity( targetVel = 1.0, damping = 0.5 );

// Drive toward a target position
prismaticJoint.configureMotorPosition( targetPos = 2.0, stiffness = 1.0, damping = 0.5 );

// Configure both position and velocity (advanced)
prismaticJoint.configureMotor(targetPos, targetVel, stiffness, damping);
```

Motors are implemented as PD controllers; `stiffness` controls how forcefully the joint tries to reach the target position, and `damping` controls how quickly velocity differences are damped【403595249765554†L192-L217】.

### Reduced vs. constraints-based joints

Rapier provides two ways to represent joints:

* **Multibody joints** (reduced‑coordinates) encode joint DOFs directly in the state; they never violate constraints but can only represent tree‑like assemblies.  Use when accuracy and stability are paramount (e.g. robotics)【658043620424143†L49-L68】【658043620424143†L136-L144】.
* **Impulse joints** (constraints‑based) attach to two bodies and add constraint equations to the solver.  They are flexible, allow graph‑like assemblies, and compute joint forces, but constraints may be violated if the solver doesn’t converge【658043620424143†L69-L100】.

---

## Character controller (2D)

Rapier includes a kinematic character controller that automatically emits ray and shape casts to slide along slopes, climb steps, stop at obstacles and walk over small bumps【537625645192439†L49-L82】.  The controller is independent of the rigid body and collider; you create it from the world and then use it to compute movement corrections:

```ts
const offset = 0.01;                     // small gap between character and obstacles
const controller = world.createCharacterController(offset);

// For each frame:
controller.computeColliderMovement(
  collider,            // the collider to move
  desiredTranslation   // the movement vector we would like without obstacles
);

const corrected = controller.computedMovement();

// Apply the corrected movement depending on the collider’s representation:
collider.setTranslation(
  { x: collider.translation().x + corrected.x,
    y: collider.translation().y + corrected.y },
  wake = true
);

// For kinematic velocity bodies: set velocity = corrected / timeStep
// For kinematic position bodies: set next kinematic translation accordingly
```

Key points:

* The controller does **not** support rotation; it handles translations only【537625645192439†L145-L148】.
* Use simple shapes like cuboids, balls or capsules for performance【537625645192439†L141-L143】.
* The *offset* (gap) should be small enough to be invisible but large enough to avoid sticking【537625645192439†L152-L157】.
* The up vector defaults to the positive **y** axis but can be customised for different gravity directions【537625645192439†L170-L174】.

---

## Scene queries

Scene queries allow you to test the environment without modifying it.  They take all colliders in the world into account and are available on the `World` instance【772664839421024†L49-L56】.

### Ray casting

A ray is defined by an origin and a direction.  Rapier can find the first collider hit by a ray or enumerate all hits.  Example:

```ts
const ray = new RAPIER.Ray({ x: 1.0, y: 2.0 }, { x: 0.0, y: 1.0 });
const maxToi = 4.0;      // maximum distance travelled by the ray
const solid = true;      // treat interiors of shapes as solid

// Find the first hit
const hit = world.castRay(ray, maxToi, solid);
if (hit) {
  const hitPoint = ray.pointAt(hit.toi);
  console.log('Hit collider', hit.colliderHandle, 'at', hitPoint);
}

// Find the first hit and its normal
const hitWithNormal = world.castRayAndGetNormal(ray, maxToi, solid);
if (hitWithNormal) {
  const normal = hitWithNormal.normal;
}

// Enumerate all hits via callback
world.intersectionsWithRay(ray, maxToi, solid, (hit) => {
  const pt = ray.pointAt(hit.toi);
  console.log('Collider', hit.collider, 'hit at', pt);
  return true; // return false to stop enumerating
});
```

Two optional arguments control behaviour【772664839421024†L145-L158】:

* **`maxToi`** – maximum “time of impact”.  The ray’s parametric equation is `origin + direction * t`; hits beyond this t are ignored.
* **`solid`** – if `true`, hitting inside a shape returns `t = 0.0`; if `false`, the interior is empty and the ray starts at the boundary.

You can filter which colliders are considered using query filter flags and groups (see below).

### Shape casting

Shape casting (sweep tests) moves a **shape** along a linear trajectory and reports the first collider it hits【772664839421024†L169-L207】.  Use it for character controllers or bullet sweeps:

```ts
const shapePos = { x: 0.0, y: 1.0 };
const shapeRot = 0.2;            // angle in radians
const shapeVel = { x: 0.1, y: 0.4 };
const shape = new RAPIER.Cuboid(1.0, 2.0);
const targetDistance = 0.0;      // distance you want to shift after a hit
const maxToi = 4.0;
const stopAtPenetration = true;

const hit = world.castShape(
  shapePos, shapeRot, shapeVel, shape,
  targetDistance, maxToi,
  stopAtPenetration
);
if (hit) {
  console.log('Hit collider', hit.collider, 'at time', hit.toi);
}
```

The result contains properties like `toi`, `witness1`, `witness2`, `normal1` and `normal2`, describing the time and point of impact【772664839421024†L239-L254】.

### Point projection and point intersection

Project a point onto the nearest collider or find all colliders containing a point【772664839421024†L256-L280】:

```ts
const point = { x: 1.0, y: 2.0 };

// Project onto closest collider
const proj = world.projectPoint(point, solid = true);
if (proj) {
  console.log('Point projects to', proj.point, 'on collider', proj.collider);
  console.log('Inside shape:', proj.isInside);
}

// List all colliders containing the point
world.intersectionsWithPoint(point, (handle) => {
  console.log('Collider', handle, 'contains the point');
  return true;
});
```

### Intersection tests

Check for colliders intersecting a shape or test bounding boxes【772664839421024†L310-L348】:

```ts
const shape = new RAPIER.Cuboid(1.0, 2.0);
const pos = { x: 1.0, y: 2.0 };
const rot = 0.1;

world.intersectionsWithShape(pos, rot, shape, (handle) => {
  console.log('Collider', handle, 'intersects our shape');
  return true;
});

// AABB intersection (approximate)
const aabbCenter = { x: -1.0, y: -2.0 };
const aabbHalfExtents = { x: 0.5, y: 0.6 };
world.collidersWithAabbIntersectingAabb(aabbCenter, aabbHalfExtents, (handle) => {
  console.log('Collider', handle, 'has AABB intersecting our test AABB');
  return true;
});
```

### Query filters

Most scene queries accept optional arguments to exclude certain colliders【772664839421024†L369-L392】.  Key filter parameters:

* **`flags`** – bitmask (e.g. `QueryFilterFlags.EXCLUDE_DYNAMIC`) to exclude categories of colliders (dynamic bodies, sensors, kinematic bodies, etc.).
* **`groups`** – bitmask matching only colliders with compatible collision groups.
* **`excludeCollider`** – skip a specific collider by handle.
* **`excludeRigidBody`** – skip all colliders attached to a specific rigid body.
* **`predicate`** – custom function to apply any filter logic.

---

## Advanced collision detection and events

### Event queue

Rapier can emit collision and contact‑force events when colliders start or stop intersecting, and when forces exceed a threshold.  To collect events, pass an `EventQueue` instance to `world.step(eventQueue)` and then drain the events【391591145251318†L67-L84】:

```ts
const queue = new RAPIER.EventQueue(true);
world.step(queue);

// Process collision events
queue.drainCollisionEvents((handle1, handle2, started) => {
  if (started) {
    console.log('Colliders', handle1, 'and', handle2, 'started intersecting');
  } else {
    console.log('Colliders', handle1, 'and', handle2, 'stopped intersecting');
  }
});

// Process contact force events
queue.drainContactForceEvents((event) => {
  const collider1 = event.collider1();
  const collider2 = event.collider2();
  const force = event.totalForceMagnitude();
  console.log('Contact force between', collider1, 'and', collider2, 'is', force);
});
```

To receive events, at least one collider in a pair must have the relevant **active events** flag enabled【391591145251318†L88-L98】.  Use `Collider.setActiveEvents(flags)` to configure this.  Low‑magnitude contact force events can be filtered by setting a contact force threshold on the collider【391591145251318†L88-L98】.

### Contact and intersection graphs

Rapier maintains graphs representing all contact and intersection pairs.  Use `world.contactPairsWith(collider, callback)` to visit each collider potentially in contact with a given collider【391591145251318†L131-L139】.  Use `world.intersectionPairsWith(collider, callback)` to visit each collider potentially intersecting a given collider (requires at least one collider to be a sensor)【391591145251318†L142-L169】.

### Physics hooks

Physics hooks let you implement custom contact and intersection filtering logic.  Enable the appropriate hook bits on colliders via `ActiveHooks.FILTER_CONTACT_PAIRS` or `FILTER_INTERSECTION_PAIR`.  Then implement a `PhysicsHooks` object with methods `filterContactPair` and/or `filterIntersectionPair`【391591145251318†L169-L201】.  Returning `null` or `false` from these methods prevents the pair from being considered.  When returning solver flags, include `SolverFlags.COMPUTE_IMPULSES` to compute forces for the pair【391591145251318†L196-L204】.

### Debug rendering

Rapier does not provide built‑in drawing functions, but you can query debug line data from a world to render outlines of bodies and joints.  Call `world.debugRender()` to obtain two arrays: `vertices` and `colors`.  Each consecutive pair of vertices defines a line segment, and each group of four values in `colors` defines an RGBA colour for the corresponding vertex【701892303011058†L188-L198】.  Use your rendering library (e.g. PixiJS or canvas) to draw these lines.

---

## Serialization and determinism

* **Snapshots:** call `world.takeSnapshot()` to obtain a `Uint8Array` representing the entire physics state; later restore it with `World.restoreSnapshot(snapshot)`【438541411225153†L45-L50】.  Snapshots can be saved to disk or sent over the network.
* **Determinism:** the WebAssembly version of Rapier is deterministic across platforms: running the same simulation (same engine version, initial conditions, and order of operations) on different machines yields identical results【868089729552556†L45-L64】.  Ensure that any numbers used to set up the simulation (especially results of `Math.sin`, `Math.cos`, etc.) are themselves deterministic; otherwise, the initial conditions might differ【868089729552556†L58-L68】.

---

## Best practices for 2D games

1. **Use sensors for triggers and detection.**  Sensors allow colliders to detect overlaps without affecting physics【294717662827955†L159-L165】.
2. **Lock rotation or translation when needed.**  Use `rigidBody.setEnabledRotations(x,y,z)` or `rigidBody.setEnabledTranslations(x,y,z)` to constrain movement to a single axis.
3. **Use kinematic bodies for moving platforms and characters.**  Set velocities or next translations manually and use the character controller for complex navigation【537625645192439†L49-L82】.
4. **Optimize queries with filters.**  Scene queries can be expensive; limit them by specifying `maxToi`, filter flags, collision groups and excluding certain bodies【772664839421024†L369-L392】.
5. **Tune the integration timestep.**  If the simulation becomes unstable, call `world.step()` more frequently (smaller timesteps) or adjust integration parameters.
6. **Profile event queues.**  Only collect events you need by setting appropriate active events flags; avoid draining events every frame if unnecessary.

---

## Conclusion

Rapier 2D offers a full‑featured physics solution for JavaScript and TypeScript developers, including dynamic and kinematic rigid bodies, a flexible collider system, constraints via joints, rich scene queries, events, and advanced customization hooks.  By following the patterns outlined in this guide and consulting the examples above, you can build robust 2D physics simulations suitable for games, interactive demos, or UI applications.