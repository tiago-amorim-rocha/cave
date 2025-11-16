# SOLUTION FOUND: Knee and Ankle Absolute Rotations Are Wrong!

## The Discovery

By reverse-engineering Unity's Jacobian values, I found **8 possible angle combinations** that produce the exact Jacobian:
- j21 = -1.0285
- j22 = -0.3784
- j23 = 0.1216

The match that corresponds to our Rapier Y-down system is:

```
Absolute rotations needed:
  hip.rotation = -120.0°    ✓ (we have -120.0°)
  knee.rotation = -120.0°   ✗ (we have 0.0°)
  ankle.rotation = -80.0°   ✗ (we have 80.0°)

This gives Jacobian angles:
  thetaA = -120.0°
  thetaB = 0.0°           (since knee - hip = -120° - (-120°) = 0°)
  thetaC = 40.0°          (since ankle - knee = -80° - (-120°) = 40°)

Angle sums:
  thetaA = -120°
  thetaA + thetaB = -120°  ← KEY! This gives cos(-120°) = -0.5
  thetaA + thetaB + thetaC = -80°
```

## The Problem in Our Code

**Current Rapier setup (WRONG):**
```
LEFT leg:
  hip.rotation = -120° ✓
  knee.rotation = 0°   ✗ (should be -120°!)
  ankle.rotation = 80° ✗ (should be -80°!)
```

This gives us:
- thetaA = -120°
- thetaB = 120° (since 0° - (-120°) = 120°)
- thetaC = 80° (since 80° - 0° = 80°)

Angle sums:
- thetaA + thetaB = 0°  ← WRONG! cos(0°) = 1.0, not -0.5!
- thetaA + thetaB + thetaC = 80°

## The Fix

We need to update SpiderBuilder.ts to set:

**LEFT leg (Y-down Rapier):**
```typescript
// Initial absolute rotations (not relative!)
const hipRotation = -120°     // -2.0944 rad
const kneeRotation = -120°    // -2.0944 rad  ← CHANGED from 0°!
const ankleRotation = -80°    // -1.3963 rad  ← CHANGED from 80°!
```

**RIGHT leg (Y-down Rapier):**
```typescript
const hipRotation = -60°      // -1.0472 rad
const kneeRotation = -60°     // -1.0472 rad  ← Should match hip!
const ankleRotation = -100°   // -1.7453 rad  ← Sign flipped!
```

## Why This Makes Sense

In the initial pose, the LEFT leg should have:
- Hip-to-knee segment pointing at -120° (down-left)
- Knee-to-ankle segment ALSO at -120° (continuing straight)
- Ankle-to-foot segment at -80° (slight bend)

We were incorrectly setting the knee to 0° (horizontal), which created a 120° bend at the hip, making the leg configuration completely different from Unity's.

## Expected Result After Fix

With the corrected angles:
- Rapier j21 = -1.0285 (matching Unity!)
- Rapier j22 = -0.3784 (matching Unity!)
- Rapier j23 = 0.1216 (already matching!)

This will give us **perfect torque anti-symmetry** and **zero body rotation**, just like Unity!

## Code Changes Needed

File: `src/controllers/spider/SpiderBuilder.ts`

Current (WRONG):
```typescript
// LEFT leg
const angle1Deg = 240;  // Hip absolute -120° ≡ 240°
const angle2Deg = 120;  // Knee RELATIVE to hip: knee_abs = hip + 120 = -120 + 120 = 0° ✗
const angle3Deg = 80;   // Ankle RELATIVE to knee: ankle_abs = knee + 80 = 0 + 80 = 80° ✗
```

Fixed:
```typescript
// LEFT leg
const angle1Deg = 240;  // Hip absolute -120° ≡ 240°
const angle2Deg = 0;    // Knee RELATIVE to hip: knee_abs = hip + 0 = -120° ✓
const angle3Deg = 40;   // Ankle RELATIVE to knee: ankle_abs = knee + 40 = -120 + 40 = -80° ✓
```

For RIGHT leg:
```typescript
// RIGHT leg
const angle1Deg = 300;   // Hip absolute -60° ≡ 300°
const angle2Deg = 0;     // Knee RELATIVE to hip: knee_abs = hip + 0 = -60° ✓
const angle3Deg = -40;   // Ankle RELATIVE to knee: ankle_abs = knee + (-40) = -60 - 40 = -100° ✓
```

## Verification

After the fix, our headless test should show:
```
LEFT leg angles:
  hip.rotation() = -120.0°
  knee.rotation() = -120.0°
  ankle.rotation() = -80.0°

  thetaA = -120°, thetaB = 0°, thetaC = 40°
  thetaA + thetaB = -120° (cos = -0.5) ✓
  thetaA + thetaB + thetaC = -80° (cos = 0.1736) ✓

  j21 = -1.0285 ✓
  j22 = -0.3784 ✓
  j23 = 0.1216 ✓
```
