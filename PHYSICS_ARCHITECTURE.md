# Player Physics Architecture

## Overview
The player physics system uses **Rapier 2D** physics engine with a force-based character controller. Ground detection uses raycasting to enable terrain-hugging on uneven surfaces.

---

## Core Components

### 1. RapierEngine (`src/physics/engine.ts`)
**Low-level Rapier 2D wrapper**

#### Key Features:
- **Fixed timestep**: 60 Hz (16.67ms) with accumulator
- **Gravity**: (0, 10) m/s² in Y-down coordinate system
- **Terrain**: Polyline colliders (one per contour loop) to prevent internal edge artifacts
- **Ground detection**: Raycast-based system with filtered body exclusion

#### Player Body Configuration:
```typescript
// Capsule dimensions (from line 315-316)
const radius = 0.6m;          // Capsule radius
const halfHeight = 0.4m;      // Capsule half-height
// Total height = 2*halfHeight + 2*radius = 0.8 + 1.2 = 2.0m
```

#### Colliders:
1. **Main body**: Capsule collider
   - Friction: 0.0 (smooth sliding)
   - Restitution: 0.0 (no bounce)
   - Rotation locked
   - CCD enabled (continuous collision detection)

2. **Foot sensor**: Ball sensor at capsule bottom
   - Radius: `capsuleRadius × footSensorRadiusMultiplier` (default 1.3)
   - Offset: `(0, halfHeight)` in local space (at bottom of cylindrical part)
   - Used for ground contact detection and raycast origin

#### Ground Detection System:

**Method**: `getGroundNormalWithPoint(collider: RAPIER.Collider)`

**Raycast Configuration:**
- **Origins**: 5 rays spread across sensor width
  - Center, Left, Right, Left-mid, Right-mid
  - Starting height: `body.y - 1.5m` (0.5m above capsule top)
  - Spread: ±0.5 and ±0.7 × sensorRadius

- **Direction**: Downward `(0, 1)` in Y-down coordinates
- **Length**: 4.0m (reaches 2.5m below capsule bottom)
- **Filtering**: **CRITICAL** - Excludes player's rigid body via `filterExcludeRigidBody` parameter
  - Without this, raycasts hit player first and never reach terrain

**Normal Filtering:**
- Computes dot product with gravity: `cos = normal · (0, 1)`
- Accepts normals with `cos ≤ -0.4` (roughly ≤66° from vertical)
- Averages all valid normals and normalizes result

**Why Raycasts Instead of Sensor Contacts:**
- Sensors detect *presence* but not *direction* of contact
- Raycasts provide precise surface normals at contact points
- Enables slope-aware ground attraction force

---

### 2. RapierPhysics (`src/RapierPhysics.ts`)
**High-level physics API wrapper**

Simplifies common operations:
- Player creation with configurable foot sensor
- Ground detection queries
- Sensor radius updates
- Debug visualization

Key method:
```typescript
getGroundNormal(): { x: number; y: number } | null
```
Returns averaged ground normal from raycasts, or null if airborne.

---

### 3. RapierPlayer (`src/RapierPlayer.ts`)
**Force-based character controller**

#### Movement Model:
**Force-driven** (not velocity-driven) for natural physics feel.

#### Configuration (`CharacterControllerConfig`):
```typescript
movementForce: 20.0 N           // Horizontal/vertical movement
drag: 5.0                        // Linear damping coefficient
groundAttractionForce: 15.0 N   // Terrain-hugging force
footSensorRadiusMultiplier: 1.3 // Sensor size relative to capsule
```

#### Update Loop (`update(dt)`):

**1. Reset forces** (CRITICAL!)
```typescript
body.resetForces(true);
```
Rapier's `addForce()` accumulates - forces persist across timesteps unless reset!

**2. Apply ground attraction**
```typescript
if (groundNormal && groundAttractionForce > 0) {
  const attraction = -groundNormal × groundAttractionForce;
  body.addForce(attraction, true);
}
```
- Pushes player toward ground surface (negative normal direction)
- Keeps player hugging terrain on slopes and uneven surfaces
- Only applies when grounded (groundNormal != null)

**3. Apply movement forces**
```typescript
const force = movementForce × input;
body.addForce(force, true);
```
- Input from keyboard (digital ±1) or joystick (analog -1 to +1)
- Allows omnidirectional movement (x and y)

#### Input Handling:
- **Keyboard**: A/D or Arrow keys (digital)
- **Joystick**: Virtual joystick (analog, overrides keyboard)
- Only left/right movement (up/down removed from keyboard)

---

## Key Fixes Applied

### Fix #1: Raycast Filtering (edeb307)
**Problem**: Raycasts hit player's own capsule first, never reaching terrain.

**Root cause**: `castRayAndGetNormal()` returns only the FIRST hit. Raycasts started above player and cast downward, hitting player immediately.

**Solution**: Use `filterExcludeRigidBody` parameter (7th param of `castRayAndGetNormal`):
```typescript
const hit = this.world.castRayAndGetNormal(
  ray,
  rayLength,
  true,              // solid
  undefined,         // filterFlags
  undefined,         // filterGroups
  undefined,         // filterExcludeCollider
  parent             // filterExcludeRigidBody ← excludes player!
);
```

### Fix #2: Performance - Logging Removed (d7e7bf6)
**Problem**: Console logging on every frame (60 fps) killed performance.

**Removed**:
- Per-frame raycast debug logs
- Ground detection status logs (~30 times/sec with random sampling)
- Normal rejection logs

**Kept**:
- Key press/release logs (user input only)
- Config change logs (infrequent)

---

## Architecture Decisions

### Why Capsule Shape?
- Smooth sliding along walls (vs box catching on edges)
- Natural standing character proportions
- Easy to prevent rotation (locked)

### Why Force-Based Control?
- Natural physics interactions (momentum, collisions)
- Smooth acceleration/deceleration via drag
- Ground attraction works seamlessly with physics

### Why Raycasts for Ground Detection?
- Precise surface normals (direction matters for slopes)
- Works slightly above ground (anticipates landing)
- Filters by normal angle (rejects walls, ceilings)

### Why Multiple Raycasts?
- Smooths normals over uneven terrain
- Handles narrow spikes and gaps
- More stable on complex geometry

### Why Ground Attraction Force?
- Keeps player grounded on slopes
- Prevents "skating" on uneven terrain
- Natural feel - stronger pull = tighter terrain following

---

## Coordinate System

**Y-down** (standard for 2D games):
- X increases rightward
- Y increases downward
- Gravity: `(0, +10)` m/s²
- "Up" normals have negative Y component

---

## Constants Reference

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| Capsule radius | 0.6m | `engine.ts:315` | Player width |
| Capsule halfHeight | 0.4m | `engine.ts:316` | Half of cylinder height |
| Total height | 2.0m | Calculated | Full capsule height |
| Sensor radius multiplier | 1.3 | `RapierPlayer.ts:37` | Foot sensor size |
| Movement force | 20.0 N | `RapierPlayer.ts:34` | Movement strength |
| Drag | 5.0 | `RapierPlayer.ts:35` | Linear damping |
| Ground attraction | 15.0 N | `RapierPlayer.ts:36` | Terrain-hugging strength |
| Raycast start offset | -1.5m | `engine.ts:406` | 0.5m above capsule top |
| Raycast length | 4.0m | `engine.ts:416` | Enough to reach ground |
| Normal angle threshold | cos ≤ -0.4 | `engine.ts:422` | ~66° from vertical |
| Physics timestep | 60 Hz | `engine.ts:103` | Fixed 16.67ms steps |

---

## Debug Visualization

When physics debug is enabled, renders:
- **Green lines**: Terrain segments (polyline colliders)
- **Cyan/Red capsule**: Player body (red when colliding with terrain)
- **Yellow/Green ball**: Foot sensor (green when grounded)
- **White dashed line**: Body center to sensor offset
- **Green/Red rays**: Raycasts (green = hit, red = miss)
- **White circles**: Ray origins
- **Green circles**: Ray hit points
- **Magenta arrow**: Averaged ground normal vector

---

## Future Improvements

### Potential Enhancements:
1. **Coyote time**: Allow jump shortly after leaving ground
2. **Jump buffering**: Queue jump input before landing
3. **Variable jump height**: Release jump key early for shorter jumps
4. **Wall sliding**: Reduce friction on walls for smoother movement
5. **Slope speed**: Adjust movement force based on slope angle
6. **Ground snap distance**: Make configurable (currently 4.0m raycast)

### Performance Optimizations:
1. **Adaptive raycast count**: Reduce rays when clearly grounded
2. **Raycast caching**: Skip raycasts when velocity is low and grounded
3. **LOD physics**: Reduce simulation rate for distant players (multiplayer)

---

## Common Issues & Solutions

### Player not detecting ground
- Check raycasts are hitting terrain (enable debug visualization)
- Verify `filterExcludeRigidBody` is excluding player
- Confirm terrain colliders exist (check console logs on terrain creation)
- Verify normal angle threshold isn't too restrictive

### Player sliding on flat ground
- Increase drag coefficient (`setDrag()`)
- Check capsule friction (should be 0.0 for smooth control)
- Verify ground attraction force is appropriate

### Player getting stuck on edges
- Capsule shape should prevent this
- Check for non-closed contour loops (internal edges)
- Verify polyline colliders are being used (not segment colliders)

### Jittery movement on slopes
- Increase ground attraction force
- Add more raycasts for smoother normal averaging
- Reduce movement force to prevent overshooting

---

## Testing Checklist

When modifying player physics:

- [ ] Player detects ground on flat terrain
- [ ] Player detects ground on slopes
- [ ] Player can move left/right smoothly
- [ ] Player responds to joystick input
- [ ] Ground attraction keeps player on uneven terrain
- [ ] Raycasts visualize correctly (enable debug)
- [ ] No performance degradation (check FPS)
- [ ] No excessive console logging
- [ ] Player respawns correctly
- [ ] Debug UI sliders work (force, drag, attraction, sensor radius)

---

## File Reference

### Core Physics Files:
- `src/physics/engine.ts` - Rapier engine wrapper (885 lines)
- `src/RapierPhysics.ts` - High-level API (145 lines)
- `src/RapierPlayer.ts` - Character controller (282 lines)

### Related Files:
- `src/main.ts` - App entry, physics initialization
- `src/Renderer.ts` - Debug visualization rendering
- `src/VirtualJoystick.ts` - Mobile input handling

### Type Definitions:
- `node_modules/@dimforge/rapier2d-compat/**/*.d.ts` - Rapier API types

---

## Version History

- **d7e7bf6** (2025-11-13): Remove excessive debug logging for performance
- **edeb307** (2025-11-13): Fix raycast filtering to exclude player rigid body
- **d3af5e9** (previous): Add detailed raycast logging to diagnose terrain hits
- **d1023a2** (previous): Debug ground attraction raycast issues

---

*Last updated: 2025-11-13*
*Author: Claude Code (Anthropic)*
