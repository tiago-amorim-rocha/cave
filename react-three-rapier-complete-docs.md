# react‑three‑rapier – complete offline documentation

This document is a rewritten and reorganised reference for [`@react-three/rapier`](https://github.com/pmndrs/react-three-rapier), which provides a React wrapper around the Rapier physics engine for use with [React Three Fiber](https://github.com/pmndrs/react-three-fiber).  It is written in plain Markdown so that offline agents (e.g. coding assistants) can understand the API without accessing the live documentation.

The goal of this document is to explain the main concepts, components and hooks available in the library.  It is **not** a verbatim copy of the official docs; instead it condenses and paraphrases the essential information in a consistent format.  If you need to verify behaviour beyond what is described here, consult the official website or the source code.

## Table of contents

1. [Introduction](#1-introduction)  
2. [Installing](#2-installing)  
3. [Physics overview](#3-physics-overview)  
4. [`<Physics>` component](#4-physics-component)  
5. [`<RigidBody>` component](#5-rigidbody-component)  
6. [Collider system](#6-collider-system)  
7. [Collider components](#7-collider-components)  
8. [Sensors](#8-sensors)  
9. [Events](#9-events)  
10. [Hooks](#10-hooks)  
11. [Manual impulses and forces](#11-manual-impulses-and-forces)  
12. [Raycasting and queries](#12-raycasting-and-queries)  
13. [Instanced bodies](#13-instanced-bodies)  
14. [Kinematic bodies](#14-kinematic-bodies)  
15. [Sleeping and wake‑ups](#15-sleeping-and-wake-ups)  
16. [Debugging](#16-debugging)  
17. [Best practices](#17-best-practices)  
18. [Full code examples](#18-full-code-examples)

## 1. Introduction

`react‑three‑rapier` integrates the Rapier physics engine into React Three Fiber.  It handles:

- Creating and managing a physics **world**.  
- Synchronising Three.js meshes with Rapier **rigid bodies**.  
- Generating **colliders** either automatically from geometry or explicitly via components.  
- Running the simulation loop each frame and applying gravity, damping and other integration parameters.  
- Exposing events when two colliders start or stop touching or intersecting.  
- Providing declarative components (`<RigidBody>`, `<Collider>`, etc.) and hooks (`useRigidBody`, `useRapier`) to interact with the physics engine in a React‑friendly way.

The package uses WebAssembly internally and loads the Rapier engine lazily.  You do not interact with the WASM module directly; instead you work with the wrapper components and hooks.

Rapier comes in both **3D** and **2D** variants.  `@react-three/rapier` focuses on the 3D version; a separate wrapper exists for 2D (`@react-three/rapier2d`) but it is not covered here.

## 2. Installing

To install the library alongside React Three Fiber and Three.js:

```bash
npm install @react-three/rapier three @react-three/fiber
```

Alternatively, use `yarn` or `pnpm` as appropriate.  Ensure that the versions of React and R3F are compatible with the version of `react‑three‑rapier` you install.

### Importing

The package exposes named exports for the components and hooks.  You typically import them as:

```tsx
import {
  Physics,
  RigidBody,
  Collider,
  Debug,
  CuboidCollider,
  BallCollider,
  CapsuleCollider,
  CylinderCollider,
  TrimeshCollider,
  InstancedRigidBodies,
  InstancedRigidBodiesProps,
  RapierPhysicsProps,
  RigidBodyProps,
  ColliderProps,
  RapierContext
} from '@react-three/rapier';
```

You only need to import what you use.  The default export is not used.

## 3. Physics overview

Rapier’s core concepts map onto React components:

### World

The **world** owns all rigid bodies, colliders, joints, the broad‑phase and narrow‑phase solvers, and integration parameters.  You usually do not create a world manually; the `<Physics>` component constructs one for you and stores it in context.

### Rigid bodies

A **rigid body** is a physical object that can move, rotate and interact with other bodies.  Body types include:

- **Dynamic**: responds to forces and collisions.  Gravity and damping apply.  
- **Fixed**: does not move.  Useful for floors and walls.  
- **Kinematic position based**: moves according to its explicit translation; it is not affected by forces or impulses.  
- **Kinematic velocity based**: moves with explicit linear and angular velocities you set each frame.  

### Colliders

A **collider** defines the shape used for collision detection.  A rigid body may have one or more colliders attached to it.  Colliders can be created automatically (from a mesh) or manually (via collider components).  Common shapes include:

- **cuboid** (box), specified by half‑extents along each axis  
- **ball** (sphere), specified by radius  
- **capsule**, specified by half‑height and radius  
- **cylinder**, specified by half‑height and radius  
- **trimesh**, derived from an arbitrary mesh geometry  
- **heightfield**, representing a terrain height map  

Sensors are colliders that detect overlaps but do not create physical contact forces.

### Simulation loop

Each frame, the world integrates the positions and velocities of bodies based on forces, impulses and constraints.  The integration time step can be fixed or variable.  `react‑three‑rapier` automatically calls `world.step()` in its internal render loop inside `<Physics>`.

## 4. `<Physics>` component

`<Physics>` provides the context for the physics simulation.  Place it as an ancestor of all physics bodies and colliders:

```tsx
<Canvas>
  <Physics gravity={[0, -9.81, 0]}>
    {/* physics objects here */}
  </Physics>
</Canvas>
```

### Props

- **gravity**: an array `[x, y, z]` specifying the gravity vector; defaults to `[0, -9.81, 0]`.  
- **paused**: if true, the simulation does not advance.  Useful for pausing the game.  
- **timeStep**: number or `"vary"`.  When a number is provided, the simulation advances by that fixed time step (in seconds) each render loop.  When `"vary"`, the time step is derived from the delta time between frames.  Fixed time steps produce deterministic results.  
- **updatePriority**: controls when physics updates happen relative to the React Three Fiber render pipeline.  Lower numbers update earlier.  Only adjust this if you need to coordinate physics with other custom systems.  
- **colliders**: `"cuboid"` or `"trimesh"`.  When child `<RigidBody>` components do not specify their own colliders, this default determines whether automatic collider generation uses bounding boxes (`"cuboid"`) or triangle meshes (`"trimesh"`).  
- **step**: optional callback invoked after each physics step.  Use it to run custom logic at a consistent rate.  It receives the world and delta time as arguments.  

### Behaviour

- Creates a new Rapier `World` and associated sets.  
- Provides the world through context so that child components can register bodies and colliders.  
- Automatically advances the world each frame unless `paused` is true.  
- Applies integration parameters such as gravity, damping and solver iterations.  
- Optionally renders a visualisation of colliders via the `<Debug>` component.

### Example

```tsx
<Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
  <RigidBody position={[0, 2, 0]}>
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  </RigidBody>
  <RigidBody type="fixed">
    <mesh position={[0, -0.5, 0]}>
      <boxGeometry args={[10, 1, 10]} />
      <meshStandardMaterial color="green" />
    </mesh>
  </RigidBody>
</Physics>
```

## 5. `<RigidBody>` component

`<RigidBody>` creates a Rapier rigid body and attaches it to its child mesh(es).  It accepts a wide range of props that configure the body’s type, initial transform and physical properties.

### Core props

- **type**: `"dynamic"` (default), `"fixed"`, `"kinematicPosition"` or `"kinematicVelocity"`.  Determines how the body interacts with forces and collisions.  
- **mass**: number.  Mass of the body in kilograms.  Only applies to dynamic bodies.  When omitted, mass is derived from the collider’s volume and density.  
- **lockRotations**: boolean.  If true, prevents any rotation (equivalent to setting all `enabledRotations` to false).  
- **lockTranslations**: boolean.  If true, prevents translation (equivalent to setting all `enabledTranslations` to false).  Rarely used.  
- **enabledRotations**: `[x, y, z]`.  Three booleans controlling whether rotation is allowed along each axis.  
- **enabledTranslations**: `[x, y, z]`.  Three booleans controlling movement along each axis.  
- **gravityScale**: number.  Multiplier for gravity applied to this body.  0 disables gravity.  
- **linearDamping** and **angularDamping**: numbers specifying how quickly velocities decay.  Higher values produce stronger damping.  

### Initial transform props

- **position**: `[x, y, z]`.  Starting location of the body.  If omitted, uses the mesh’s current world position.  
- **rotation**: can be specified as either an Euler array `[x, y, z]` (in radians) or a quaternion `[x, y, z, w]`.  Determines the initial orientation.  
- **scale**: `[x, y, z]`.  Affects the size of colliders generated automatically from the mesh.  

### Event callbacks

Event props allow you to react to collisions and intersections.  Each callback receives an object with details about the event:

- **onCollisionEnter({ target, other, manifold })**: fired when the body starts colliding with another collider.  `target` refers to this collider; `other` refers to the other collider; `manifold` contains contact points.  
- **onCollisionExit({ target, other })**: fired when the bodies stop colliding.  
- **onIntersectionEnter({ target, other })**: fired when sensor colliders start intersecting.  
- **onIntersectionExit({ target, other })**: fired when sensors stop intersecting.  
- **onContactForce({ totalForceMagnitude })**: fired each step with the magnitude of the contact force between two colliders if contact force events are enabled.  

### Methods via ref

You can hold a ref to a `<RigidBody>` and call methods on it.  The ref exposes:

- **applyImpulse(impulse, wake = true)**: adds linear momentum.  
- **applyImpulseAtPoint(impulse, point, wake = true)**: applies an impulse at a world point, generating both linear and angular change.  
- **applyTorqueImpulse(impulse, wake = true)**: adds angular momentum.  
- **applyForce(force, wake = true)**: applies a continuous force until the next simulation step.  
- **applyTorque(torque, wake = true)**: applies a continuous torque.  
- **setLinvel(velocity, wake = true)**: sets the linear velocity directly.  
- **setAngvel(velocity, wake = true)**: sets the angular velocity directly.  
- **setTranslation(position, wake = true)**: teleports the body to a position.  Used for kinematic bodies.  
- **setRotation(rotation, wake = true)**: sets the orientation.  
- **setNextKinematicTranslation(position)**: schedules a new position for a kinematic position‑based body, to be applied in the next step.  
- **setNextKinematicRotation(rotation)**: schedules a new rotation for a kinematic position‑based body.  
- **wakeUp()** and **sleep()**: manually wake or put the body to sleep.  
- **isSleeping()**: returns true if the body is sleeping.  

### Automatic colliders

If `<RigidBody>` has children meshes and you do not explicitly add a `<Collider>`, the library will generate colliders based on the children’s geometry.  The default shape is a bounding box (cuboid) or a triangle mesh, controlled by the `<Physics>` `colliders` prop.

### Example

```tsx
const ballRef = useRef<RigidBodyApi>(null);

function KickBall() {
  const kick = () => {
    // apply a forward impulse to the ball
    ballRef.current?.applyImpulse({ x: 0, y: 5, z: -2 }, true);
  };
  return <button onClick={kick}>Kick</button>;
}

<Physics>
  <RigidBody ref={ballRef} colliders="ball">
    <mesh>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial color="blue" />
    </mesh>
  </RigidBody>
  <RigidBody type="fixed">
    <mesh position={[0, -0.5, 0]}>
      <boxGeometry args={[10, 1, 10]} />
      <meshStandardMaterial color="grey" />
    </mesh>
  </RigidBody>
  <KickBall />
</Physics>
```

## 6. Collider system

Colliders define the shape used for collision detection.  A rigid body can have multiple colliders attached.  In `react‑three‑rapier` there are two ways to create colliders:

1. **Automatic generation**: If a `<RigidBody>` has mesh children and you do not specify your own colliders, the library generates colliders from the mesh’s geometry.  The shape is chosen based on the `<Physics>` `colliders` prop (`"cuboid"` or `"trimesh"`).  Cuboid colliders use the bounding box; trimesh colliders approximate the exact mesh shape.  Automatic colliders are convenient but less precise for irregular shapes.  
2. **Manual components**: Use `<Collider>` or the specific collider components (`<CuboidCollider>`, `<BallCollider>`, etc.) as children of `<RigidBody>` to define the shape yourself.  Manual colliders provide more control over size, position and type.

A collider can also be a sensor (detects overlaps but does not produce physical contact forces) by setting the `sensor` prop to true.

### Common collider types

Below are the most common collider components and their key props:

#### `<CuboidCollider>`

- **args**: `[halfX, halfY, halfZ]`.  Half‑extents of the box along each axis.  The full box size is double these values.  
- **translation**: `[x, y, z]`.  Local offset relative to the body.  
- **rotation**: `[x, y, z, w]` quaternion or Euler.  Local rotation of the collider.  
- **density**: number.  Density used to compute mass if no `mass` is specified on the body.  
- **friction**: number.  Coefficient of friction (0–1).  Higher values create more resistance when sliding.  
- **restitution**: number.  Coefficient of restitution (0–1).  0 = fully inelastic, 1 = fully elastic (bouncy).  
- **sensor**: boolean.  When true, the collider does not produce physical contact forces but still triggers intersection events.

#### `<BallCollider>`

- **args**: `[radius]`.  Radius of the sphere.  
- Other props match those of `<CuboidCollider>`.  

#### `<CapsuleCollider>`

- **args**: `[halfHeight, radius]`.  Half‑height of the cylindrical section and radius of the hemispherical caps.  

#### `<CylinderCollider>`

- **args**: `[halfHeight, radius]`.  Cylinder with flat ends.  

#### `<TrimeshCollider>`

Creates a collider from an arbitrary triangle mesh.  Use it for irregular shapes.  Props:

- **args**: none.  The collider uses the geometry of the mesh child.  Provide a `<mesh>` as a child inside `<TrimeshCollider>` to supply geometry.  
- **scale**: `[x, y, z]`.  Optional scale of the collider.  Defaults to the mesh’s scale.  
- **rotation** and **translation**: as before.  

Trimesh colliders can be expensive for dynamic bodies.  Consider using them only for fixed scenery or splitting the shape into simpler primitives.

#### `<Collider>` (generic)

A low‑level component that allows you to specify the collider shape manually by passing a descriptor object.  Use this when you need full control over exotic shapes or when you want to reuse shapes from an external geometry.

```tsx
<Collider
  shape="cuboid"
  args={[0.5, 1, 0.5]}
  translation={[0, 0.5, 0]}
  rotation={[0, 0, 0, 1]}
  friction={0.7}
  restitution={0.2}
  sensor={false}
/>
```

Possible values for `shape` include `"cuboid"`, `"ball"`, `"capsule"`, `"cylinder"`, `"trimesh"`, and `"heightfield"`.

### Attaching multiple colliders

You can nest multiple collider components inside a `<RigidBody>` to construct a compound shape:

```tsx
<RigidBody>
  {/* first collider */}
  <CuboidCollider args={[1, 0.5, 1]} translation={[0, 0.5, 0]} />
  {/* second collider */}
  <BallCollider args={[0.25]} translation={[0, 1.5, 0]} />
  {/* visual mesh */}
  <mesh>
    <boxGeometry args={[2, 2, 2]} />
    <meshStandardMaterial color="purple" />
  </mesh>
</RigidBody>
```

## 7. Collider components

For convenience, the library provides dedicated components for each primitive shape.  They accept the same common props described above.  This section summarises them:

- **`<CuboidCollider>`**: Box shape.  See above.  
- **`<BallCollider>`**: Sphere.  `args={[radius]}`.  
- **`<CapsuleCollider>`**: Capsule (cylinder with hemispherical ends).  `args={[halfHeight, radius]}`.  
- **`<CylinderCollider>`**: Cylinder with flat ends.  `args={[halfHeight, radius]}`.  
- **`<TrimeshCollider>`**: Triangle mesh collider.  Child `<mesh>` provides the geometry.  
- **`<HeightfieldCollider>`**: Height map for terrains.  Accepts `args` for the heights array, `scale` for spacing, and `translation`/`rotation`.  Use when you have a grid of heights representing terrain.  
- **`<Collider>`**: Generic collider.  Specify `shape` and `args` explicitly.

### Sensors

Set `sensor` on any collider to transform it into a sensor.  Sensors detect intersection events but do not generate contact forces.  Use them for triggers, detection volumes or area effects.

```tsx
<Collider shape="cuboid" args={[1, 1, 1]} sensor onIntersectionEnter={({ other }) => {
  console.log('Entered sensor with', other);
}} />
```

## 8. Sensors

Sensors are colliders that ignore physical collisions and only send intersection events.  They are essential for implementing triggers or detection zones in your game logic.  To turn a collider into a sensor, set `sensor={true}`.

When a sensor overlaps another collider, `onIntersectionEnter` is called.  When they stop overlapping, `onIntersectionExit` is called.  Sensors can be attached to dynamic, fixed or kinematic bodies.  Because sensors have no mass or friction, they do not affect the motion of other bodies.

### Example: simple trigger

```tsx
<RigidBody type="fixed">
  <CuboidCollider
    args={[2, 0.2, 2]}
    sensor
    onIntersectionEnter={({ other }) => {
      console.log(`Object entered sensor: ${other.rigidBody.object?.name}`);
    }}
  />
  <mesh>
    <boxGeometry args={[4, 0.4, 4]} />
    <meshBasicMaterial color="lightblue" />
  </mesh>
</RigidBody>
```

## 9. Events

The library exposes collision and intersection events via props on `<RigidBody>` (or `<Collider>`).  This allows your React components to respond when objects collide, separate or interact as sensors.

### Collision events

- **onCollisionEnter**: called once when two colliders start contacting.  
- **onCollisionExit**: called once when contact ends.  
- **onContactForce**: called every simulation step while the colliders are in contact, if contact force events are enabled (`contactForceEvents` prop set to true on `<RigidBody>`).  Receives a `totalForceMagnitude` parameter.  

### Intersection events

- **onIntersectionEnter**: called when colliders overlap and at least one is a sensor.  
- **onIntersectionExit**: called when such an overlap ends.  

### Payload

Each event callback receives an object with these properties:

- **target**: the collider on which the event was defined.  
- **other**: the other collider involved.  You can inspect `other.rigidBody` to get its body API.  
- **manifold**: contact manifold (for collision events) with contact points, if you need details like penetration depth or contact normal.  
- **totalForceMagnitude**: magnitude of the contact force (for contact force events).  

### Enabling contact force events

To receive `onContactForce` calls, you must set `contactForceEvents={true}` on the `<RigidBody>` or `<Collider>` you are interested in.  Otherwise these callbacks are omitted to avoid unnecessary overhead.

## 10. Hooks

The library provides hooks to interact with the underlying Rapier engine and world.

### `useRapier()`

Returns an object containing:

- **world**: the Rapier `World` instance.  
- **rapier**: the imported Rapier WASM bindings.  Use it if you need to access low‑level classes (`Vector3`, `Quaternion`, etc.).  
- **physics**: same as `world`.  Provided for backward compatibility.  

Use this hook when you need to perform queries or modify global integration parameters:

```tsx
const { world, rapier } = useRapier();
useEffect(() => {
  const gravity = world.gravity;
  console.log('Current gravity:', gravity);
}, []);
```

### `useRigidBody(options?)`

Creates a rigid body programmatically instead of using the `<RigidBody>` component.  Accepts the same options as the component props but returns a handle you can attach to a mesh manually.  This is useful when generating bodies in a loop or outside of JSX.  Basic usage:

```tsx
const body = useRigidBody({ type: 'dynamic', colliders: false });
useFrame(() => {
  body.applyImpulse({ x: 0, y: 0.5, z: 0 }, true);
});
return (
  <mesh ref={body.ref}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="red" />
  </mesh>
);
```

### `useCollider(options?)`

Similar to `useRigidBody`, but creates a collider programmatically.  You pass `shape` and `args` to define the collider.  You can attach multiple colliders to a single body created via `useRigidBody`.

### `useContactForce(body1Ref, body2Ref, callback)`

Allows you to subscribe to contact force events between two bodies.  The callback receives the total force magnitude.  Under the hood, this sets up the necessary event filter so that you do not receive global force events.

### `useBeforePhysicsStep(callback, priority?)`

Registers a callback that runs immediately before each physics step.  Useful for reading or adjusting body states just prior to integration.  The optional `priority` determines the order relative to other callbacks (higher = later).

### `useAfterPhysicsStep(callback, priority?)`

Runs a callback after each physics step.  Use this to synchronise state or trigger React updates based on the new positions.

### `useRapierDebugger()`

Returns a boolean indicating whether the debug visualisation is enabled.  You can toggle debug drawing by returning `null` or `<Debug />` conditionally.

## 11. Manual impulses and forces

Rigid bodies can be influenced by impulses and forces.  Impulses change velocity instantaneously, while forces accumulate over the time step.

### Impulses

- **applyImpulse(impulse, wake = true)**: applies a linear impulse at the body’s centre of mass.  The `impulse` is an object with `x`, `y`, `z` components.  Use `wake=false` to apply to a sleeping body without waking it immediately.  
- **applyImpulseAtPoint(impulse, point, wake = true)**: applies the impulse at a specific world point, generating both translation and rotation.  `point` is a world coordinate.  
- **applyTorqueImpulse(impulse, wake = true)**: adds angular momentum about the body’s origin.  

### Continuous forces

- **applyForce(force, wake = true)**: adds a constant force that acts for a single time step.  Equivalent to mass × acceleration.  
- **applyTorque(torque, wake = true)**: adds a constant torque.  

### Setting velocities

- **setLinvel(vel, wake = true)**: sets the linear velocity directly.  
- **setAngvel(vel, wake = true)**: sets the angular velocity directly.  

Continuous forces and impulses are removed at the end of each physics step.  To apply a sustained force, call `applyForce` every frame (e.g. inside a `useFrame` hook).

## 12. Raycasting and queries

Rapier includes a query system for performing raycasts and shape casts.  `react‑three‑rapier` exposes a simplified interface via the world object and hooks.

### Raycasting

To cast a ray through the world:

```tsx
const { world } = useRapier();
const from = { x: 0, y: 1, z: 0 };
const to = { x: 0, y: -10, z: 0 };
const direction = {
  x: to.x - from.x,
  y: to.y - from.y,
  z: to.z - from.z,
};
const ray = new rapier.Ray(from, direction);
const hit = world.castRay(ray, 1.0, true, undefined);
if (hit) {
  console.log('Hit at time of impact', hit.toi, 'collider', hit.colliderHandle);
}
```

The `castRay` method returns the first intersection along the ray.  You can also call `castRayAndGetNormal` to get the normal of the hit surface.  To retrieve all intersections along the ray, use `intersectionsWithRay`.

### Point projection and shape queries

Other query functions include:

- **projectPoint(point, solid, filter)**: finds the nearest point on any collider to the given point.  
- **castShape(shape, position, rotation, velocity, maxTime, filter)**: sweeps a shape through the world, returning the earliest time of impact.  
- **intersectionsWithShape(shape, position, rotation, filter, callback)**: calls a callback for each collider intersecting the given shape.  

The `filter` parameter allows you to restrict queries by collider groups or by excluding specific bodies.  See the Rapier docs for details on bitmasks.

### Use with React

Because queries can be expensive, you should call them sparingly (e.g. on user input or at a lower frequency).  Avoid performing multiple raycasts every frame unless necessary.

## 13. Instanced bodies

React Three Fiber supports instanced meshes via `<Instances>` and `<Instance>`.  `react‑three‑rapier` adds support for instanced physics bodies using `<InstancedRigidBodies>`.  This allows you to create thousands of identical bodies efficiently.

### `<InstancedRigidBodies>`

Wrap this component around an `<Instances>` group.  It accepts these props:

- **instances**: an array of objects describing each instance.  Each object can include:  
  - **key**: unique key (string or number).  
  - **position**: `[x, y, z]`.  
  - **rotation**: `[x, y, z, w]` quaternion or Euler.  
  - **scale**: `[x, y, z]`.  
  - **mass**: number.  
  - **canSleep**: boolean.  
- **bodyProps**: optional object of shared body props (e.g. type, gravityScale) applied to all instances.  
- **colliderProps**: optional object of shared collider props (e.g. friction, restitution).  Colliders are generated automatically from the children’s geometry.  

### Example

```tsx
import { Instances, Instance } from '@react-three/drei';

const COUNT = 100;
const cubes = Array.from({ length: COUNT }).map((_, i) => ({
  key: i,
  position: [Math.random() * 10 - 5, Math.random() * 5 + 2, Math.random() * 10 - 5],
  rotation: [0, 0, 0, 1],
  scale: [0.5, 0.5, 0.5],
}));

<Physics>
  <InstancedRigidBodies instances={cubes} bodyProps={{ type: 'dynamic' }} colliderProps={{ friction: 0.8 }}>
    <Instances>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="red" />
      {cubes.map((cube) => (
        <Instance key={cube.key} />
      ))}
    </Instances>
  </InstancedRigidBodies>
</Physics>
```

Internally, the component creates a `RigidBody` and a corresponding collider for each instance.  Because all instances share the same geometry and material, rendering and physics are very efficient.

## 14. Kinematic bodies

Rapier supports two kinds of kinematic bodies: **position based** and **velocity based**.  Kinematic bodies do not respond to forces; instead you explicitly control their motion each frame.

### Kinematic position based

When `type="kinematicPosition"` on `<RigidBody>`, the body’s position is advanced to the value specified by `setNextKinematicTranslation` and `setNextKinematicRotation` at each step.  Use this for moving platforms or objects that should teleport or slide along a path.

```tsx
const platformRef = useRef<RigidBodyApi>(null);
const t = useRef(0);
useFrame((state, delta) => {
  t.current += delta;
  const x = Math.sin(t.current) * 2;
  platformRef.current?.setNextKinematicTranslation({ x, y: 1, z: 0 });
});

<RigidBody ref={platformRef} type="kinematicPosition">
  <mesh>
    <boxGeometry args={[2, 0.2, 2]} />
    <meshStandardMaterial color="orange" />
  </mesh>
</RigidBody>
```

### Kinematic velocity based

When `type="kinematicVelocity"`, the body moves according to the linear and angular velocities set via `setLinvel` and `setAngvel`.  Use this for conveyor belts or rotating platforms.

```tsx
const beltRef = useRef<RigidBodyApi>(null);
useEffect(() => {
  beltRef.current?.setLinvel({ x: 1, y: 0, z: 0 }, true);
}, []);

<RigidBody ref={beltRef} type="kinematicVelocity">
  <mesh>
    <boxGeometry args={[4, 0.2, 2]} />
    <meshStandardMaterial color="green" />
  </mesh>
</RigidBody>
```

### Collisions with kinematic bodies

Dynamic bodies collide with kinematic bodies.  The kinematic body is not affected, but the dynamic body responds appropriately (bouncing or sliding).  This makes kinematic bodies ideal for moving platforms and obstacles.

## 15. Sleeping and wake‑ups

Rapier implements a sleeping mechanism to improve performance by skipping calculations for bodies at rest.  Bodies automatically go to sleep after remaining idle for several frames.

### Controlling sleeping

- **canSleep**: boolean (default true).  If false, the body will never go to sleep.  
- **isSleeping()**: method on the body API returning whether the body is currently sleeping.  
- **wakeUp()**: wakes the body up.  Useful when applying impulses or external changes.  
- **sleep()**: manually puts the body to sleep.  

Sleeping bodies still participate in broad‑phase collision detection but are skipped in the solver.  If a sleeping body is contacted by a moving body, it wakes up automatically.

### When to disable sleeping

In some cases (e.g. user‑controlled characters), you might want the body to remain awake.  Set `canSleep={false}` on `<RigidBody>` or call `wakeUp()` every frame.

## 16. Debugging

### `<Debug>` component

You can visualise colliders by adding `<Debug />` as a child of `<Physics>`.  It draws wireframe outlines around all colliders in the scene, using line segments in Three.js.  Example:

```tsx
<Physics>
  <Debug />
  {/* bodies and colliders */}
</Physics>
```

### Props

`<Debug>` accepts optional props to customise its appearance:

- **color**: CSS colour or `THREE.Color` used for collider lines.  Defaults to white.  
- **scale**: number controlling the thickness of lines.  
- **depthTest**: boolean controlling whether debug lines are affected by depth.  When false, lines render on top of everything.  

### Enabling at runtime

Instead of always rendering `<Debug>`, you can toggle it based on state.  For example:

```tsx
const [debug, setDebug] = useState(false);
const toggle = () => setDebug((v) => !v);

<button onClick={toggle}>Toggle debug</button>
<Physics>
  {debug && <Debug />}
  {/* other bodies */}
</Physics>
```

### Browser DevTools

Because the engine runs in JavaScript and WASM, you can also inspect internal state via the browser console.  The world instance is accessible through hooks, and bodies/colliders have readable properties.

## 17. Best practices

When building games or simulations with `react‑three‑rapier`, keep the following guidelines in mind:

- **Use simple colliders**: Prefer primitive colliders (`CuboidCollider`, `BallCollider`, etc.) over triangle meshes whenever possible.  Complex colliders slow down collision detection.  
- **Combine colliders**: For irregular shapes, combine multiple primitives into a compound collider rather than using a single `TrimeshCollider`.  
- **Static vs dynamic bodies**: Set `type="fixed"` for floors, walls and objects that never move.  Dynamic bodies consume more processing.  
- **Sensor use**: Use sensors for triggers and detection volumes.  Sensors do not consume solver time.  
- **Time step**: For consistent results, use a fixed `timeStep` on `<Physics>` (e.g. `1/60`).  When using a variable time step (`"vary"`), results can vary slightly with frame rate.  
- **Avoid heavy queries in `useFrame`**: Raycasts and shape queries can be expensive; call them only when needed (e.g. on user input).  
- **Batch operations**: When spawning many bodies, use `<InstancedRigidBodies>` to reduce overhead.  
- **Sleep control**: Keep sleeping enabled on bodies that can come to rest.  This saves performance.  Disable sleeping only for objects that must respond every frame (e.g. player characters).  
- **Keep R3F updates in sync**: When reading positions via `useFrame`, reference the physics body’s translation rather than the mesh’s transform if you bypassed `RigidBody`.  
- **Debugging**: Use `<Debug>` to see colliders and ensure they match your meshes.  Check that compound colliders align correctly.  

## 18. Full code examples

This section contains complete examples demonstrating common patterns.

### Example 1: Falling boxes on a floor

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Physics, RigidBody, Debug } from '@react-three/rapier';

function Boxes() {
  return (
    <>
      {[...Array(10)].map((_, i) => (
        <RigidBody key={i} position={[Math.random() * 4 - 2, 5 + i * 1.5, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="orange" />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

export default function App() {
  return (
    <Canvas shadows camera={{ position: [5, 5, 8], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Debug />
        <RigidBody type="fixed" colliders={false}>
          <mesh receiveShadow>
            <boxGeometry args={[10, 0.5, 10]} />
            <meshStandardMaterial color="grey" />
          </mesh>
        </RigidBody>
        <Boxes />
      </Physics>
      <OrbitControls />
    </Canvas>
  );
}
```

### Example 2: Kinematic moving platform

```tsx
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, RigidBody } from '@react-three/rapier';
import { useRef } from 'react';

function MovingPlatform() {
  const platformRef = useRef(null);
  let t = 0;
  useFrame((_, delta) => {
    t += delta;
    const x = Math.sin(t) * 2;
    const z = Math.cos(t) * 2;
    platformRef.current?.setNextKinematicTranslation({ x, y: 1, z });
  });
  return (
    <RigidBody ref={platformRef} type="kinematicPosition">
      <mesh>
        <boxGeometry args={[4, 0.2, 4]} />
        <meshStandardMaterial color="lightgreen" />
      </mesh>
    </RigidBody>
  );
}

export default function App() {
  return (
    <Canvas>
      <Physics>
        <MovingPlatform />
        {/* dynamic body that falls onto the platform */}
        <RigidBody position={[0, 5, 0]}>
          <mesh>
            <sphereGeometry args={[0.5, 16, 16]} />
            <meshStandardMaterial color="blue" />
          </mesh>
        </RigidBody>
      </Physics>
    </Canvas>
  );
}
```

### Example 3: Sensors and triggers

```tsx
import { Canvas } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider, BallCollider } from '@react-three/rapier';

function Example() {
  const handleEnter = ({ other }) => {
    console.log('Player entered trigger from object', other);
  };
  return (
    <RigidBody type="fixed">
      <CuboidCollider args={[2, 0.1, 2]} sensor onIntersectionEnter={handleEnter} />
      <mesh>
        <boxGeometry args={[4, 0.2, 4]} />
        <meshStandardMaterial color="cyan" />
      </mesh>
    </RigidBody>
  );
}

export default function App() {
  return (
    <Canvas>
      <Physics>
        <Example />
        <RigidBody position={[0, 3, 0]}>
          <BallCollider args={[0.3]} />
          <mesh>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial color="yellow" />
          </mesh>
        </RigidBody>
      </Physics>
    </Canvas>
  );
}
```

### Example 4: Instanced cubes

```tsx
import { Canvas } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { Physics, InstancedRigidBodies } from '@react-three/rapier';

function InstancedCubes() {
  const cubes = [...Array(50)].map((_, i) => ({
    key: i,
    position: [Math.random() * 10 - 5, Math.random() * 5 + 2, Math.random() * 10 - 5],
    rotation: [0, 0, 0, 1],
    scale: [0.4, 0.4, 0.4],
  }));
  return (
    <InstancedRigidBodies instances={cubes} bodyProps={{ type: 'dynamic' }} colliderProps={{ restitution: 0.5 }}>
      <Instances limit={50}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="pink" />
        {cubes.map((cube) => (
          <Instance key={cube.key} />
        ))}
      </Instances>
    </InstancedRigidBodies>
  );
}

export default function App() {
  return (
    <Canvas shadows>
      <Physics>
        <RigidBody type="fixed">
          <mesh receiveShadow>
            <boxGeometry args={[20, 0.5, 20]} />
            <meshStandardMaterial color="lightgrey" />
          </mesh>
        </RigidBody>
        <InstancedCubes />
      </Physics>
    </Canvas>
  );
}
```

### Example 5: Applying forces and torque

```tsx
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, RigidBody } from '@react-three/rapier';
import { useRef } from 'react';

function Spinner() {
  const bodyRef = useRef(null);
  useFrame(() => {
    // apply a small torque every frame
    bodyRef.current?.applyTorque({ x: 0, y: 0, z: 0.1 }, true);
  });
  return (
    <RigidBody ref={bodyRef} angularDamping={0.1}>
      <mesh>
        <boxGeometry args={[1, 0.1, 4]} />
        <meshStandardMaterial color="purple" />
      </mesh>
    </RigidBody>
  );
}

export default function App() {
  return (
    <Canvas>
      <Physics>
        <Spinner />
      </Physics>
    </Canvas>
  );
}
```

## Conclusion

This document provides a comprehensive offline reference for `@react-three/rapier`.  It covers installation, the main components (`<Physics>`, `<RigidBody>`), collider types, sensors, events, hooks, manual impulses and forces, queries, instancing, kinematic motion, sleeping control, debugging and best practices.  The examples show how to combine these features in React Three Fiber applications.

For further details, consult the official library repository and read the source code.  Since the API evolves over time, always check for breaking changes when updating versions.
