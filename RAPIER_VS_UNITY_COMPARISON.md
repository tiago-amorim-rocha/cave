# Rapier vs Unity Spider Physics Comparison

## Test Results Summary

**Test Date:** 2025-11-16
**Rapier Version:** 0.19.3
**Test File:** `rapier-headless-output.txt`
**Unity Reference:** `spider-unity-version/logunity.txt`

## ✅ Headless Test Success!

The headless Playwright test now works with the `--single-process` flag (critical for Docker environments).

```bash
node test-spider-simple.js
```

## 🔍 Critical Finding: Different Initial Pose

### Unity Initial Pose (Y-up coordinate system)
```
LEFT leg: hip=120.0°, knee=-120.0°, ankle=-80.0°
RIGHT leg: hip=60.0°, knee=-60.0°, ankle=-100.0°
```

### Rapier Initial Pose (Y-down coordinate system)
```
LEFT leg: hip=-130.0°, knee=260.0°, ankle=-40.0°
RIGHT leg: hip=-50.0°, knee=100.0°, ankle=40.0°
```

### Analysis

**The initial poses are different!** This is expected because:

1. **Coordinate system difference**: Unity uses Y-up, Rapier uses Y-down
2. **Angle wrapping**: knee=260° is equivalent to knee=-100° (260° - 360° = -100°)
3. **Sign flips**: Due to Y-axis inversion

Let's normalize the angles to compare:

| Joint | Unity Left | Rapier Left | Unity Right | Rapier Right |
|-------|-----------|-------------|-------------|--------------|
| Hip (abs) | 120° | -130° (≡ 230°) | 60° | -50° (≡ 310°) |
| Knee (rel) | -120° | 260° (≡ -100°) | -60° | 100° |
| Ankle (rel) | -80° | -40° | -100° | 40° |

**Problem:** The ankle angles don't match! Unity has ±80°/±100°, but Rapier has ±40°.

## 📊 Frame 1 Jacobian Comparison

### Unity Frame 1 (with vertical input Fy=-0.1001)
```
LEFT leg Jacobian vertical components:
  j21 (hip vertical) = -1.0285
  j22 (knee vertical) = -0.3784
  j23 (ankle vertical) = 0.1216

RIGHT leg Jacobian vertical components:
  j21 (hip vertical) = 1.0285
  j22 (knee vertical) = 0.3784
  j23 (ankle vertical) = -0.1216

Frame 1 BODY: angVel=0.001776 rad/s, rotation=0.000°
```

### Rapier Frame 1 (with zero input Fy=0.0000)
```
LEFT leg Jacobian vertical components:
  j21 (hip vertical) = -1.4784
  j22 (knee vertical) = -0.6428
  j23 (ankle vertical) = -0.0000

RIGHT leg Jacobian vertical components:
  j21 (hip vertical) = 1.4784
  j22 (knee vertical) = 0.6428
  j23 (ankle vertical) = 0.0000

Frame 1 BODY: angVel=0.000000 rad/s, rotation=0.000°
```

### Jacobian Differences

| Component | Unity Left | Rapier Left | Diff | Unity Right | Rapier Right | Diff |
|-----------|-----------|-------------|------|-------------|--------------|------|
| j21 | -1.0285 | -1.4784 | **-0.450** | 1.0285 | 1.4784 | **+0.450** |
| j22 | -0.3784 | -0.6428 | **-0.264** | 0.3784 | 0.6428 | **+0.264** |
| j23 | 0.1216 | 0.0000 | **-0.122** | -0.1216 | 0.0000 | **+0.122** |

**✅ Perfect anti-symmetry maintained** (left = -right for both implementations)

**❌ Jacobian values differ significantly** due to different initial pose

## 🎯 Root Cause Analysis

### The Issue: Incorrect Initial Ankle Angles

Looking at `SpiderBuilder.ts` lines 149-151:

```typescript
const angle1Deg = isLeft ? (360 - 130) : (360 - 50); // Left: 230°, Right: 310°
const angle2Deg = isLeft ? -100 : 100; // Knee relative angles
const angle3Deg = isLeft ? -40 : 40;   // ❌ ANKLE ANGLES TOO SMALL!
```

Unity uses:
```csharp
// From Unity prefab
Left leg: hip=130°, knee=100°, ankle=40°  (in Y-up)
Right leg: hip=50°, knee=-100°, ankle=-40° (in Y-up)
```

Wait, let me re-check the Unity initial pose log more carefully...

Actually, Unity's logged initial pose shows:
```
LEFT leg: hip=120.0°, knee=-120.0°, ankle=-80.0°
RIGHT leg: hip=60.0°, knee=-60.0°, ankle=-100.0°
```

So Unity is NOT using the prefab defaults either! It's using different angles at runtime.

## 🔧 Next Steps

### 1. Match Unity's Runtime Initial Pose

We need to understand what Unity's actual initial pose is supposed to be. The logged pose (120°/-120°/-80° vs 60°/-60°/-100°) doesn't match the prefab (130°/100°/40° vs 50°/-100°/-40°).

**Action:** Check Unity's `ApplyLegLayout()` function to see how it computes initial joint angles.

### 2. Angular Velocity Comparison

Unity shows `angVel=0.001776 rad/s` in Frame 1 even with input.
Rapier shows `angVel=0.000000 rad/s` in Frame 1 with zero input.

This suggests:
- Unity has some initial angular motion (possibly from startup physics settling)
- Rapier starts perfectly still (which is correct for zero input)

### 3. Test With Actual Input

The automated joystick test didn't apply any input (all frames show Fy=0.0000).

**Action:** Debug why `joystick.injectTestInput()` isn't working in headless mode.

## 📝 Observations

### ✅ What's Working Correctly

1. **Perfect anti-symmetry**: Left and right Jacobians are exact opposites (sign-wise)
2. **Zero angular velocity**: With zero input, body stays perfectly still
3. **Jacobian computation**: The math appears correct given the initial pose
4. **Headless testing**: Successfully running physics simulation without browser UI

### ❌ What Needs Investigation

1. **Initial pose mismatch**: Ankle angles don't match Unity
2. **Test input not working**: Automated test shows Fy=0.0000 throughout
3. **Unity's runtime vs prefab angles**: Discrepancy between logged pose and prefab values

## 🚀 Recommended Actions

1. **Fix initial pose** in `SpiderBuilder.ts` to match Unity's logged runtime pose
2. **Debug joystick input** in headless mode (may need to bypass VirtualJoystick and inject directly)
3. **Re-run comparison** with matching initial pose and actual vertical input
4. **Verify Jacobian values** match Unity when poses are identical

## 📂 Files for Comparison

- **Rapier output**: `rapier-headless-output.txt` (100 frames, zero input)
- **Unity output**: `spider-unity-version/logunity.txt` (vertical input test)
- **Test script**: `test-spider-simple.js` (working headless test)
