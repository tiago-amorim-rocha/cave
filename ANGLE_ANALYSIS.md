# Angle Analysis - Finding the Jacobian Discrepancy

## Rapier Frame 1 Angles (From Detailed Log)

### LEFT Leg:
```
Raw Rapier rotations:
  hip.rotation() = -2.094395 rad = -120.000°
  knee.rotation() = 0.000000 rad = 0.000°
  ankle.rotation() = 1.396263 rad = 80.000°

Computed angles for Jacobian:
  thetaA (hip abs) = -120.000°
  thetaB (knee rel) = 120.000°  (= 0° - (-120°))
  thetaC (ankle rel) = 80.000°   (= 80° - 0°)

Angle sums:
  thetaA = -120°
  thetaA + thetaB = 0°
  thetaA + thetaB + thetaC = 80°

Trig values:
  cos(thetaA) = cos(-120°) = -0.5000
  cos(thetaA+thetaB) = cos(0°) = 1.0000
  cos(thetaA+thetaB+thetaC) = cos(80°) = 0.1736

Jacobian:
  j21 = 1.3*(-0.5) + 1.0*(1.0) + 0.7*(0.1736) = -0.65 + 1.0 + 0.1216 = 0.4716
  j22 = 1.0*(1.0) + 0.7*(0.1736) = 1.0 + 0.1216 = 1.1216
  j23 = 0.7*(0.1736) = 0.1216
```

### RIGHT Leg:
```
Raw Rapier rotations:
  hip.rotation() = -1.047198 rad = -60.000°
  knee.rotation() = 0.000000 rad = 0.000°
  ankle.rotation() = 1.745329 rad = 100.000°

Computed angles for Jacobian:
  thetaA (hip abs) = -60.000°
  thetaB (knee rel) = 60.000°   (= 0° - (-60°))
  thetaC (ankle rel) = 100.000°  (= 100° - 0°)

Angle sums:
  thetaA = -60°
  thetaA + thetaB = 0°
  thetaA + thetaB + thetaC = 100°

Trig values:
  cos(thetaA) = cos(-60°) = 0.5000
  cos(thetaA+thetaB) = cos(0°) = 1.0000
  cos(thetaA+thetaB+thetaC) = cos(100°) = -0.1736

Jacobian:
  j21 = 1.3*(0.5) + 1.0*(1.0) + 0.7*(-0.1736) = 0.65 + 1.0 - 0.1216 = 1.5284
  j22 = 1.0*(1.0) + 0.7*(-0.1736) = 1.0 - 0.1216 = 0.8784
  j23 = 0.7*(-0.1736) = -0.1216
```

## Unity Frame 1 (From logunity.txt)

### Unity's Reported Values:
```
LEFT leg: hip=120.0°, knee=-120.0°, ankle=-80.0°

Jacobian:
  j21 = -1.0285
  j22 = -0.3784
  j23 = 0.1216
```

## Reverse Engineering Unity's Angles

Since j23 matches exactly (0.1216), we know:
```
j23 = 0.7 * cos(thetaA + thetaB + thetaC) = 0.1216
cos(thetaA + thetaB + thetaC) = 0.1736
thetaA + thetaB + thetaC = ±80° (or ±100°)
```

Since j23 is positive, and we know Unity has ankle=-80°, Unity's sum is likely **-80°** or **280°**.

From j22:
```
j22 = 1.0 * cos(thetaA + thetaB) + 0.7 * cos(thetaA + thetaB + thetaC) = -0.3784
1.0 * cos(thetaA + thetaB) + 0.1216 = -0.3784
cos(thetaA + thetaB) = -0.5
thetaA + thetaB = ±120° (or ±240°)
```

From j21:
```
j21 = 1.3 * cos(thetaA) + 1.0 * cos(thetaA + thetaB) + 0.7 * cos(thetaA + thetaB + thetaC) = -1.0285
1.3 * cos(thetaA) + 1.0*(-0.5) + 0.1216 = -1.0285
1.3 * cos(thetaA) - 0.3784 = -1.0285
1.3 * cos(thetaA) = -0.6501
cos(thetaA) = -0.5
thetaA = ±120° (or ±240°)
```

## Unity's Actual Angles (Reverse Engineered):

```
thetaA = 120° (or 240° or -120°)
thetaA + thetaB = 120°
thetaA + thetaB + thetaC = -80° (or 280°)
```

If thetaA = 120°:
- thetaB = 120° - 120° = 0°
- thetaC = -80° - 120° = -200° (or equivalently 160°)

But Unity logged knee=-120°, ankle=-80°!

## THE KEY INSIGHT: Unity Uses Different Angles!

Unity's logged pose **"hip=120.0°, knee=-120.0°, ankle=-80.0°"** are likely:
1. **Absolute rotations** (not relative), OR
2. **Relative to a different reference frame**, OR
3. **In Y-up coordinate system** (not yet converted to angles used in Jacobian)

Let me test hypothesis: Unity's Y-up to Jacobian angle mapping.

If Unity's reported pose is in Y-up:
- Unity Y-up hip = 120° → Jacobian thetaA = ?
- Unity Y-up knee = -120° → How does this translate?

## Hypothesis: Coordinate System Transformation

In Unity Y-up, positive angle = counter-clockwise from +X axis going towards +Y.
In Rapier Y-down, positive angle = counter-clockwise from +X axis going towards +Y (down).

**The transformation might not be simple negation!**

If we have a segment at angle θ in Y-up:
- It points in direction (cos(θ), sin(θ)) in Y-up
- In Y-down with Y flipped, it points in direction (cos(θ), -sin(θ)) in Y-down
- This corresponds to angle -θ in Y-down

So the transformation θ_ydown = -θ_yup is correct.

But our issue is that we're getting:
- Rapier: thetaA + thetaB = 0°
- Unity: thetaA + thetaB = 120°

This is a **120° difference**!

## NEW HYPOTHESIS: Unity's knee.rotation is ABSOLUTE, not 0°!

In our Rapier implementation:
```
knee.rotation() = 0.000° (absolute world rotation)
```

But in Unity, maybe:
```
knee.rotation = 120° (absolute world rotation in Y-up)
```

Then:
- Unity thetaA = 120°
- Unity thetaB = knee.rotation - hip.rotation = 120° - 120° = 0°

Wait, that gives thetaA + thetaB = 120°, which matches what we need!

**So Unity's knee is NOT at 0° absolute rotation!**

Let me verify: If Unity LEFT leg has:
- hip.rotation = 120° (absolute)
- knee.rotation = 120° + relative_knee = 120° + (-120°) = 0° (absolute)
- ankle.rotation = 0° + relative_ankle = 0° + (-80°) = -80° (absolute)

Then Unity's Jacobian angles would be:
- thetaA = 120° * (π/180) = 2.0944 rad
- thetaB = (0° - 120°) * (π/180) = -120° * (π/180) = -2.0944 rad
- thetaC = (-80° - 0°) * (π/180) = -80° * (π/180) = -1.3963 rad

Angle sums:
- thetaA = 120°
- thetaA + thetaB = 120° + (-120°) = 0°
- thetaA + thetaB + thetaC = 0° + (-80°) = -80°

Let's verify the Jacobian:
```
j21 = 1.3*cos(120°) + 1.0*cos(0°) + 0.7*cos(-80°)
    = 1.3*(-0.5) + 1.0*(1.0) + 0.7*(0.1736)
    = -0.65 + 1.0 + 0.1216
    = 0.4716
```

But Unity has j21 = -1.0285, not 0.4716!

## CRITICAL REALIZATION: The Issue is in OUR Initial Pose!

We need Unity's knee to be at 0° absolute (horizontal), not our hip!

Let me re-examine our initial pose setup...

Looking at our SpiderBuilder.ts initial angles:
```typescript
const angle1Deg = isLeft ? 240 : 300; // Hip absolute
const angle2Deg = isLeft ? 120 : 60;  // Knee relative
const angle3Deg = isLeft ? 80 : 100;  // Ankle relative
```

This gives:
- LEFT: hip=240°, hip+knee=360°≡0°, hip+knee+ankle=80°
- RIGHT: hip=300°, hip+knee=360°≡0°, hip+knee+ankle=100°

But we need Unity's configuration which is:
- LEFT: hip=120°, hip+knee=0°, hip+knee+ankle=-80°

So in Y-down (negating all):
- LEFT: hip=-120°, hip+knee=0°, hip+knee+ankle=80°

This is what we have! So our pose is actually correct!

The discrepancy must be something else...

Wait! Let me check if Unity is using DEGREES vs RADIANS incorrectly, or if there's a different frame of reference.
