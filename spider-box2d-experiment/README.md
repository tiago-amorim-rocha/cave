# Spider Box2D Experiment

**A minimal, standalone experiment to replicate Unity's spider controller using Box2D TypeScript.**

## Overview

This is a clean-room implementation of the Unity spider controller, ported 1-to-1 to Box2D. It's completely separate from the main Rapier-based cave app and focuses solely on testing the spider physics.

### What's Included

- ✅ Spider rig with 2 legs, 3 segments each (hip, knee, ankle)
- ✅ Kinematic feet (pinned to ground)
- ✅ Jacobian transpose inverse kinematics
- ✅ Joint limit springs (soft constraints)
- ✅ Rotation stabilization (PD controller)
- ✅ Simple Canvas2D visualization
- ✅ Single UP button for vertical input

### What's NOT Included

- ❌ No cave/ground/terrain
- ❌ No UI beyond the UP button
- ❌ No horizontal movement (can be added easily)
- ❌ No collision with environment
- ❌ No camera controls

## Tech Stack

- **Box2D**: `@box2d/core` (TypeScript port of Box2D physics engine)
- **Build**: Vite + TypeScript
- **Rendering**: Canvas2D (raw, no libraries)

## Quick Start

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

## Usage

1. Open the app in your browser
2. Press and hold the **UP** button
3. Watch the spider extend its legs and move upward
4. Release the button to stop applying force

## Architecture

### File Structure

```
spider-box2d-experiment/
├── src/
│   ├── SpiderTypes.ts       # Type definitions
│   ├── SpiderMath.ts        # Math utilities
│   ├── SpiderBuilder.ts     # Spider rig creation
│   ├── SpiderController.ts  # Main controller logic
│   ├── SpiderRenderer.ts    # Canvas2D rendering
│   └── main.ts              # Entry point
├── index.html               # HTML page
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

### Spider Controller

The spider controller is a direct port of Unity's `SpiderController.cs`:

1. **Input**: Reads vertical input from UP button (0 or 1)
2. **Force Distribution**: Splits desired body force between left and right legs
3. **Jacobian Transpose**: Converts foot forces to joint torques
4. **Joint Limits**: Applies soft spring constraints to prevent over-extension
5. **Rotation Stabilization**: Uses PD control to keep body upright

### Physics Parameters

All parameters match Unity's prefab exactly:

- **Leg lengths**: L1=1.3m, L2=1.0m, L3=0.7m
- **Segment masses**: M1=0.2kg, M2=0.15kg, M3=0.12kg (ratio 1.3)
- **Acceleration gains**: 2.0 (vertical and horizontal)
- **Torque gain**: 2.0
- **Joint limit springs**: Kp=0.1, Kd=0.05

## Comparison with Unity

| Feature | Unity | Box2D |
|---------|-------|-------|
| Physics Engine | Unity Physics 2D | Box2D |
| Joint Type | HingeJoint2D | RevoluteJoint |
| Torque Application | AddTorque() | ApplyTorque() |
| Angle Units | Degrees (stored), Radians (computed) | Radians |
| Gravity | GravityScale = 0 | Zero gravity vector |
| Fixed Timestep | 60 Hz (FixedUpdate) | 60 Hz (manual accumulator) |

## Debugging

The console logs detailed output for the first 3 frames, including:

- Joint angles (degrees)
- Jacobian matrix components
- Input forces
- Computed torques (pre-gain and final)
- Body state (position, velocity, rotation)

Open the browser console to see this output.

## Next Steps

If this experiment works correctly:

1. ✅ Verify spider behavior matches Unity
2. ✅ Compare console logs with Unity logs
3. ✅ Tune parameters if needed
4. ⬜ Add horizontal movement (already implemented, just enable in UI)
5. ⬜ Add ground collision
6. ⬜ Integrate back into main app (if desired)

## License

This is an experiment for testing purposes. Use freely.
